// Helpers shared by deploy.mjs, destroy.mjs and ops.mjs: logging, running commands,
// reading the environment configuration and calling Terraform. Node.js built-ins only.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const INFRA_DIR = path.join(ROOT, 'infra');

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : String(text));
export const color = {
  bold: paint(1),
  dim: paint(2),
  red: paint(31),
  green: paint(32),
  yellow: paint(33),
  cyan: paint(36),
};

export const log = {
  step: (message) => console.log(`\n${color.cyan('==>')} ${color.bold(message)}`),
  info: (message) => console.log(`    ${message}`),
  ok: (message) => console.log(`    ${color.green('✔')} ${message}`),
  warn: (message) => console.log(`    ${color.yellow('!')} ${message}`),
};

/** Prints the output of a command that ran on the server. */
export function printCommandOutput({ stdout, stderr }) {
  const text = [stdout, stderr].filter(Boolean).join('\n').trimEnd();
  if (text) console.log(text.split('\n').map((line) => `    ${color.dim('│')} ${line}`).join('\n'));
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** An expected failure: printed without a stack trace. */
export class CliError extends Error {}

export function fail(message) {
  throw new CliError(message);
}

function friendlyMessage(err) {
  if (err instanceof CliError) return err.message;
  const text = `${err?.name ?? ''} ${err?.message ?? ''}`;
  if (/CredentialsProviderError|Could not load credentials/i.test(text)) {
    return 'No AWS credentials found. Run "aws configure" (or "aws sso login"), or pass --profile <name>.';
  }
  if (/ExpiredToken|token has expired/i.test(text)) {
    return 'Your AWS credentials have expired. Log in again (e.g. "aws sso login") and retry.';
  }
  return null;
}

/** Runs an async main() and turns errors into a readable message + exit code 1. */
export function runMain(main) {
  main().catch((err) => {
    const message = friendlyMessage(err);
    if (message) console.error(`\n${color.red('✖')} ${message}`);
    else console.error(`\n${color.red('✖')} Unexpected error:`, err);
    process.exitCode = 1;
  });
}

// ---------------------------------------------------------------------------
// Running commands
// ---------------------------------------------------------------------------

/** Runs a program with inherited stdio (the user sees its output). Throws on failure. */
export function run(command, args = [], { cwd = ROOT, env, input } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    input,
    stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    windowsHide: true,
  });
  if (result.error) fail(`Could not start "${command}": ${result.error.message}`);
  if (result.status !== 0) fail(`"${command} ${args[0] ?? ''}" failed with exit code ${result.status} (see output above).`);
}

/** Runs a program and returns its trimmed stdout, or null on failure when allowFailure is set. */
export function capture(command, args = [], { cwd = ROOT, env, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    if (allowFailure) return null;
    fail(`"${command} ${args.join(' ')}" failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

/** Runs a whole command line through the system shell, e.g. "npm ci && npm run build". */
export function runShell(commandLine, { cwd = ROOT, env } = {}) {
  const result = spawnSync(commandLine, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: true,
    windowsHide: true,
  });
  if (result.error) fail(`Could not run "${commandLine}": ${result.error.message}`);
  if (result.status !== 0) fail(`"${commandLine}" failed with exit code ${result.status}.`);
}

/** Asks a question on the terminal and returns the trimmed answer. */
export async function ask(question) {
  if (!process.stdin.isTTY) fail('Confirmation required but there is no interactive terminal - re-run with --yes.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`${question} `)).trim();
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Tool checks
// ---------------------------------------------------------------------------

export function checkNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20 || (major === 20 && minor < 19)) fail(`Node.js 20.19 or newer is required (you have ${process.version}).`);
}

export function checkTerraform() {
  const output = capture('terraform', ['version', '-json'], { allowFailure: true });
  if (!output) {
    fail('Terraform not found. Install it (Windows: winget install Hashicorp.Terraform) - https://developer.hashicorp.com/terraform/install');
  }
  const version = JSON.parse(output).terraform_version;
  const [major, minor] = version.split('.').map(Number);
  if (major < 1 || (major === 1 && minor < 11)) fail(`Terraform 1.11 or newer is required (you have ${version}).`);
  return version;
}

export function checkDocker() {
  const version = capture('docker', ['info', '--format', '{{.ServerVersion}}'], { allowFailure: true });
  if (!version) fail('Docker is not running. Start Docker Desktop (or the Docker daemon) and try again.');
  return version;
}

// ---------------------------------------------------------------------------
// Environment configuration (infra/environments/<env>.tfvars)
// ---------------------------------------------------------------------------

const PROJECT_RE = /^[a-z][a-z0-9-]{1,18}[a-z0-9]$/;
const ENV_RE = /^[a-z][a-z0-9]{1,9}$/;

function readTfvarString(text, key) {
  return text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1];
}

/** Works out which environment the command targets from CLI flags and the tfvars file. */
export function resolveTarget(args) {
  const env = args.env ?? 'prod';
  if (!ENV_RE.test(env)) fail(`Invalid --env "${env}": use 2-10 lowercase letters or numbers (prod, dev, staging...).`);

  const tfvarsFile = path.join(INFRA_DIR, 'environments', `${env}.tfvars`);
  const secretsFile = path.join(INFRA_DIR, 'environments', `${env}.secrets.tfvars`);
  const hasTfvars = existsSync(tfvarsFile);
  const text = hasTfvars ? readFileSync(tfvarsFile, 'utf8') : '';

  const project = args.project ?? readTfvarString(text, 'project_name');
  const region = args.region ?? readTfvarString(text, 'aws_region') ?? 'us-east-1';
  if (!project) {
    fail(`No project name: create ${path.relative(ROOT, tfvarsFile)} (copy prod.tfvars) or pass --project <name>.`);
  }
  if (!PROJECT_RE.test(project)) {
    fail(`Invalid project_name "${project}": 3-20 lowercase letters, numbers or hyphens, starting with a letter.`);
  }

  return {
    env,
    project,
    region,
    name: `${project}-${env}`,
    ssmPrefix: `/${project}/${env}`,
    tfvarsFile,
    secretsFile,
    hasTfvars,
    hasSecrets: existsSync(secretsFile),
  };
}

// ---------------------------------------------------------------------------
// Terraform
// ---------------------------------------------------------------------------

/** -var-file / -var arguments shared by apply and destroy. */
export function terraformVarArgs(target, extra = []) {
  const args = [`-var-file=environments/${target.env}.tfvars`];
  if (target.hasSecrets) args.push(`-var-file=environments/${target.env}.secrets.tfvars`);
  args.push(
    `-var=project_name=${target.project}`,
    `-var=environment=${target.env}`,
    `-var=aws_region=${target.region}`,
    ...extra,
  );
  return args;
}

export function terraformInit(target, stateBucket) {
  run('terraform', [
    '-chdir=infra',
    'init',
    '-input=false',
    '-reconfigure',
    `-backend-config=bucket=${stateBucket}`,
    `-backend-config=key=${target.project}/${target.env}/terraform.tfstate`,
    `-backend-config=region=${target.region}`,
  ]);
}

export function terraformOutputs() {
  return JSON.parse(capture('terraform', ['-chdir=infra', 'output', '-json']));
}
