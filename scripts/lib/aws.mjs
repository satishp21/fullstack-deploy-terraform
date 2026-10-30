// AWS SDK helpers for the deploy / destroy / ops scripts. Credentials come from the
// standard chain: AWS_PROFILE / --profile, `aws configure`, `aws sso login`, env vars,
// or the GitHub Actions OIDC role in CI.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { ECRClient, GetAuthorizationTokenCommand } from '@aws-sdk/client-ecr';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutBucketEncryptionCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketPolicyCommand,
  PutBucketTaggingCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  PutPublicAccessBlockCommand,
  S3Client,
  waitUntilBucketExists,
} from '@aws-sdk/client-s3';
import {
  DescribeInstanceInformationCommand,
  GetCommandInvocationCommand,
  GetParameterCommand,
  SendCommandCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { fail, log, run, sleep } from './common.mjs';

export function createClients(region) {
  return {
    sts: new STSClient({ region }),
    s3: new S3Client({ region, followRegionRedirects: true }),
    ssm: new SSMClient({ region }),
    ecr: new ECRClient({ region }),
    cloudfront: new CloudFrontClient({ region: 'us-east-1' }), // global service
  };
}

export function getIdentity(sts) {
  return sts.send(new GetCallerIdentityCommand({}));
}

// ---------------------------------------------------------------------------
// Terraform state bucket (created before `terraform init`, deleted by destroy)
// ---------------------------------------------------------------------------

export const stateBucketName = (target, accountId) => `${target.project}-${target.env}-tfstate-${accountId}`;

export async function bucketExists(s3, bucket) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch (err) {
    const status = err.$metadata?.httpStatusCode;
    if (status === 404 || err.name === 'NotFound' || err.name === 'NoSuchBucket') return false;
    if (status === 403) fail(`S3 bucket "${bucket}" exists but is not accessible (it may belong to another AWS account).`);
    throw err;
  }
}

/** Creates the private, versioned, encrypted state bucket if needed. Returns true if created. */
export async function ensureStateBucket(s3, { bucket, region, tags }) {
  if (await bucketExists(s3, bucket)) return false;

  await s3.send(
    new CreateBucketCommand({
      Bucket: bucket,
      ...(region === 'us-east-1' ? {} : { CreateBucketConfiguration: { LocationConstraint: region } }),
    }),
  );
  await waitUntilBucketExists({ client: s3, maxWaitTime: 60 }, { Bucket: bucket });

  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: bucket,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    }),
  );
  // Versioning = every previous state is recoverable if a state file ever gets corrupted.
  await s3.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: 'Enabled' } }));
  await s3.send(
    new PutBucketEncryptionCommand({
      Bucket: bucket,
      ServerSideEncryptionConfiguration: {
        Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' }, BucketKeyEnabled: true }],
      },
    }),
  );
  await s3.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: 'expire-old-state-versions',
            Status: 'Enabled',
            Filter: { Prefix: '' },
            NoncurrentVersionExpiration: { NoncurrentDays: 90 },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
          },
        ],
      },
    }),
  );
  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: bucket,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'DenyInsecureTransport',
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:*',
            Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          },
        ],
      }),
    }),
  );
  await s3.send(
    new PutBucketTaggingCommand({
      Bucket: bucket,
      Tagging: { TagSet: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })) },
    }),
  );
  return true;
}

/** Deletes every object version and delete marker, then the bucket itself. */
export async function emptyAndDeleteBucket(s3, bucket) {
  let KeyMarker;
  let VersionIdMarker;
  for (;;) {
    const page = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, KeyMarker, VersionIdMarker }));
    const objects = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].map(({ Key, VersionId }) => ({ Key, VersionId }));
    for (let i = 0; i < objects.length; i += 1000) {
      const result = await s3.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects.slice(i, i + 1000), Quiet: true } }),
      );
      if (result.Errors?.length) fail(`Could not empty ${bucket}: ${result.Errors[0].Code} ${result.Errors[0].Message}`);
    }
    if (!page.IsTruncated) break;
    KeyMarker = page.NextKeyMarker;
    VersionIdMarker = page.NextVersionIdMarker;
  }
  await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
}

// ---------------------------------------------------------------------------
// Deploy manifest (written by Terraform to SSM: <prefix>/deploy/manifest)
// ---------------------------------------------------------------------------

