#!/usr/bin/env node
// Creates/updates the AWS infrastructure (Terraform) and deploys the MERN app.
//
//   npm run deploy                         infrastructure + backend + frontend ("prod")
//   npm run deploy -- --env dev            another environment (infra/environments/dev.tfvars)
//   npm run deploy -- --app-only           ship new code only (no Terraform) - also used by CI
//   npm run deploy -- --help               all options
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PutParameterCommand } from '@aws-sdk/client-ssm';
import {
  createClients,
  dockerLoginToEcr,
  ensureStateBucket,
  getIdentity,
  invalidateCdn,
  readManifest,
  runOnInstance,
  stateBucketName,
  uploadSite,
  waitForSsmOnline,
} from './lib/aws.mjs';
import {
  ROOT,
  capture,
  checkDocker,
  checkNodeVersion,
  checkTerraform,
  color,
  fail,
  log,
  printCommandOutput,
  resolveTarget,
  run,
  runMain,
  runShell,
  sleep,
  terraformInit,
  terraformOutputs,
  terraformVarArgs,
} from './lib/common.mjs';

const HELP = `
Usage: npm run deploy -- [options]      (or: node scripts/deploy.mjs [options])

  --env <name>       Environment to deploy: infra/environments/<name>.tfvars (default: prod)
  --profile <name>   AWS CLI profile to use (default: AWS_PROFILE or "default")
  --region <region>  Override aws_region from the tfvars file
  --project <name>   Override project_name from the tfvars file
  -y, --yes          No confirmation prompts (Terraform runs with -auto-approve)
  --infra-only       Only run Terraform
  --app-only         Skip Terraform and deploy code to an existing environment
  --skip-backend     Don't build/deploy the backend
  --skip-frontend    Don't build/deploy the frontend
  --tag <tag>        Deploy an existing backend image tag instead of building a new one
  --replace-server   Recreate the EC2 server from the latest Amazon Linux AMI (OS patching).
                     MongoDB data and the Elastic IP are kept.
  --replace <addr>   Force Terraform to recreate a resource (repeatable), e.g. to rotate a
                     generated secret: --replace random_password.origin_verify
  -h, --help         Show this help
`;

const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

