#!/usr/bin/env node
// Deletes EVERYTHING created for one environment, in one command:
//   1. terraform destroy - CloudFront, EC2 + EBS volumes + Elastic IP, VPC, S3 buckets
//      (website, deploy files, MongoDB backups), ECR images, SSM parameters, log groups,
//      alarms, dashboard, budget, IAM roles, GitHub OIDC role...
//   2. the Terraform state bucket (unless --keep-state)
//   3. SSM parameters added by hand under /<project>/<env>/
//   4. a scan for anything still tagged with this project/environment
//
//   npm run destroy                   environment "prod"
//   npm run destroy -- --env dev
//   npm run destroy -- --yes          no confirmation prompt (CI)
import { parseArgs } from 'node:util';
import { GetResourcesCommand, ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { DeleteParametersCommand, GetParametersByPathCommand } from '@aws-sdk/client-ssm';
import { bucketExists, createClients, emptyAndDeleteBucket, getIdentity, stateBucketName } from './lib/aws.mjs';
import {
  ROOT,
  ask,
  checkNodeVersion,
  checkTerraform,
  color,
  fail,
  log,
  resolveTarget,
  run,
  runMain,
  terraformInit,
  terraformVarArgs,
} from './lib/common.mjs';

const HELP = `
Usage: npm run destroy -- [options]     (or: node scripts/destroy.mjs [options])

  --env <name>       Environment to delete (default: prod)
  --profile <name>   AWS CLI profile to use
  --region <region>  Override aws_region from the tfvars file
  --project <name>   Override project_name from the tfvars file
  --keep-state       Keep the Terraform state bucket
  -y, --yes          Don't ask for confirmation
  -h, --help         Show this help
`;

async function main() {
  const { values: args } = parseArgs({
    options: {
      env: { type: 'string' },
      profile: { type: 'string' },
      region: { type: 'string' },
      project: { type: 'string' },
      'keep-state': { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.profile) process.env.AWS_PROFILE = args.profile;

  const target = resolveTarget(args);
  checkNodeVersion();
  checkTerraform();

  const aws = createClients(target.region);
  const identity = await getIdentity(aws.sts);
  const stateBucket = stateBucketName(target, identity.Account);

  console.log(`
${color.red(color.bold('  This permanently deletes the environment and ALL of its data:'))}
    environment   ${color.bold(target.name)}
    account       ${identity.Account}  (${identity.Arn})
    region        ${target.region}

    - CloudFront distribution, website bucket and files
    - EC2 server, its disks (including the MongoDB data volume) and Elastic IP
    - MongoDB backups in S3, backend images in ECR
    - VPC, IAM roles, SSM parameters/secrets, log groups, alarms, dashboard, budget
    - the Terraform state bucket s3://${stateBucket}${args['keep-state'] ? ' (kept: --keep-state)' : ''}
`);

  if (!args.yes) {
    const answer = await ask(`Type ${color.bold(target.name)} to confirm:`);
    if (answer !== target.name) fail('Confirmation did not match - nothing was deleted.');
  }

  if (await bucketExists(aws.s3, stateBucket)) {
    if (!target.hasTfvars) {
      fail(`Terraform needs ${target.tfvarsFile} to destroy the environment. Restore it (same values as when deploying) and retry.`);
    }

    log.step('terraform destroy (deleting CloudFront alone takes 5-15 minutes)');
    terraformInit(target, stateBucket);
    run('terraform', ['-chdir=infra', 'destroy', '-auto-approve', '-input=false', ...terraformVarArgs(target, placeholderVars(target))]);
    log.ok('All Terraform-managed resources are deleted');

    if (args['keep-state']) {
      log.info(`Kept the state bucket s3://${stateBucket}`);
    } else {
      log.step('Deleting the Terraform state bucket');
      await emptyAndDeleteBucket(aws.s3, stateBucket);
      log.ok(`Deleted s3://${stateBucket}`);
    }
  } else {
    log.warn(`State bucket s3://${stateBucket} does not exist: there is no Terraform state to destroy (already deleted?).`);
  }

  // Parameters added by hand (aws ssm put-parameter) are not in the Terraform state.
  const removed = await deleteRemainingParameters(aws.ssm, target.ssmPrefix);
  if (removed > 0) log.ok(`Deleted ${removed} remaining SSM parameter(s) under ${target.ssmPrefix}`);

  await reportLeftovers(target);

  log.step('Done');
  console.log(`
    Not touched (delete yourself if you want):
      - local Docker images:     docker image prune -a
      - GitHub repository variables (if you configured CI/CD)
      - your AWS credentials / CLI profiles on this computer
    Billing can show charges for the current month's usage until the next invoice.
    ${color.dim(`Repository root: ${ROOT}`)}
`);
}

// Terraform validates variables even when destroying. If the external MongoDB URI is no longer
// available (secrets file deleted), pass a dummy value - it is not needed to delete anything.
function placeholderVars(target) {
  if (target.hasSecrets || process.env.TF_VAR_mongodb_uri) return [];
  return ['-var=mongodb_uri=mongodb://placeholder-for-destroy'];
}

async function deleteRemainingParameters(ssm, prefix) {
  const names = [];
  let NextToken;
  do {
    const page = await ssm.send(new GetParametersByPathCommand({ Path: prefix, Recursive: true, NextToken }));
    names.push(...(page.Parameters ?? []).map((parameter) => parameter.Name));
    NextToken = page.NextToken;
  } while (NextToken);
  for (let i = 0; i < names.length; i += 10) {
    await ssm.send(new DeleteParametersCommand({ Names: names.slice(i, i + 10) }));
  }
  return names.length;
}

/** Lists resources still tagged with this project/environment (in the region and us-east-1). */
async function reportLeftovers(target) {
  log.step('Checking for leftover resources (by tag)');
  const leftovers = [];
  for (const region of new Set([target.region, 'us-east-1'])) {
    const client = new ResourceGroupsTaggingAPIClient({ region });
    let PaginationToken;
    do {
      const page = await client.send(
        new GetResourcesCommand({
          TagFilters: [
            { Key: 'Project', Values: [target.project] },
            { Key: 'Environment', Values: [target.env] },
          ],
          PaginationToken,
        }),
      );
      leftovers.push(...(page.ResourceTagMappingList ?? []).map((r) => r.ResourceARN));
      PaginationToken = page.PaginationToken || undefined;
    } while (PaginationToken);
  }

  if (leftovers.length === 0) {
    log.ok('Nothing tagged with this project/environment remains.');
    return;
  }
  log.warn('Still listed (the tag index can lag 5-10 minutes behind deletions):');
  for (const arn of leftovers) log.info(`  ${arn}`);
  log.info('Run "npm run destroy" again later to re-check, or delete these in the AWS console.');
}

runMain(main);