export async function readManifest(ssm, target) {
  const name = `${target.ssmPrefix}/deploy/manifest`;
  try {
    const { Parameter } = await ssm.send(new GetParameterCommand({ Name: name }));
    return JSON.parse(Parameter.Value);
  } catch (err) {
    if (err.name === 'ParameterNotFound') {
      fail(`Environment "${target.name}" not found in ${target.region} (no ${name}). Run a full deployment first: npm run deploy -- --env ${target.env}`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Running commands on the server through SSM Run Command (no SSH)
// ---------------------------------------------------------------------------

export async function waitForSsmOnline(ssm, instanceId, timeoutMs = 15 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  while (Date.now() < deadline) {
    const { InstanceInformationList } = await ssm.send(
      new DescribeInstanceInformationCommand({ Filters: [{ Key: 'InstanceIds', Values: [instanceId] }] }),
    );
    if (InstanceInformationList?.[0]?.PingStatus === 'Online') return;
    if (!announced) {
      log.info(`Waiting for ${instanceId} to connect to SSM (takes a few minutes on a new server)...`);
      announced = true;
    }
    await sleep(10_000);
  }
  fail(`${instanceId} did not connect to SSM within ${timeoutMs / 60_000} minutes. Check its status checks and system log in the EC2 console.`);
}

const RUNNING_STATUSES = new Set(['Pending', 'InProgress', 'Delayed']);

/** Runs shell commands on the instance as root and waits for the result. */
export async function runOnInstance(ssm, { instanceId, commands, comment, logGroup, timeoutSeconds = 1800 }) {
  const { Command } = await ssm.send(
    new SendCommandCommand({
      InstanceIds: [instanceId],
      DocumentName: 'AWS-RunShellScript',
      Comment: comment?.slice(0, 100),
      TimeoutSeconds: 600,
      Parameters: { commands, executionTimeout: [String(timeoutSeconds)] },
      ...(logGroup ? { CloudWatchOutputConfig: { CloudWatchOutputEnabled: true, CloudWatchLogGroupName: logGroup } } : {}),
    }),
  );

  const started = Date.now();
  const deadline = started + (timeoutSeconds + 600) * 1000;
  let lastNotice = started;
  while (Date.now() < deadline) {
    await sleep(5_000);
    let invocation;
    try {
      invocation = await ssm.send(new GetCommandInvocationCommand({ CommandId: Command.CommandId, InstanceId: instanceId }));
    } catch (err) {
      if (err.name === 'InvocationDoesNotExist') continue; // not registered yet
      throw err;
    }
    if (RUNNING_STATUSES.has(invocation.Status)) {
      if (Date.now() - lastNotice >= 30_000) {
        log.info(`...still running (${Math.round((Date.now() - started) / 1000)}s)`);
        lastNotice = Date.now();
      }
      continue;
    }
    return {
      commandId: Command.CommandId,
      status: invocation.Status,
      details: invocation.StatusDetails,
      stdout: invocation.StandardOutputContent ?? '',
      stderr: invocation.StandardErrorContent ?? '',
    };
  }
  fail(`Timed out waiting for SSM command ${Command.CommandId}.`);
}

// ---------------------------------------------------------------------------
// Container registry
// ---------------------------------------------------------------------------

/** Logs the local Docker client in to ECR. */
export async function dockerLoginToEcr(ecr) {
  const { authorizationData } = await ecr.send(new GetAuthorizationTokenCommand({}));
  const { authorizationToken, proxyEndpoint } = authorizationData[0];
  const decoded = Buffer.from(authorizationToken, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  const registry = proxyEndpoint.replace(/^https:\/\//, '');
  run('docker', ['login', '--username', decoded.slice(0, separator), '--password-stdin', registry], {
    input: decoded.slice(separator + 1),
  });
  return registry;
}

// ---------------------------------------------------------------------------
// Frontend upload (SDK instead of `aws s3 sync`: correct Content-Type on every OS,
// per-file cache headers, HTML uploaded last)
// ---------------------------------------------------------------------------

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
};

// Build tools put content-hashed files here (Vite: assets/, Create React App: static/).
const HASHED_DIRS = ['assets/', 'static/'];

const isHtml = (key) => /\.html?$/i.test(key);

export function cacheControlFor(key) {
  if (isHtml(key) || /(^|\/)(service-worker|sw)\.js$/.test(key)) return 'no-cache';
  if (HASHED_DIRS.some((dir) => key.startsWith(dir))) return 'public, max-age=31536000, immutable';
  return 'public, max-age=300';
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return entry.isFile() ? [full] : [];
  });
}

async function forEachLimit(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

/**
 * Uploads a static build to S3 (assets first, HTML last) and deletes files that are no
 * longer part of it. Old hashed assets are kept for `keepHashedDays` so visitors who still
 * have the previous page open don't get 404s on lazily loaded chunks.
 */
export async function uploadSite(s3, { bucket, dir, keepHashedDays = 30 }) {
  const files = listFiles(dir).map((file) => ({ file, key: path.relative(dir, file).split(path.sep).join('/') }));
  const put = ({ file, key }) =>
    s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: readFileSync(file),
        ContentType: CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        CacheControl: cacheControlFor(key),
      }),
    );
  await forEachLimit(files.filter((f) => !isHtml(f.key)), 8, put);
  await forEachLimit(files.filter((f) => isHtml(f.key)), 8, put);

  const current = new Set(files.map((f) => f.key));
  const cutoff = Date.now() - keepHashedDays * 86_400_000;
  const stale = [];
  let ContinuationToken;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken }));
    for (const object of page.Contents ?? []) {
      if (current.has(object.Key)) continue;
      const hashed = HASHED_DIRS.some((d) => object.Key.startsWith(d));
      if (!hashed || object.LastModified.getTime() < cutoff) stale.push({ Key: object.Key });
    }
    ContinuationToken = page.NextContinuationToken;
  } while (ContinuationToken);
  for (let i = 0; i < stale.length; i += 1000) {
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: stale.slice(i, i + 1000), Quiet: true } }));
  }

  return { uploaded: files.length, deleted: stale.length };
}

export async function invalidateCdn(cloudfront, distributionId) {
  const { Invalidation } = await cloudfront.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: { CallerReference: `deploy-${Date.now()}`, Paths: { Quantity: 1, Items: ['/*'] } },
    }),
  );
  return Invalidation.Id;
}
