#!/usr/bin/env node
// Day-2 operations for a deployed environment. Everything goes through AWS APIs
// (SSM Run Command / Session Manager) - no SSH keys, no open ports.
//
//   npm run ops -- <command> [args] [--env prod] [--profile name]
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { DescribeInstancesCommand, EC2Client } from '@aws-sdk/client-ec2';
import { DescribeImagesCommand, ECRClient } from '@aws-sdk/client-ecr';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { DescribeInstanceInformationCommand, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import { createClients, readManifest, runOnInstance } from './lib/aws.mjs';
import { ask, color, fail, log, printCommandOutput, resolveTarget, runMain, sleep } from './lib/common.mjs';

const HELP = `
Usage: npm run ops -- <command> [arguments] [--env <name>] [--profile <name>]

  status                  Server state, deployed version, health check, URLs
  logs [group]            Recent CloudWatch logs. group: backend (default), nginx, mongo, system, ssm
                            --since 30m|2h|1d   (default 30m)    -f, --follow   keep streaming
  shell                   Interactive shell on the server (needs AWS CLI + Session Manager plugin)
  exec "<command>"        Run a shell command on the server, e.g.  exec "docker ps"
  redeploy                Restart the current version (picks up changed env vars / secrets)
  rollback [--tag <tag>]  Deploy the previous backend image (or a specific tag)
  backup                  Back up MongoDB to S3 now           (database_mode = "local")
  backups                 List MongoDB backups
  restore <key>           Restore a backup - DESTRUCTIVE      (database_mode = "local")

  -y, --yes               Skip confirmation prompts
`;

const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

async function main() {
  const { values: args, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      env: { type: 'string' },
      profile: { type: 'string' },
      region: { type: 'string' },
      project: { type: 'string' },
      since: { type: 'string', default: '30m' },
      follow: { type: 'boolean', short: 'f', default: false },
      tag: { type: 'string' },
      yes: { type: 'boolean', short: 'y', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, ...rest] = positionals;
  if (!command || args.help) {
    console.log(HELP);
    return;
  }
  const handler = COMMANDS[command];
  if (!handler) fail(`Unknown command "${command}". Run: npm run ops -- --help`);
  if (args.profile) process.env.AWS_PROFILE = args.profile;

  const target = resolveTarget(args);
  const aws = createClients(target.region);
  const manifest = await readManifest(aws.ssm, target);
  await handler({ args, rest, aws, manifest });
}

// ---------------------------------------------------------------------------

async function status({ aws, manifest }) {
  const ec2 = new EC2Client({ region: manifest.aws_region });
  const [instances, ssmInfo, tagParam, health] = await Promise.all([
    ec2.send(new DescribeInstancesCommand({ InstanceIds: [manifest.instance_id] })),
    aws.ssm.send(new DescribeInstanceInformationCommand({ Filters: [{ Key: 'InstanceIds', Values: [manifest.instance_id] }] })),
    aws.ssm.send(new GetParameterCommand({ Name: manifest.image_tag_parameter })),
    checkHealth(`${manifest.app_url}${manifest.health_check_path}`),
  ]);
  const instance = instances.Reservations?.[0]?.Instances?.[0];

  const rows = [
    ['Environment', `${manifest.name}  (${manifest.aws_region}, account ${manifest.account_id})`],
    ['App URL', color.bold(manifest.app_url)],
    ['Server', `${manifest.instance_id}  ${instance?.InstanceType ?? ''}  ${instance?.State?.Name ?? 'not found'}  ${instance?.Placement?.AvailabilityZone ?? ''}`],
    ['SSM agent', ssmInfo.InstanceInformationList?.[0]?.PingStatus ?? 'not connected'],
    ['Backend version', tagParam.Parameter.Value],
    ['Database', manifest.database_mode === 'local' ? 'MongoDB container on the server (local)' : 'external (mongodb_uri)'],
    ['Health check', health],
    ['Dashboard', manifest.dashboard_url],
  ];
  console.log();
  for (const [label, value] of rows) console.log(`  ${label.padEnd(16)} ${value}`);
  console.log();
}

async function checkHealth(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const text = `${res.status} ${(await res.text()).slice(0, 200)}`;
    return res.ok ? color.green(text) : color.red(text);
  } catch (err) {
    return color.red(`unreachable (${err.cause?.code ?? err.message})`);
  }
}

function parseDuration(text) {
  const match = /^(\d+)([smhd])$/.exec(text ?? '');
  if (!match) fail(`Invalid --since "${text}". Use e.g. 30m, 2h or 1d.`);
  return Number(match[1]) * { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
}

async function logs({ args, rest, manifest }) {
  const group = rest[0] ?? 'backend';
  const logGroupName = manifest.log_groups[group];
  if (!logGroupName) fail(`Unknown log group "${group}". Choose one of: ${Object.keys(manifest.log_groups).join(', ')}`);

  const client = new CloudWatchLogsClient({ region: manifest.aws_region });
  let startTime = Date.now() - parseDuration(args.since);
  const seen = new Set();
  log.info(color.dim(`${logGroupName} since ${new Date(startTime).toISOString()}${args.follow ? ' - following, Ctrl+C to stop' : ''}`));

  for (;;) {
    let nextToken;
    let newest = startTime;
    do {
      const page = await client.send(new FilterLogEventsCommand({ logGroupName, startTime, nextToken }));
      for (const event of page.events ?? []) {
        if (seen.has(event.eventId)) continue;
        seen.add(event.eventId);
        newest = Math.max(newest, event.timestamp);
        console.log(`${color.dim(new Date(event.timestamp).toISOString())} ${color.cyan(event.logStreamName)} ${event.message.trimEnd()}`);
      }
      nextToken = page.nextToken;
    } while (nextToken);
    if (!args.follow) return;
    startTime = newest;
    await sleep(3_000);
  }
}

function shell({ manifest }) {
  log.info(`Opening a shell on ${manifest.instance_id} through SSM Session Manager ("exit" to leave)...`);
  log.info(color.dim('Useful: sudo -i  |  cd /opt/app  |  docker ps  |  tail -f /var/log/app/deploy.log'));
  const result = spawnSync('aws', ['ssm', 'start-session', '--target', manifest.instance_id, '--region', manifest.aws_region], {
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    fail('The session could not start. It needs AWS CLI v2 and the Session Manager plugin: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html');
  }
}

async function runAndReport(aws, manifest, commands, comment, timeoutSeconds = 1800) {
  const result = await runOnInstance(aws.ssm, {
    instanceId: manifest.instance_id,
    commands,
    comment,
    logGroup: manifest.log_groups.ssm,
    timeoutSeconds,
  });
  printCommandOutput(result);
  if (result.status !== 'Success') fail(`${comment}: ${result.status}`);
  return result;
}

async function execCommand({ rest, aws, manifest }) {
  const commandLine = rest.join(' ').trim();
  if (!commandLine) fail('Usage: npm run ops -- exec "docker ps"');
  await runAndReport(aws, manifest, [commandLine], 'ops exec', 600);
}

async function redeploy({ aws, manifest }) {
  log.step('Redeploying the current backend version');
  await runAndReport(aws, manifest, ['/opt/app/bin/deploy-app.sh'], 'ops redeploy');
  log.ok('Done');
}

async function listImages(manifest) {
  const ecr = new ECRClient({ region: manifest.aws_region });
  const repositoryName = manifest.ecr_repository_url.split('/').slice(1).join('/');
  const images = [];
  let nextToken;
  do {
    const page = await ecr.send(new DescribeImagesCommand({ repositoryName, filter: { tagStatus: 'TAGGED' }, nextToken }));
    images.push(...(page.imageDetails ?? []));
    nextToken = page.nextToken;
  } while (nextToken);
  return images.sort((a, b) => b.imagePushedAt - a.imagePushedAt);
}

async function rollback({ args, aws, manifest }) {
  const { Parameter } = await aws.ssm.send(new GetParameterCommand({ Name: manifest.image_tag_parameter }));
  const current = Parameter.Value;

  let tag = args.tag;
  if (!tag) {
    const images = await listImages(manifest);
    const index = images.findIndex((image) => image.imageTags?.includes(current));
    const previous = index >= 0 ? images[index + 1] : undefined;
    if (!previous) fail(`No image older than "${current}" found in ECR. Use --tag <tag> to choose one.`);
    tag = previous.imageTags[0];
  }
  if (!TAG_RE.test(tag)) fail(`Invalid image tag "${tag}".`);

  log.info(`Current version:  ${current}`);
  log.info(`Roll back to:     ${color.bold(tag)}`);
  if (!args.yes && (await ask('Proceed? (yes/no)')) !== 'yes') fail('Cancelled.');

  await runAndReport(aws, manifest, [`/opt/app/bin/deploy-app.sh '${tag}'`], `rollback to ${tag}`);
  await aws.ssm.send(new PutParameterCommand({ Name: manifest.image_tag_parameter, Value: tag, Type: 'String', Overwrite: true }));
  log.ok(`Backend rolled back to ${tag}`);
}

function requireLocalDatabase(manifest) {
  if (manifest.database_mode !== 'local') {
    fail('This environment uses an external MongoDB (database_mode = "external") - use your provider\'s backup tools (e.g. MongoDB Atlas backups).');
  }
}

async function backup({ aws, manifest }) {
  requireLocalDatabase(manifest);
  log.step('Backing up MongoDB to S3');
  await runAndReport(aws, manifest, ['/opt/app/bin/backup-mongo.sh'], 'ops backup', 3600);
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

async function backups({ aws, manifest }) {
  requireLocalDatabase(manifest);
  const objects = [];
  let ContinuationToken;
  do {
    const page = await aws.s3.send(
      new ListObjectsV2Command({ Bucket: manifest.artifacts_bucket, Prefix: 'backups/mongo/', ContinuationToken }),
    );
    objects.push(...(page.Contents ?? []));
    ContinuationToken = page.NextContinuationToken;
  } while (ContinuationToken);

  if (objects.length === 0) {
    log.info('No backups yet. They run daily, or now with: npm run ops -- backup');
    return;
  }
  objects.sort((a, b) => b.LastModified - a.LastModified);
  console.log();
  for (const object of objects.slice(0, 30)) {
    console.log(`  ${object.LastModified.toISOString()}  ${formatBytes(object.Size).padStart(9)}  ${object.Key}`);
  }
  console.log(`\n  Restore one with: npm run ops -- restore <key>\n`);
}

async function restore({ args, rest, aws, manifest }) {
  requireLocalDatabase(manifest);
  const key = rest[0];
  if (!key || !/^backups\/mongo\/[A-Za-z0-9/_.-]+$/.test(key)) {
    fail('Usage: npm run ops -- restore backups/mongo/2026/10/mongo-20261030T030000Z.archive.gz   (see: npm run ops -- backups)');
  }
  log.warn(`Every collection contained in ${key} will REPLACE the current data.`);
  log.warn('Tip: run "npm run ops -- backup" first so you can undo this.');
  if (!args.yes && (await ask('Type "restore" to continue:')) !== 'restore') fail('Cancelled.');

  await runAndReport(aws, manifest, [`/opt/app/bin/restore-mongo.sh '${key}'`], 'ops restore', 3600);
  log.ok('Restore complete');
}

const COMMANDS = {
  status,
  logs,
  shell,
  exec: execCommand,
  redeploy,
  rollback,
  backup,
  backups,
  restore,
};

runMain(main);
