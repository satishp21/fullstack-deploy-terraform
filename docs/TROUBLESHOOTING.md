# Troubleshooting

Start with these three commands, which answer most questions:

```bash
npm run status                    # is the server up, which version, does /api/health answer?
npm run logs -- backend           # what does the app say?
npm run logs -- system --since 1d # bootstrap / deploy / backup logs from the server
```

Contents:
[Setup](#setup-and-credentials) ·
[Terraform](#terraform-errors) ·
[Build](#build-errors) ·
[Server never connects to SSM](#server-never-connects-to-ssm) ·
[Deployment fails](#deployment-fails-did-not-become-healthy) ·
[Runtime errors](#runtime-errors-in-the-browser) ·
[Windows](#windows-specific) ·
[Destroy](#destroy-problems)

---

## Setup and credentials

| Message | Fix |
|---|---|
| `No AWS credentials found` | `aws configure` (access keys) or `aws configure sso` + `aws sso login`. With profiles: `--profile <name>` or `$env:AWS_PROFILE="name"` (PowerShell) / `export AWS_PROFILE=name` |
| `Your AWS credentials have expired` | `aws sso login` (SSO sessions last hours) |
| `Terraform 1.11 or newer is required` | `winget upgrade Hashicorp.Terraform` / `brew upgrade terraform` |
| `Docker is not running` | Start Docker Desktop and wait for "Engine running". On Windows it needs WSL 2 (`wsl --install`) |
| `Cannot find package '@aws-sdk/...'` | Run `npm install` in the repository root |
| `No project name` | Create `infra/environments/<env>.tfvars` with `project_name = "..."`, or pass `--project` |

## Terraform errors

| Error | Cause / fix |
|---|---|
| `EntityAlreadyExists: Provider with url https://token.actions.githubusercontent.com already exists` | The account already has the GitHub OIDC provider. Set `create_github_oidc_provider = false` |
| `BucketAlreadyOwnedByYou` / `ResourceAlreadyExistsException` for a log group | Leftovers from an earlier deployment whose state was lost. Delete them (Tag Editor → filter by `Project`), or `terraform import` them |
| `Your account must be verified before you can add new CloudFront resources` | Happens on brand-new accounts. Open an AWS Support case (Account and billing, free) asking to enable CloudFront, then deploy again |
| `PendingVerification` / `Blocked` when launching EC2 | New accounts are verified for minutes to a few hours after sign-up. Wait and retry |
| `... is not eligible for Free Tier` / Free plan restriction messages | Your account is on the Free plan and the setting isn't allowed there (e.g. an instance type outside the eligible list). Use the defaults or upgrade to the Paid plan (credits still apply) |
| `Unsupported: Your requested instance type ... is not supported in your requested Availability Zone` | Shouldn't happen (AZs are filtered by instance type), unless you changed `az_count`/`instance_type` after creation. Run `npm run deploy` again |
| `Error acquiring the state lock` | A run was interrupted. `terraform -chdir=infra force-unlock <LOCK_ID>` |
| `Invalid value for variable` | The message names the variable and the rule (see `infra/variables.tf`) |
| ACM certificate validation hangs (custom domain) | The domain's NS records at the registrar don't point to the Route 53 hosted zone yet |
| `creating Budget: AccessDeniedException` | Your IAM identity lacks `budgets:*` (not included in some policies). Use an admin identity or set `monthly_budget_usd = 0` |

## Build errors

| Error | Fix |
|---|---|
| `"npm ci" needs .../package-lock.json` | `npm install --prefix <frontend_path>` once; commit the lock file |
| `npm ci` fails: lock file out of sync | Run `npm install` in that folder and commit the updated lock file |
| Docker build: `npm ci` fails inside the image | Same: the backend's lock file is out of sync; or a native module needs build tools. Add `RUN apk add --no-cache python3 make g++` to your Dockerfile |
| `exec format error` in backend logs | Image built for the wrong CPU (e.g. ARM Mac → x86 server). The deploy script builds for the server's platform. If you built the image yourself, use `--platform linux/amd64` (or `linux/arm64` for t4g) |
| Build is very slow on Apple Silicon / for ARM servers | Cross-platform builds use emulation; that's expected |
| `index.html is missing` after the frontend build | Wrong `frontend_build_dir` (`dist` for Vite, `build` for CRA) |

## Server never connects to SSM

The deploy waits up to 15 minutes for `PingStatus = Online`. If it never gets there:

1. **EC2 console → Instances → your instance → Status checks.** Both must pass. If not, look at *Actions → Monitor and troubleshoot → Get system log*.
2. **The instance needs outbound internet**: it must have the Elastic IP associated (*Networking* tab). The public route table needs `0.0.0.0/0 → igw-...`.
3. **IAM**: the instance profile `<name>-app-server` must be attached (*Security* tab). New roles can take a minute to propagate. Reboot the instance once if it was created very recently.
4. **Fleet Manager** (Systems Manager → Fleet Manager) shows whether the agent ever registered.

## Deployment fails (`did not become healthy`)

The deploy output shows `docker compose ps` and the last 100 backend log lines. Typical causes:

| Symptom in logs | Fix |
|---|---|
| `Missing required environment variable X` / `undefined` config | Add `X` to `app_environment` or `app_secrets`, then `npm run deploy` |
| App listens on a different port (e.g. "listening on 5000") | Set `app_port = 5000`, or make the app use `process.env.PORT` |
| Health check 404 | `health_check_path` doesn't exist in your app; add the endpoint or change the path |
| `MongoServerError: Authentication failed` | Password mismatch after a manual change: see [OPERATIONS.md → Rotating secrets](OPERATIONS.md#rotating-secrets) |
| `MongooseServerSelectionError` with Atlas | Add the Elastic IP (`terraform -chdir=infra output elastic_ip`) to Atlas Network Access; check the URI and user |
| `value of X contains a single quote or a newline` | Environment values can't contain `'` or line breaks (base64-encode such values) |
| `bootstrap failed` | Check the bootstrap log: `npm run ops -- exec "tail -50 /var/log/app/bootstrap.log"`. A temporary GitHub/package repository outage is the usual cause. Re-run it: `npm run ops -- exec "/opt/app/bin/bootstrap.sh"`, then deploy again |
| Container restarts with `Killed` / exit code 137 | Out of memory: see the `memory-high` alarm; reduce memory use, or use `t3.small` |

Reproduce locally with the same image:

```bash
docker run --rm -p 8080:8080 -e PORT=8080 -e MONGODB_URI="mongodb://host.docker.internal:27017/app" <ecr-image-uri>
```

## Runtime errors in the browser

| Symptom | Cause / fix |
|---|---|
| `502 Bad Gateway` on `/api/*` | nginx is up but the backend isn't answering (crashed, restarting, wrong `app_port`). `npm run status`, `npm run logs -- backend` |
| `502`/`504` on `/api/*` and nothing in the nginx log | CloudFront can't reach the server: instance stopped, Elastic IP detached, or nginx not running (`npm run ops -- exec "docker ps"`) |
| `504 Gateway Timeout` | A request took longer than 60 s. Make long work asynchronous |
| `403` on `/api/*` | The request didn't come through CloudFront (direct IP access is blocked on purpose), or the origin secret changed without a redeploy: `npm run ops -- redeploy` |
| `403 AccessDenied` (XML) for a page or asset | The file isn't in the bucket (wrong build dir?). Right after the first deploy, wait a few minutes for the bucket policy and OAC to propagate |
| Refreshing `/products/42` gives 404 | Keep `enable_spa_routing = true`; client-side route paths must not contain a dot |
| UI still old after a deploy | The invalidation takes ~1 minute; hard-refresh (Ctrl+F5) |
| CORS or mixed-content errors | The frontend calls an absolute URL (`http://localhost:5000/api`). Use relative `/api` URLs |
| Login cookie not set / `req.secure` false | Add `app.set('trust proxy', 2)` and set cookies with `secure: true, sameSite: 'lax'` |
| `req.ip` is a CloudFront IP | `app.set('trust proxy', 2)` |
| Requests with large bodies get `413` | Raise `client_max_body_size` |
| WebSocket connection fails | Add its path (e.g. `/socket.io/*`) to `api_path_patterns` and connect to the same origin |

## Windows-specific

| Problem | Fix |
|---|---|
| `npm.ps1 cannot be loaded because running scripts is disabled` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or use `npm.cmd run deploy` |
| `bad interpreter: /bin/bash^M` or `$'\r': command not found` on the server | Shell scripts got Windows line endings. Terraform already converts CRLF → LF on upload; keep the `.gitattributes` file so Git doesn't convert them back |
| `copy`/`cp` confusion in the docs | PowerShell supports `cp` and `copy`; cmd only `copy` |
| Paths in tfvars | Use forward slashes: `backend_path = "C:/projects/shop/server"` |

## Destroy problems

See [TEARDOWN.md → If destroy fails halfway](TEARDOWN.md#if-destroy-fails-halfway).

---

### Getting more detail

- Terraform debug logs: `$env:TF_LOG="DEBUG"` (PowerShell) or `TF_LOG=DEBUG`, then re-run.
- A specific SSM command's full output: Systems Manager → Run Command → *Command history* → the command → *Output*, or log group `/<project>/<env>/ssm`.
- Server-side files: `/var/log/app/*.log`, `/var/log/cloud-init-output.log`, `/opt/app/state/` (current/previous tag, bootstrap markers).