async function main() {
  const { values: args } = parseArgs({
    options: {
      env: { type: 'string' },
      profile: { type: 'string' },
      region: { type: 'string' },
      project: { type: 'string' },
      yes: { type: 'boolean', short: 'y', default: false },
      'infra-only': { type: 'boolean', default: false },
      'app-only': { type: 'boolean', default: false },
      'skip-backend': { type: 'boolean', default: false },
      'skip-frontend': { type: 'boolean', default: false },
      tag: { type: 'string' },
      'replace-server': { type: 'boolean', default: false },
      replace: { type: 'string', multiple: true, default: [] },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (args.help) {
    console.log(HELP);
    return;
  }
  const replaceAddresses = [...args.replace, ...(args['replace-server'] ? ['module.app_server.aws_instance.app'] : [])];
  if (args['infra-only'] && args['app-only']) fail('--infra-only and --app-only cannot be combined.');
  if (replaceAddresses.length && args['app-only']) fail('--replace / --replace-server need Terraform; they cannot be combined with --app-only.');
  if (args.tag && !TAG_RE.test(args.tag)) fail(`Invalid image tag "${args.tag}".`);
  if (args.profile) process.env.AWS_PROFILE = args.profile;

  const target = resolveTarget(args);
  const runTerraform = !args['app-only'];
  const deployBackend = !args['infra-only'] && !args['skip-backend'];
  const deployFrontend = !args['infra-only'] && !args['skip-frontend'];
  const buildImage = deployBackend && !args.tag;

  log.step('Checking prerequisites');
  checkNodeVersion();
  if (runTerraform) {
    if (!target.hasTfvars) fail(`Missing ${path.relative(ROOT, target.tfvarsFile)} - copy infra/environments/prod.tfvars to create it.`);
    log.ok(`Terraform ${checkTerraform()}`);
  }
  if (buildImage) log.ok(`Docker ${checkDocker()}`);

  const aws = createClients(target.region);
  const identity = await getIdentity(aws.sts);
  log.ok(`AWS account ${identity.Account} (${identity.Arn})`);
  log.info(`Environment ${color.bold(target.name)} in ${color.bold(target.region)}`);

  const manifest = runTerraform
    ? await applyInfrastructure(target, aws, identity.Account, { autoApprove: args.yes, replaceAddresses })
    : await readManifest(aws.ssm, target);

  if (args['infra-only']) {
    printSummary(manifest, target);
    return;
  }

  // Build everything first so a broken build never leaves a half-deployed release.
  const tag = buildImage ? await buildBackendImage(manifest, aws) : args.tag;
  const siteDir = deployFrontend ? buildFrontend(manifest) : null;

  if (deployBackend) await rolloutBackend(manifest, aws, tag);
  if (deployFrontend) await publishFrontend(manifest, aws, siteDir);

  await smokeTest(manifest);
  printSummary(manifest, target);
}

// ---------------------------------------------------------------------------

async function applyInfrastructure(target, aws, accountId, { autoApprove, replaceAddresses }) {
  log.step('Terraform state bucket');
  const bucket = stateBucketName(target, accountId);
  const created = await ensureStateBucket(aws.s3, {
    bucket,
    region: target.region,
    tags: { Project: target.project, Environment: target.env, ManagedBy: 'deploy-script' },
  });
  log.ok(`${created ? 'Created' : 'Using'} s3://${bucket}`);

  log.step('Terraform init');
  terraformInit(target, bucket);

  log.step('Terraform apply');
  if (!autoApprove) log.info('Review the plan, then type "yes". A first deployment takes about 10 minutes (mostly CloudFront).');
  for (const address of replaceAddresses) log.info(`Forcing replacement of ${address}`);
  run('terraform', [
    '-chdir=infra',
    'apply',
    ...(autoApprove ? ['-auto-approve', '-input=false'] : []),
    ...replaceAddresses.map((address) => `-replace=${address}`),
    ...terraformVarArgs(target),
  ]);

  const manifest = terraformOutputs().deploy_manifest?.value;
  if (!manifest) fail('Terraform produced no outputs - was the apply cancelled?');
  return manifest;
}

function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.resolve(ROOT, p);
}

/** Unique, sortable image tag: 20261030-142501-<git sha>[-dirty] */
function imageTag(dir) {
  const digits = new Date().toISOString().replace(/\D/g, '');
  const stamp = `${digits.slice(0, 8)}-${digits.slice(8, 14)}`;
  const sha = capture('git', ['-C', dir, 'rev-parse', '--short=8', 'HEAD'], { allowFailure: true });
  if (!sha) return `${stamp}-nogit`;
  const dirty = capture('git', ['-C', dir, 'status', '--porcelain', '--', '.'], { allowFailure: true });
  return `${stamp}-${sha}${dirty ? '-dirty' : ''}`;
}

async function buildBackendImage(manifest, aws) {
  log.step('Building the backend image');
  const backendDir = resolvePath(manifest.backend_path);
  if (!existsSync(path.join(backendDir, 'package.json'))) {
    fail(`No package.json in ${backendDir} - check backend_path in your tfvars file.`);
  }

  const ownDockerfile = path.join(backendDir, 'Dockerfile');
  const dockerfile = manifest.backend_dockerfile
    ? resolvePath(manifest.backend_dockerfile)
    : existsSync(ownDockerfile)
      ? ownDockerfile
      : path.join(ROOT, 'templates', 'Dockerfile.node');
  if (!existsSync(dockerfile)) fail(`Dockerfile not found: ${dockerfile}`);

  const tag = imageTag(backendDir);
  const image = `${manifest.ecr_repository_url}:${tag}`;
  log.info(`Source:     ${backendDir}`);
  log.info(`Dockerfile: ${dockerfile}`);
  log.info(`Image:      ${image} (${manifest.docker_platform})`);

  await dockerLoginToEcr(aws.ecr);
  const hasBuildx = capture('docker', ['buildx', 'version'], { allowFailure: true }) !== null;
  if (hasBuildx) {
    run('docker', [
      'buildx', 'build',
      '--platform', manifest.docker_platform,
      '--provenance=false',
      '--file', dockerfile,
      '--tag', image,
      '--push',
      backendDir,
    ]);
  } else {
    run('docker', ['build', '--platform', manifest.docker_platform, '--file', dockerfile, '--tag', image, backendDir]);
    run('docker', ['push', image]);
  }
  log.ok(`Pushed ${image}`);
  return tag;
}

function buildFrontend(manifest) {
  log.step('Building the frontend');
  const frontendDir = resolvePath(manifest.frontend_path);
  if (!existsSync(path.join(frontendDir, 'package.json'))) {
    fail(`No package.json in ${frontendDir} - check frontend_path in your tfvars file.`);
  }
  const command = manifest.frontend_build_command;
  if (/\bnpm ci\b/.test(command) && !existsSync(path.join(frontendDir, 'package-lock.json'))) {
    fail(`"${command}" needs ${path.join(frontendDir, 'package-lock.json')}. Run "npm install" in that folder once (and commit the lock file).`);
  }

  log.info(`${command}   (in ${frontendDir})`);
  runShell(command, { cwd: frontendDir, env: manifest.frontend_build_env });

  const siteDir = path.join(frontendDir, manifest.frontend_build_dir);
  if (!existsSync(path.join(siteDir, 'index.html'))) {
    fail(`The build finished but ${path.join(siteDir, 'index.html')} is missing - check frontend_build_dir.`);
  }
  log.ok(`Built ${siteDir}`);
  return siteDir;
}

async function rolloutBackend(manifest, aws, tag) {
  log.step(`Deploying backend ${tag} on ${manifest.instance_id}`);
  await waitForSsmOnline(aws.ssm, manifest.instance_id);

  const result = await runOnInstance(aws.ssm, {
    instanceId: manifest.instance_id,
    comment: `deploy ${tag}`,
    logGroup: manifest.log_groups.ssm,
    timeoutSeconds: 3600, // a brand-new, CPU-throttled server can need a while for its first boot
    commands: [
      // A brand-new server may still be downloading its files during the first minutes.
      'for i in $(seq 1 60); do [ -x /opt/app/bin/deploy-app.sh ] && break; echo "Waiting for the server bootstrap..."; sleep 10; done',
      `/opt/app/bin/deploy-app.sh '${tag}'`,
    ],
  });
  printCommandOutput(result);
  if (result.status !== 'Success') {
    fail(
      `Backend deployment ${result.status}. The previous version (if any) was restored automatically.\n` +
        `  Full log: CloudWatch log group ${manifest.log_groups.ssm}, or: npm run logs -- system`,
    );
  }

  // Record the new known-good version: used when the server reboots or is replaced.
  await aws.ssm.send(new PutParameterCommand({ Name: manifest.image_tag_parameter, Value: tag, Type: 'String', Overwrite: true }));
  log.ok(`Backend ${tag} is live`);
}

async function publishFrontend(manifest, aws, siteDir) {
  log.step('Publishing the frontend');
  const { uploaded, deleted } = await uploadSite(aws.s3, { bucket: manifest.frontend_bucket, dir: siteDir });
  log.ok(`Uploaded ${uploaded} files to s3://${manifest.frontend_bucket}${deleted ? `, removed ${deleted} old files` : ''}`);
  const invalidationId = await invalidateCdn(aws.cloudfront, manifest.cloudfront_distribution_id);
  log.ok(`CloudFront cache invalidation ${invalidationId} started (completes in about a minute)`);
}

async function smokeTest(manifest) {
  log.step('Smoke test');
  const url = `${manifest.app_url}${manifest.health_check_path}`;
  let last = '';
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const body = (await res.text()).slice(0, 300);
      if (res.ok) {
        log.ok(`GET ${url} -> ${res.status} ${body}`);
        return;
      }
      last = `${res.status} ${body}`;
    } catch (err) {
      last = err.cause?.code ?? err.message;
    }
    await sleep(10_000);
  }
  log.warn(`GET ${url} has not succeeded yet (last result: ${last}).`);
  log.warn('A new CloudFront distribution can need a few more minutes everywhere. Re-check with: npm run status');
}

function printSummary(manifest, target) {
  const envFlag = target.env === 'prod' ? '' : ` --env ${target.env}`;
  const npmArgs = envFlag ? ` --${envFlag}` : '';
  log.step('Done');
  console.log(`
    App:          ${color.bold(manifest.app_url)}
    API health:   ${manifest.app_url}${manifest.health_check_path}
    Dashboard:    ${manifest.dashboard_url}

    Status:       npm run status${npmArgs}
    Backend logs: npm run logs -- backend --follow${envFlag}
    Server shell: npm run ops -- shell${envFlag}
    Delete all:   npm run destroy${npmArgs}

    If you set alert_email, confirm the two subscription emails from AWS Notifications.
`);
}

runMain(main);
