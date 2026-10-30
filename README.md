# MERN on AWS with Terraform

Deploy any **MERN app** (MongoDB, Express, React, Node.js) to AWS with **one command**, and delete everything again with **one command**.

The stack is built to fit the **AWS Free Tier** while following production practices: HTTPS, a CDN, private storage, no SSH, secrets in an encrypted store, health-checked deployments with automatic rollback, backups, monitoring, alarms and a cost budget. Every paid alternative is documented, so you know what to switch on when you have a paid account.

```text
npm run deploy     # creates the infrastructure (Terraform) and deploys the app, prints the URL
npm run destroy    # deletes every resource of the environment, including the Terraform state
```

A sample MERN app (a task list) lives in [`app/`](app/). Replace it with your own app by changing a few paths, as described in [Deploy your own MERN app](#9-deploy-your-own-mern-app).

---

## Table of contents

1. [What you get](#1-what-you-get)
2. [Architecture](#2-architecture)
3. [AWS services used and why](#3-aws-services-used-and-why)
4. [Repository layout](#4-repository-layout)
5. [Prerequisites (one-time setup)](#5-prerequisites-one-time-setup)
6. [Quick start: deploy the sample app](#6-quick-start-deploy-the-sample-app)
7. [What `npm run deploy` does, step by step](#7-what-npm-run-deploy-does-step-by-step)
8. [Configuration reference](#8-configuration-reference)
9. [Deploy your own MERN app](#9-deploy-your-own-mern-app)
10. [Day-2 operations](#10-day-2-operations)
11. [CI/CD with GitHub Actions](#11-cicd-with-github-actions)
12. [Free tier, costs and paid upgrades](#12-free-tier-costs-and-paid-upgrades)
13. [Tear everything down](#13-tear-everything-down)
14. [Security model](#14-security-model)
15. [Troubleshooting](#15-troubleshooting)
16. [FAQ](#16-faq)
17. [Command reference (every option)](#17-command-reference)
18. [Terraform outputs](#18-terraform-outputs)

Deep-dive documents:

| Document | Contents |
|---|---|
| [docs/AWS_SERVICES.md](docs/AWS_SERVICES.md) | Every AWS service in detail: purpose, configuration, the Terraform file that creates it, free-tier limits, paid alternative |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Request flow, deployment flow, server boot sequence, failure scenarios and design decisions |
| [docs/DEPLOY_YOUR_OWN_APP.md](docs/DEPLOY_YOUR_OWN_APP.md) | Checklist and recipes for deploying other MERN apps (CRA, TypeScript, monorepos, Atlas, websockets…) |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Runbook: logs, shell, rollback, backups/restore, scaling, patching, secrets, alarms |
| [docs/COSTS_AND_UPGRADES.md](docs/COSTS_AND_UPGRADES.md) | Free tier (old and new AWS plans), cost estimates, the paid production architecture |
| [docs/TEARDOWN.md](docs/TEARDOWN.md) | How destroy works, what it deletes, how to verify nothing is left |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common errors and fixes |

---

## 1. What you get

**Infrastructure** (Terraform, `infra/`)
- A dedicated **VPC** with public and private subnets in 2 availability zones.
- One **EC2** server (free-tier micro instance, auto-selected for your account) running **Docker Compose**:
  - **nginx** reverse proxy. It only accepts traffic from CloudFront that carries a secret header.
  - your **Express API** image, pulled from **ECR**.
  - **MongoDB 8** on its own encrypted EBS volume, with daily backups to S3. Alternatively, use MongoDB Atlas or any external MongoDB.
- **CloudFront** gives one HTTPS URL for everything. `/api/*` goes to the server. Everything else is the React build, served from a **private S3 bucket** at the edge.
- **SSM Parameter Store** for configuration and secrets, **Run Command** for deployments and **Session Manager** for shell access. No SSH and no open admin ports.
- **CloudWatch**: logs from every container, memory/disk metrics, an app-health metric, 9 alarms, a dashboard.
- **SNS** email alerts, an **AWS Budget** alert, and optional **GitHub Actions** CI/CD through **OIDC** (no stored AWS keys).

**Tooling** (Node.js scripts, `scripts/`). They work the same on Windows, macOS, Linux and CI.
- `npm run deploy` creates the state bucket, runs `terraform apply`, builds and pushes the backend image, builds and uploads the frontend, rolls out with health checks and automatic rollback, invalidates the CDN and runs a smoke test.
- `npm run destroy` deletes everything, including the state bucket, then scans for leftovers.
- `npm run ops -- <command>` covers status, logs, shell, exec, redeploy, rollback, backup, backups and restore.

**Sample app** (`app/`)
- `app/backend`: Express 5 + Mongoose 9 REST API (`/api/tasks`, `/api/health`), JSON logging, graceful shutdown, multi-stage non-root Dockerfile.
- `app/frontend`: React 19 + Vite 8 task list that calls the API with relative `/api` URLs.
- `app/docker-compose.yml` for local development.

---

## 2. Architecture

```text
                                  Users (browser, mobile)
                                            │  HTTPS (free CloudFront certificate, or your domain via ACM)
                                            ▼
                ┌──────────────────────────────────────────────────────────┐
                │ Amazon CloudFront - global CDN, one domain for everything │
                │   /api/*  -> API origin    (never cached, all headers)    │
                │   /*      -> S3 origin     (cached, SPA routing function) │
                └───────────────┬───────────────────────────┬──────────────┘
          Origin Access Control │                           │ HTTP :80 + secret X-Origin-Verify header
          (signed requests)     ▼                           ▼ (security group: CloudFront IP ranges only)
   ┌────────────────────────────┐   ┌──────────────────── VPC 10.20.0.0/16 ─────────────────────────┐
   │ S3  <name>-web-<account>   │   │  Public subnet (AZ 1)                                          │
   │ React build (private)      │   │  ┌──────────── EC2 (t2/t3.micro, Amazon Linux 2023) ────────┐ │
   └────────────────────────────┘   │  │ Elastic IP (stable origin)   IMDSv2 · encrypted disks     │ │
                                    │  │ Docker Compose:                                            │ │
                                    │  │   nginx :80 ──► backend (Express, from ECR) ──► mongo      │ │
                                    │  │                                     EBS volume /data ──┘   │ │
                                    │  └────────────────────────────────────────────────────────────┘ │
                                    │  Public subnet (AZ 2) · Private subnets (AZ 1, 2) - ready for    │
                                    │  paid upgrades (ALB, private servers, DocumentDB)                │
                                    └──────────────────────────────────────────────────────────────────┘

  Around it: ECR (backend images) · S3 artifacts bucket (server files + MongoDB backups) · SSM (Parameter
  Store, Run Command, Session Manager) · CloudWatch (logs, metrics, alarms, dashboard) · SNS (email) ·
  AWS Budgets · IAM (server role, GitHub OIDC role) · S3 state bucket (Terraform state + locking)
```

**Request flow**: the browser loads `https://<app>/`. CloudFront serves `index.html` and the JS/CSS bundles from S3, cached at the edge. The React app calls `/api/...` on the same domain, so no CORS is needed. CloudFront forwards those calls to nginx on the EC2 server and adds the secret header. nginx checks the header and proxies to the Express container, which talks to MongoDB on the private Docker network.

More detail, including failure scenarios, is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 3. AWS services used and why

| AWS service | What it does in this project | Free tier | With a paid account you could use |
|---|---|---|---|
| **VPC** (subnets, internet gateway, route tables, S3 gateway endpoint) | Isolated network; the S3 endpoint keeps S3 traffic private | Free | **NAT Gateway** (~$33/mo) to move the server to private subnets |
| **EC2** | The app server running Docker | 750 h/month of t2.micro/t3.micro for 12 months (accounts before 15 Jul 2025); credits for newer accounts | **ALB + Auto Scaling group** across AZs, or **ECS Fargate** |
| **EBS** | 20 GB root disk + 10 GB MongoDB data disk (gp3, encrypted) | 30 GB (12 months) | Bigger volumes, automated snapshots (**AWS Backup** / **DLM**) |
| **Elastic IP** (public IPv4) | Stable address used as the CloudFront API origin | 750 h/month public IPv4 for 12 months | Not needed behind an ALB |
| **CloudFront** (+ Functions, OAC) | HTTPS, CDN, routing `/api` vs static, security headers, SPA routing | Always free: 1 TB out, 10 M requests, 2 M function runs | **AWS WAF**, CloudFront flat-rate plans, VPC origins |
| **S3** | Website files, server deployment files, MongoDB backups, Terraform state | 5 GB (12 months) | Cross-region replication of backups |
| **ECR** | Private Docker registry for backend images (scan on push) | 500 MB/month (12 months) | Enhanced scanning (Inspector) |
| **Systems Manager** | Parameter Store (config + secrets), Run Command (deploys), Session Manager (shell) | Standard parameters, Run Command and Session Manager are free | **Secrets Manager** ($0.40/secret/mo) for automatic rotation |
| **CloudWatch** | Container logs, CloudWatch agent metrics, 9 alarms, dashboard | Always free: 10 custom metrics, 10 alarm metrics, 5 GB logs, 3 dashboards | Synthetics canaries, Container Insights |
| **SNS** | Email notifications for alarms | Always free: 1,000 emails/month | SMS, Slack via AWS Chatbot |
| **AWS Budgets** | Emails at 50%/80%/forecast 100% of a monthly budget | No charge for this budget | Budget actions |
| **IAM / STS** | Server role (instance profile), GitHub Actions role via OIDC | Free | IAM Identity Center for people |
| **KMS** (AWS-managed keys) | Encryption of EBS volumes and SecureString parameters | Free | Customer-managed keys ($1/key/mo) |
| **ACM** *(optional)* | TLS certificate for your own domain | Free | - |
| **Route 53** *(optional)* | DNS for your own domain | **Not free**: $0.50/hosted zone/month | Health checks, failover routing |
| **MongoDB** | Container on the server (default) or MongoDB Atlas M0 (free, managed) | Free | **Atlas M10+** or **Amazon DocumentDB** |

Each service is explained in detail in [docs/AWS_SERVICES.md](docs/AWS_SERVICES.md).

### Why not the "textbook" production setup?

A classic production layout uses an Application Load Balancer, servers in private subnets behind a NAT gateway, a managed database and multiple instances in several availability zones. On AWS that costs roughly **$110-150/month** before any traffic. This project keeps the production practices that cost nothing: TLS, CDN, least-privilege IAM, no SSH, encrypted storage, secrets management, health checks, rollback, backups, monitoring and budgets. Only the paid redundancy is left out, and it is documented. See [docs/COSTS_AND_UPGRADES.md](docs/COSTS_AND_UPGRADES.md#the-paid-production-architecture).

---

## 4. Repository layout

```text
.
├── README.md                     you are here
├── package.json                  deploy tooling (npm run deploy / destroy / ops / status / logs)
├── .gitignore                    keeps Terraform state, secrets files, node_modules and builds out of git
├── .gitattributes                forces LF line endings (shell scripts break with Windows CRLF)
├── app/                          SAMPLE MERN APP - replace with yours
│   ├── README.md                 sample app: API endpoints, local development
│   ├── backend/                  Express API + Dockerfile
│   ├── frontend/                 React (Vite) app
│   └── docker-compose.yml        local development (MongoDB + API), not used in AWS
├── infra/                        TERRAFORM
│   ├── versions.tf  providers.tf  backend.tf      Terraform/provider versions, S3 remote state
│   ├── variables.tf  locals.tf                    all settings (documented)
│   ├── main.tf                   instance type/AZ selection + module wiring
│   ├── config.tf                 SSM parameters: app env vars, secrets, deploy state
│   ├── outputs.tf                URLs, IDs, commands
│   ├── environments/
│   │   ├── prod.tfvars           <- YOUR CONFIGURATION (one file per environment)
│   │   └── example.secrets.tfvars   template for <env>.secrets.tfvars (git-ignored)
│   └── modules/
│       ├── network/              VPC, subnets, routes, S3 endpoint, optional NAT/flow logs
│       ├── ecr/                  container registry + lifecycle policy
│       ├── app-server/           EC2, EIP, security group, IAM, EBS, artifacts bucket, log groups
│       │   ├── templates/user-data.sh.tftpl     first-boot script
│       │   └── files/            everything the server runs (uploaded to S3)
│       │       ├── docker-compose.yml           nginx + backend + mongo
│       │       ├── nginx/default.conf.template  reverse proxy, origin check, websockets
│       │       ├── mongo/init-app-user.js       least-privilege DB user
│       │       ├── bin/*.sh                     bootstrap, deploy (with rollback), backup, restore, health metric
│       │       └── systemd/*                    timers for health metric and backups
│       ├── cdn/                  CloudFront, S3 website bucket, OAC, SPA function, ACM/Route 53
│       ├── monitoring/           SNS, alarms, dashboard, budget
│       └── github-oidc/          GitHub Actions deploy role (optional)
├── scripts/                      NODE.JS TOOLING (cross-platform)
│   ├── deploy.mjs                one-command deploy
│   ├── destroy.mjs               one-command teardown
│   ├── ops.mjs                   status, logs, shell, exec, rollback, backups...
│   └── lib/                      shared helpers (AWS SDK, Terraform, process handling)
├── templates/
│   ├── Dockerfile.node           generic backend Dockerfile (used if your backend has none)
│   └── Dockerfile.node.dockerignore   files kept out of that image (node_modules, .env, .git...)
├── .github/workflows/deploy.yml  CI/CD (GitHub Actions + OIDC)
└── docs/                         detailed documentation
```

---

## 5. Prerequisites (one-time setup)

### 5.1 Tools

| Tool | Version | Windows (PowerShell) | macOS (Homebrew) |
|---|---|---|---|
| Node.js | 20.19+ (24 LTS recommended) | `winget install OpenJS.NodeJS.LTS` | `brew install node` |
| Terraform | 1.11+ | `winget install Hashicorp.Terraform` | `brew tap hashicorp/tap && brew install hashicorp/tap/terraform` |
| Docker Desktop | any recent | `winget install Docker.DockerDesktop` | `brew install --cask docker` |
| AWS CLI | v2 recommended | `winget install Amazon.AWSCLI` | `brew install awscli` |
| Session Manager plugin *(for `ops shell`)* | latest | [installer](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) | `brew install --cask session-manager-plugin` |
| Git | any | `winget install Git.Git` | `xcode-select --install` |

On Linux, use your package manager or the vendors' install pages. Check everything with:

```bash
node --version && terraform version && docker version && aws --version
```

> The deploy scripts use the **AWS SDK for JavaScript**, so the AWS CLI is only needed for `aws configure` and the interactive shell. AWS CLI **v1** works, but v2 is recommended (v1 is in maintenance mode and lacks `aws sso login`).

> **Windows PowerShell:** if `npm run ...` fails with *"npm.ps1 cannot be loaded because running scripts is disabled"*, run this once:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or call `npm.cmd` instead of `npm`.
> Docker Desktop needs WSL 2 (`wsl --install`).

### 5.2 AWS account and credentials

1. **Create an AWS account** at <https://aws.amazon.com/free>. Accounts created on or after 15 July 2025 receive Free Tier **credits**; older accounts have the classic 12-month free tier. See [section 12](#12-free-tier-costs-and-paid-upgrades).
2. **Don't use the root user for deployments.** Sign in as root once, enable MFA on it, then create a deployment identity:
   - **Simplest**: IAM → Users → *Create user* (e.g. `deployer`) → *Attach policies directly* → `AdministratorAccess` → create the user → *Security credentials* → *Create access key* → "Command Line Interface (CLI)".
   - **Better (no long-lived keys)**: IAM Identity Center → create a user with the `AdministratorAccess` permission set → `aws configure sso`.
   - Why admin? The stack creates IAM roles, VPCs, CloudFront, budgets and more. On a personal or learning account that is the practical choice. In a company account, ask for a role scoped to these services (list in [docs/AWS_SERVICES.md](docs/AWS_SERVICES.md#permissions-needed-to-deploy)).
3. **Configure the CLI** with the access key:

   ```bash
   aws configure
   # AWS Access Key ID:     AKIA...
   # AWS Secret Access Key: ....
   # Default region name:   us-east-1        (any region; the deploy uses aws_region from tfvars)
   # Default output format: json
   ```

   To use a named profile instead, run `aws configure --profile myprofile` and then `npm run deploy -- --profile myprofile`, or set `AWS_PROFILE`.
4. **Verify**: `aws sts get-caller-identity` shows your account ID and user.
5. **Recommended**: in the Billing console, open *Billing preferences* and turn on **Free Tier usage alerts** and **CloudWatch billing alerts**.

---

## 6. Quick start: deploy the sample app

```bash
# 0. From the repository root
cd C:\aws_learning\terraform-with-cluade          # (or wherever you cloned it)

# 1. Install dependencies (once)
npm install                                       # deploy tooling (AWS SDK)
npm install --prefix app/frontend                 # creates app/frontend/package-lock.json (needed by "npm ci")
npm install --prefix app/backend                  # creates app/backend/package-lock.json (reproducible images)

# 2. Configure: open infra/environments/prod.tfvars and set at least
#      project_name = "mern-demo"        (unique, lowercase)
#      aws_region   = "us-east-1"        (or a region near you, e.g. ap-south-1, eu-west-1)
#      alert_email  = "you@example.com"  (alarms + budget emails)
#    Secrets (optional for the sample app): copy the template and fill it in
#      copy infra\environments\example.secrets.tfvars infra\environments\prod.secrets.tfvars   (cp on macOS/Linux)

# 3. Optional but recommended: check the Terraform code (no AWS calls, no cost)
terraform -chdir=infra init -backend=false
terraform -chdir=infra validate

# 4. Start Docker Desktop, then deploy
npm run deploy
```

What you'll see:
1. Prerequisite checks and the AWS account you are deploying to.
2. The **Terraform plan** (about 90 resources). Type `yes`. The first apply takes **~8-12 minutes**, mostly CloudFront.
3. The backend image is built and pushed, the React app is built, and the server pulls the image and starts the containers. On first boot the new server installs Docker and pulls MongoDB, which adds about 3-5 minutes. On `t3.micro` it can take **10-15 minutes**, because new T3 instances start with zero CPU credits in the cost-safe `standard` mode and run throttled until they earn some. This only happens once per server.
4. The frontend is uploaded, the CDN cache is invalidated, and a smoke test calls `/api/health`.
5. A summary with your URL:

```text
==> Done
    App:          https://d1234abcd.cloudfront.net
    API health:   https://d1234abcd.cloudfront.net/api/health
    Dashboard:    https://us-east-1.console.aws.amazon.com/cloudwatch/home?...
```

Open the URL and add a few tasks. If you set `alert_email`, **confirm the two subscription emails** from "AWS Notifications" (one for regional alarms, one for the CloudFront alarm in us-east-1).

**Later deployments**:

| You changed... | Run |
|---|---|
| Application code only | `npm run deploy -- --app-only` (skips Terraform, ~2-3 min) |
| Only the frontend / only the backend | `npm run deploy -- --app-only --skip-backend` / `--skip-frontend` |
| tfvars / Terraform code (also deploys the app) | `npm run deploy` |
| Infrastructure only, no app build | `npm run deploy -- --infra-only` |
| Env vars or secrets only | `npm run deploy -- --infra-only`, then `npm run ops -- redeploy` |
| Go back to an older backend image | `npm run ops -- rollback` (or `npm run deploy -- --app-only --skip-frontend --tag <tag>`) |
| Patch the server OS (fresh Amazon Linux AMI) | `npm run deploy -- --replace-server` |
| Deploy without prompts (scripts/CI) | add `--yes` |

Every option is listed in [section 17](#17-command-reference).

**Local development** (no AWS needed):

```bash
cd app && docker compose up --build              # MongoDB + API on http://localhost:8080
npm run dev --prefix app/frontend                # React on http://localhost:5173 (proxies /api to :8080)
```

`app/docker-compose.yml` is only for your machine. On AWS the server uses `infra/modules/app-server/files/docker-compose.yml`. The sample API's endpoints and other ways to run it locally are in [app/README.md](app/README.md).

---

## 7. What `npm run deploy` does, step by step

| # | Step | Where | Details |
|---|---|---|---|
| 1 | Checks Node, Terraform, Docker and your AWS identity | your machine | Fails early with a clear message (e.g. "Docker is not running") |
| 2 | Creates the **state bucket** `<project>-<env>-tfstate-<account>` if missing | S3 | Private, versioned, encrypted, TLS-only. Terraform state holds generated passwords, so it is protected |
| 3 | `terraform init` with that bucket (S3-native locking, no DynamoDB) | your machine | `-reconfigure` makes switching environments safe |
| 4 | `terraform apply` with `environments/<env>.tfvars` (+ `<env>.secrets.tfvars` if present) | AWS | Creates or updates every resource. Writes a **deploy manifest** to SSM |
| 5 | Builds the backend image for the server's CPU architecture and pushes it to ECR | Docker → ECR | Unique, immutable tag `YYYYMMDD-HHMMSS-<git sha>`. Uses `templates/Dockerfile.node` if your backend has no Dockerfile |
| 6 | Runs your frontend build command | your machine | Default `npm ci && npm run build`, with `frontend_build_env` variables |
| 7 | **Rolls out the backend** via SSM Run Command → `/opt/app/bin/deploy-app.sh <tag>` | EC2 | Syncs server files from S3, renders env files from Parameter Store, pulls images, `docker compose up --wait`. **If health checks fail, the previous version is restored** and the deploy fails |
| 8 | Records the tag as "last known good" in SSM | SSM | Used when the server reboots or is replaced |
| 9 | Uploads the frontend (assets first, HTML last, correct Content-Type and Cache-Control) and deletes stale files | S3 | Hashed assets are cached for 1 year, HTML is revalidated on every request |
| 10 | Invalidates the CloudFront cache (`/*`) | CloudFront | 1 of 1,000 free invalidation paths per month |
| 11 | Smoke test `GET <app>/api/health` | internet | Prints the response |

`--app-only` skips steps 2-4 and reads everything it needs from the SSM deploy manifest, which is also how CI deploys.

All options: [section 17](#17-command-reference), or `npm run deploy -- --help`.

---

## 8. Configuration reference

Configuration lives in **`infra/environments/<env>.tfvars`**, one file per environment. **Secrets** go in **`infra/environments/<env>.secrets.tfvars`**, which is git-ignored and loaded automatically. Create it from the template with `copy infra\environments\example.secrets.tfvars infra\environments\prod.secrets.tfvars` (`cp` on macOS/Linux). Every variable is also described in [`infra/variables.tf`](infra/variables.tf), and Terraform rejects invalid values with a clear message before creating anything.

### Project
| Variable | Default | Description |
|---|---|---|
| `project_name` | *(required)* | Prefix of all resource names; 3-20 lowercase letters, digits, hyphens |
| `environment` | `prod` | Set automatically from `--env` |
| `aws_region` | `us-east-1` | Region for everything regional |
| `tags` | `{}` | Extra tags on every resource |

### Network
| Variable | Default | Description |
|---|---|---|
| `vpc_cidr` | `10.20.0.0/16` | VPC address range |
| `az_count` | `2` | Availability zones with subnets (1-3) |
| `enable_nat_gateway` | `false` | **PAID** (~$33/mo): internet for private subnets |
| `enable_vpc_flow_logs` | `false` | Rejected-traffic logs to CloudWatch |

### App server
| Variable | Default | Description |
|---|---|---|
| `instance_type` | `""` (auto) | Empty picks your account's free micro type (`t2.micro` or `t3.micro`). Examples: `t3.small` (2 GiB RAM), `t4g.small` (ARM; images are built for arm64 automatically). A type change within the same CPU family is a stop/start; switching x86 ↔ ARM **replaces** the server (data volume and Elastic IP are kept) |
| `cpu_credits` | `standard` | `standard` never bills for CPU bursts, but a new T3/T4g starts with zero credits, so its first boot is slow. `unlimited` bursts freely and bills ~$0.05/vCPU-hour for sustained use above baseline |
| `root_volume_size_gb` | `20` | OS, Docker images, swap |
| `swap_size_mb` | `2048` | Swap file, important on 1 GiB instances |
| `docker_compose_version` | `v2.40.3` | Compose plugin release on the server |
| `nginx_image` | `nginx:stable-alpine` | Reverse proxy image (must be Alpine-based: its health check uses `wget`) |

### Backend
| Variable | Default | Description |
|---|---|---|
| `backend_path` | `app/backend` | Folder with the backend `package.json` (relative to repo root, or absolute) |
| `backend_dockerfile` | `""` | Custom Dockerfile path; default is `<backend_path>/Dockerfile` or the generic template |
| `app_port` | `8080` | Port the API listens on; the container gets `PORT=<app_port>` |
| `health_check_path` | `/api/health` | Must answer HTTP 2xx when healthy and must match one of `api_path_patterns`. Used for rollouts, the `app-unhealthy` alarm and the smoke test |
| `api_path_patterns` | `["/api/*"]` | Paths CloudFront routes to the backend (e.g. add `"/socket.io/*"`) |
| `app_environment` | `{}` | Non-secret env vars for the backend (SSM `String`) |
| `app_secrets` | `{}` | Secret env vars (SSM `SecureString`). **Use `<env>.secrets.tfvars`** |
| `client_max_body_size` | `10m` | Maximum request body (uploads) |

### Frontend
| Variable | Default | Description |
|---|---|---|
| `frontend_path` | `app/frontend` | Folder with the React `package.json` |
| `frontend_build_command` | `npm ci && npm run build` | Run inside `frontend_path` |
| `frontend_build_dir` | `dist` | Build output: `dist` (Vite) or `build` (Create React App) |
| `frontend_build_env` | `{}` | Build-time env vars (`VITE_*`, `REACT_APP_*`). They are public; never put secrets here |
| `enable_spa_routing` | `true` | Serve `index.html` for client-side routes like `/tasks/42` |

### Database
| Variable | Default | Description |
|---|---|---|
| `database_mode` | `local` | `local`: MongoDB container + EBS volume + daily S3 backups. `external`: your own URI (MongoDB Atlas, DocumentDB) |
| `mongodb_uri` | `""` | Required when `external`; put it in the secrets file |
| `mongodb_uri_env_name` | `MONGODB_URI` | Env var name your code reads (`MONGO_URI`, `DATABASE_URL`...) |
| `mongo_database_name` | `app` | Database name in the generated URI (local mode) |
| `mongo_image` | `mongo:8.0` | MongoDB image (local mode) |
| `mongo_cache_size_gb` | `0.25` | WiredTiger cache; raise on bigger instances |
| `data_volume_size_gb` | `10` | MongoDB data volume |
| `backup_schedule` | `*-*-* 03:00:00` | systemd `OnCalendar` expression (UTC) |
| `backup_retention_days` | `14` | Backups older than this are deleted |

### CDN / domain
| Variable | Default | Description |
|---|---|---|
| `domain_name` | `""` | Optional custom domain, e.g. `app.example.com` |
| `route53_zone_id` | `""` | DNS in Route 53: the hosted zone. Terraform creates the certificate and DNS records |
| `acm_certificate_arn` | `""` | DNS elsewhere (Cloudflare, GoDaddy...): an issued ACM certificate in **us-east-1**. You add the CNAME yourself |
| `cloudfront_price_class` | `PriceClass_100` | Edge locations: `_100` (NA + EU), `_200` (+ Asia, ME, Africa), `_All` |

### Monitoring / cost / registry / CI
| Variable | Default | Description |
|---|---|---|
| `alert_email` | `""` | Alarm and budget email (empty = no notifications) |
| `monthly_budget_usd` | `10` | Account-wide monthly budget alert; `0` disables |
| `log_retention_days` | `14` | CloudWatch log retention |
| `ecr_max_image_count` | `10` | Images kept in ECR (rollback window) |
| `github_repository` | `""` | `owner/repo` to enable the GitHub Actions role |
| `github_branch` | `main` | Branch allowed to deploy |
| `create_github_oidc_provider` | `true` | `false` if the account already has the GitHub OIDC provider |

### Multiple environments

```bash
copy infra\environments\prod.tfvars infra\environments\dev.tfvars    # Windows (cp on macOS/Linux)
npm run deploy -- --env dev
npm run destroy -- --env dev
```

Each environment is fully isolated: separate VPC, server, buckets, state and URL. Two running environments double the EC2 hours, and the free tier covers only one instance (750 h/month).

---

## 9. Deploy your own MERN app

The infrastructure is app-agnostic. To deploy another MERN app, **point the tfvars paths at it** and make sure it meets a few conventions.

### 9.1 Checklist for your app

**Backend (Express)**
- [ ] Listens on `process.env.PORT` (or set `app_port` to the port it hard-codes), on all interfaces. `app.listen(port)` already does that; don't bind to `127.0.0.1`.
- [ ] API routes are under **`/api`**. If not, list your prefixes in `api_path_patterns`, e.g. `["/api/*", "/auth/*"]`.
- [ ] Has a **health endpoint** that returns 200, e.g.:
  ```js
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  ```
  Ideally it returns 503 when MongoDB is disconnected (see `app/backend/src/routes/health.routes.js`).
- [ ] Reads the MongoDB connection string from an env var. Set `mongodb_uri_env_name` to its name (`MONGO_URI`, `DATABASE_URL`...).
- [ ] Either has a `Dockerfile`, or a `package.json` with a **`start`** script so the generic `templates/Dockerfile.node` can run it. A `build` script (TypeScript) runs automatically.
- [ ] Optional: `app.set('trust proxy', 2)` (CloudFront + nginx), so `req.ip`, `req.secure` and secure cookies work.

**Frontend (React)**
- [ ] Calls the API with **relative URLs** (`fetch('/api/users')`), or with a base URL from a build variable set to `/api`. Frontend and API share one domain, so CORS isn't needed.
- [ ] Builds with a single command into a folder containing `index.html`.

### 9.2 Steps

1. Put your app somewhere: replace the contents of `app/`, or keep it in another folder and use relative (`../my-app/server`) or absolute (`C:/projects/my-app/server`) paths.
2. Create or edit `infra/environments/prod.tfvars`:

   ```hcl
   project_name = "shopapp"
   aws_region   = "ap-south-1"
   alert_email  = "me@example.com"

   backend_path         = "../shopapp/server"
   app_port             = 5000
   health_check_path    = "/api/health"
   api_path_patterns    = ["/api/*"]
   mongodb_uri_env_name = "MONGO_URI"
   app_environment = {
     LOG_LEVEL  = "info"
     CLIENT_URL = "https://d1234abcd.cloudfront.net"   # if your CORS setup needs it (known after the 1st deploy)
   }
   # NODE_ENV=production and PORT=<app_port> are always set by the platform.

   frontend_path          = "../shopapp/client"
   frontend_build_command = "npm ci && npm run build"
   frontend_build_dir     = "build"                      # Create React App
   frontend_build_env     = { REACT_APP_API_URL = "/api" }
   ```

3. Put secrets in `infra/environments/prod.secrets.tfvars`:

   ```hcl
   app_secrets = {
     JWT_SECRET            = "a-long-random-string"
     CLOUDINARY_API_SECRET = "..."
   }
   ```

4. `npm install --prefix ../shopapp/client` (a lock file is needed by `npm ci`).
5. `npm run deploy`.

Recipes for TypeScript backends, monorepos, Next-style folder layouts, MongoDB Atlas, websockets, file uploads, cron jobs, and copying this toolkit into an existing repository are in **[docs/DEPLOY_YOUR_OWN_APP.md](docs/DEPLOY_YOUR_OWN_APP.md)**.

### 9.3 Using MongoDB Atlas (free M0) instead of the local container

1. Create a free **M0** cluster at <https://cloud.mongodb.com>, ideally in the same AWS region.
2. Create a database user, and copy the `mongodb+srv://...` connection string.
3. In `prod.tfvars` set `database_mode = "external"`. In `prod.secrets.tfvars` set `mongodb_uri = "mongodb+srv://..."`.
4. `npm run deploy`, then in Atlas → *Network Access* add the server's **Elastic IP** (`terraform -chdir=infra output elastic_ip`).

With `external`, no data volume, MongoDB container or backup timer is created. Atlas manages the database (M0 has no automated backups, so use `mongodump` or a paid tier for those).

---

## 10. Day-2 operations

| Task | Command |
|---|---|
| Status (server, version, health, URLs) | `npm run status` |
| Backend logs, last 30 min | `npm run logs` |
| Follow logs live | `npm run logs -- backend --follow` |
| Other logs | `npm run logs -- nginx` / `mongo` / `system` (bootstrap, deploy, backup) / `ssm` (command output) |
| Older logs | `npm run logs -- backend --since 6h` |
| Shell on the server (no SSH) | `npm run ops -- shell` |
| Run a command on the server | `npm run ops -- exec "docker ps"` |
| Restart the current version (after changing env vars/secrets) | `npm run ops -- redeploy` |
| Roll back to the previous image | `npm run ops -- rollback` (or `--tag <tag>`) |
| Back up MongoDB now | `npm run ops -- backup` |
| List backups | `npm run ops -- backups` |
| Restore a backup | `npm run ops -- restore backups/mongo/2026/10/mongo-...archive.gz` |
| Any of these for another environment | add `--env dev` |

**Change an env var or secret:** edit the tfvars or secrets file, then either run a full `npm run deploy` (which also restarts the backend with the new values), or `npm run deploy -- --infra-only` followed by `npm run ops -- redeploy`.

### 10.1 Monitoring and alerts

- **Dashboard**: CloudWatch dashboard `<project>-<env>`, with the link printed after every deploy. It shows API health, CloudFront requests and errors, CPU and CPU credits, memory and swap, and disk usage.
- **Logs**: one CloudWatch log group per source, `/<project>/<env>/backend`, `nginx`, `mongo`, `system` and `ssm`, kept `log_retention_days`. Read them with `npm run logs -- <group>`, or query them with CloudWatch Logs Insights (example queries in [docs/OPERATIONS.md](docs/OPERATIONS.md#logs)).
- **Alarms** (emails go to `alert_email`):

| Alarm | Fires when | Automatic action |
|---|---|---|
| `app-unhealthy` | `/api/health` failing for 3 min, or the server stopped reporting | - |
| `instance-status-check` | OS unresponsive for 3 min | **Reboots the instance** |
| `system-status-check` | AWS host problem | EC2 auto-recovery moves the instance |
| `cpu-high` | CPU > 80% for 15 min | - |
| `cpu-credits-low` | CPU credits near zero for 1 hour (t2/t3/t4g) | - |
| `memory-high` | Memory > 90% for 15 min | - |
| `disk-root-high` / `disk-data-high` | Disk > 85% / MongoDB disk > 80% | - |
| `cloudfront-5xx` | > 5% of requests fail with 5xx | - |
| Budget | 50% / 80% of `monthly_budget_usd` spent, or 100% forecast | - |

What to do for each alarm: [docs/OPERATIONS.md → Alarms](docs/OPERATIONS.md#alarms-what-to-do).

### 10.2 Scaling, patching and a custom domain

- **More CPU/RAM**: set `instance_type = "t3.small"` (2 GiB) and run `npm run deploy`. This is a few minutes of stop/start downtime. Raise `mongo_cache_size_gb` with RAM.
- **Bigger disks**: raise `data_volume_size_gb` / `root_volume_size_gb`, run `npm run deploy -- --infra-only`, then `npm run ops -- exec "xfs_growfs /data"` (data disk) or `npm run ops -- exec "reboot"` (root disk).
- **OS security patches**: `npm run ops -- backup`, then `npm run deploy -- --replace-server` builds a new server from the latest Amazon Linux AMI. The MongoDB data volume and Elastic IP are kept.
- **Custom domain**: if its DNS is in Route 53, set `domain_name` and `route53_zone_id`. If DNS is elsewhere (Cloudflare, GoDaddy...), set `domain_name` and `acm_certificate_arn` (a certificate you requested in ACM, **us-east-1**) and create a CNAME to the `cloudfront_domain_name` output. Then run `npm run deploy`.
- **Rotate generated secrets**: e.g. `npm run deploy -- --infra-only --replace random_password.origin_verify`, then `npm run ops -- redeploy`.

Step-by-step details for all of these are in **[docs/OPERATIONS.md](docs/OPERATIONS.md)**.

---

## 11. CI/CD with GitHub Actions

The workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) deploys the app on every push to `main` that touches `app/`, `templates/` or `scripts/`. It uses **OIDC**, so GitHub gets short-lived credentials for a role that can only deploy this app, and no AWS keys are stored in GitHub.

1. Push this repository to GitHub, **including** `app/frontend/package-lock.json` and `infra/.terraform.lock.hcl`.
2. In `infra/environments/prod.tfvars` set `github_repository = "your-user/your-repo"` (and `github_branch` if not `main`). Run `npm run deploy`.
3. Print the values to store in GitHub:

   ```bash
   terraform -chdir=infra output github_actions_variables
   ```

4. In GitHub → *Settings → Secrets and variables → Actions → Variables*, create `AWS_ROLE_ARN`, `AWS_REGION`, `PROJECT_NAME`, `DEPLOY_ENV` with those values. With the GitHub CLI: `gh variable set AWS_ROLE_ARN --body "arn:aws:iam::..."`.
5. Push a change to `app/`. The workflow runs `node scripts/deploy.mjs --app-only --yes`. You can also start it by hand from the *Actions* tab (*Run workflow*).

Until the `AWS_ROLE_ARN` variable exists, the workflow is skipped rather than failing, so it's safe to push the repository before setting up CI.

Infrastructure changes are applied from your machine (`npm run deploy`), which keeps the CI role minimal. If another project already created the GitHub OIDC provider in your account, set `create_github_oidc_provider = false`.

---

## 12. Free tier, costs and paid upgrades

**AWS changed the Free Tier on 15 July 2025.**

| | Account created **before** 15 Jul 2025 | Account created **on/after** 15 Jul 2025 |
|---|---|---|
| Model | 12-month free tier + "always free" offers | Up to **$200 credits** ($100 at sign-up + up to $100 for completing onboarding activities) + "always free" offers |
| Duration | 12 months from sign-up | Free plan lasts **6 months** or until credits run out; then upgrade to a paid plan (or the account is closed) |
| Free EC2 | 750 h/month of **t2.micro** (t3.micro where t2 doesn't exist) | Paid from credits. Eligible types: t3.micro, t3.small, t4g.micro, t4g.small, c7i-flex.large, m7i-flex.large |
| This stack costs | **≈ $0/month** in the first 12 months, ≈ $14.5/month after | **≈ $14/month**, deducted from credits |

The instance type is auto-selected. Terraform asks AWS which micro types are free-tier eligible for your account and region, and picks `t2.micro` or `t3.micro`.

**Where the money goes (us-east-1, approximate):** EC2 t3.micro ~$7.60 · EBS 30 GB gp3 ~$2.40 · public IPv4 ~$3.65 · everything else $0 within the free allowances (CloudFront, CloudWatch, SNS, SSM, S3 at small sizes).

**Safety nets built in:** a monthly **budget alert** (`monthly_budget_usd`), `cpu_credits = "standard"` (no surprise CPU burst charges), ECR and log retention limits, backup expiry, and `npm run destroy` to remove everything.

**Paid-account upgrades.** Each one is described with its Terraform change and price in [docs/COSTS_AND_UPGRADES.md](docs/COSTS_AND_UPGRADES.md):

| Concern | Free-tier choice here | Paid production choice |
|---|---|---|
| High availability | 1 instance + auto-recovery + reboot alarm | ALB + Auto Scaling group across 2-3 AZs (~$25+/mo) |
| Network isolation | Server in public subnet, inbound only from CloudFront | Private subnets + NAT gateway (~$33/mo) or VPC endpoints |
| Database | MongoDB container + EBS + daily dumps to S3 | MongoDB Atlas M10+ (~$57+/mo) or Amazon DocumentDB (~$60+/mo), PITR backups |
| Containers | Docker Compose on EC2 | ECS on Fargate (no servers to patch, rolling deploys) |
| Secrets | SSM Parameter Store SecureString | AWS Secrets Manager with rotation ($0.40/secret/mo) |
| Edge security | CloudFront + security headers + origin secret | AWS WAF managed rules ($5+/mo) or CloudFront flat-rate plan |
| TLS to origin | HTTP CloudFront → server (restricted + secret header) | ALB with ACM certificate (HTTPS end to end) |
| DNS | `*.cloudfront.net` | Route 53 + custom domain ($0.50/mo), already supported by `domain_name` |
| Threat detection / audit | - | GuardDuty, CloudTrail, AWS Config, Security Hub |

---

## 13. Tear everything down

```bash
npm run destroy                 # environment "prod" (asks you to type the environment name)
npm run destroy -- --env dev    # another environment
```

This deletes **everything** of the environment, in one command:
1. `terraform destroy`: CloudFront, the EC2 server and both EBS volumes (**including the MongoDB data**), the Elastic IP, the VPC, all S3 buckets and their contents (website, deploy files, **backups**), ECR images, SSM parameters and secrets, log groups, alarms, dashboard, budget, SNS topics, IAM roles and the GitHub OIDC role. CloudFront deletion takes 5-15 minutes.
2. The **Terraform state bucket** (keep it with `--keep-state`).
3. Any **SSM parameters added by hand** under `/<project>/<env>/`.
4. A **leftover scan** that lists any resource still tagged with your project and environment (the tag index can lag a few minutes).

Back up anything you need first (`npm run ops -- backup`, then download from S3). Details, partial-failure recovery and manual verification are in [docs/TEARDOWN.md](docs/TEARDOWN.md).

---

## 14. Security model

- **No SSH, no open admin ports.** The security group only allows TCP 80 from CloudFront's managed IP list. Shell access goes through SSM Session Manager (IAM-authenticated and logged).
- **Origin protection.** CloudFront adds a random 48-character `X-Origin-Verify` header, and nginx returns 403 without it. The header is stripped before requests reach your app.
- **HTTPS everywhere for users**: HTTP→HTTPS redirect, TLS from CloudFront, HSTS and other security headers (managed `SecurityHeadersPolicy`).
- **Private S3 buckets** (Block Public Access, TLS-only policies, SSE encryption). The website bucket is readable only by this CloudFront distribution (OAC).
- **Least-privilege IAM.** The server can read only its own parameters, pull only its own image and write only its backups. The GitHub role can only deploy this app.
- **IMDSv2 required** on the instance, which blocks SSRF-style credential theft.
- **Encrypted at rest**: EBS volumes, S3 objects, SecureString parameters, Terraform state.
- **Secrets** are never in git or images. They are generated by Terraform (or read from git-ignored secrets files), stored as SecureString, and written to root-only files on the server at deploy time.
- **Least-privilege database user** for the app (readWrite on its own database). The root user is used only for backups.
- **Containers**: the sample app runs as a non-root user, ECR scans on push, and image tags are immutable.
- **Known trade-off**: the CloudFront → server hop is plain HTTP on AWS's network (restricted and authenticated, not encrypted). See [docs/COSTS_AND_UPGRADES.md](docs/COSTS_AND_UPGRADES.md) for end-to-end TLS options.

---

## 15. Troubleshooting

| Symptom | Fix |
|---|---|
| `No AWS credentials found` | `aws configure` (or `aws sso login`), or `--profile <name>` |
| `Docker is not running` | Start Docker Desktop and wait until it says "running" |
| `needs a package-lock.json` | `npm install --prefix <frontend_path>` once, then commit the lock file |
| Terraform: `BucketAlreadyExists` | `project_name` collides; pick a more unique one |
| `did not connect to SSM` | Instance still booting, or no internet route; see [TROUBLESHOOTING](docs/TROUBLESHOOTING.md#server-never-connects-to-ssm) |
| Deploy fails `did not become healthy` | `npm run logs -- backend`; usually a wrong `app_port`, `health_check_path`, a missing env var, or a DB connection error |
| `/api/...` returns **502/504** | Backend down or wrong port: `npm run status`, `npm run logs -- nginx` |
| `/api/...` returns **403** | Request didn't come through CloudFront, or the origin secret changed without a redeploy: `npm run ops -- redeploy` |
| Page refresh on `/some/route` gives 404 | Keep `enable_spa_routing = true`; route paths must not contain dots |
| Old frontend still shown | Hard-refresh; invalidation takes about a minute |
| Atlas connection timeout | Add the Elastic IP to the Atlas IP access list |

More in **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)**.

---

## 16. FAQ

**Can I run this on an account that already has other resources?** Yes. Everything is namespaced by `project_name-environment` and tagged. The only account-wide singletons are the GitHub OIDC provider (`create_github_oidc_provider`) and the budget, which watches the whole account.

**Does `destroy` touch anything else in my account?** No. It only destroys what is in this environment's Terraform state, plus that environment's state bucket.

**Where is the Terraform state?** In `s3://<project>-<env>-tfstate-<account-id>`, key `<project>/<env>/terraform.tfstate`, with S3-native locking. It contains generated passwords, so treat the bucket as sensitive.

**Can I use `terraform` directly?** Yes. After one `npm run deploy` (which initialises the backend), run for example `terraform -chdir=infra plan -var-file=environments/prod.tfvars -var=environment=prod`.

**How do I see my app's secrets?** `aws ssm get-parameters-by-path --path /<project>/<env>/app --with-decryption`. Anyone with that IAM permission can read them, so protect admin access.

**Is this really production-ready?** It follows production practices and is solid for portfolios, MVPs, internal tools and low-traffic sites. For revenue-critical traffic, add the paid HA pieces (ALB + multiple instances + a managed database) described in [docs/COSTS_AND_UPGRADES.md](docs/COSTS_AND_UPGRADES.md).

**What happens if the server crashes or reboots?** Crashed containers restart automatically. After a reboot, Docker starts the same version again. If the OS hangs, an alarm reboots the instance; if the AWS hardware fails, EC2 moves the instance to healthy hardware. If the instance is replaced, the MongoDB disk and Elastic IP move to the new one, and the last known-good backend version is deployed automatically. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#5-failure-scenarios).

**Is there downtime during a deploy?** A few seconds while the backend container is swapped (the frontend has none). If the new version fails its health check, the old one is started again. Zero-downtime deploys need two servers behind a load balancer (paid, see [docs/COSTS_AND_UPGRADES.md](docs/COSTS_AND_UPGRADES.md)).

**How long do things take?** First `npm run deploy`: ~15-25 minutes (CloudFront + first server boot). Later deploys: ~2-5 minutes. `npm run destroy`: ~10-20 minutes (CloudFront is the slow part).

**Can I stop it at night to save money?** Stopping the EC2 instance in the console pauses the instance-hour charge, but EBS disks and the Elastic IP are still billed. Only `npm run destroy` brings the cost to zero.

**How do I check the Terraform code without deploying?** `terraform -chdir=infra init -backend=false` followed by `terraform -chdir=infra validate`. It needs no AWS credentials and costs nothing.

---

## 17. Command reference

Everything after `--` is passed to the script: `npm run deploy -- --env dev --yes`. Each script also prints its help with `--help`.

### npm shortcuts

| npm script | Runs |
|---|---|
| `npm run deploy` | `node scripts/deploy.mjs` (infrastructure + app) |
| `npm run deploy:infra` | `node scripts/deploy.mjs --infra-only` |
| `npm run deploy:app` | `node scripts/deploy.mjs --app-only` |
| `npm run destroy` | `node scripts/destroy.mjs` |
| `npm run ops -- <command>` | `node scripts/ops.mjs <command>` |
| `npm run status` | `node scripts/ops.mjs status` |
| `npm run logs` | `node scripts/ops.mjs logs` |

### Options shared by deploy, destroy and ops

| Option | Meaning |
|---|---|
| `--env <name>` | Environment: uses `infra/environments/<name>.tfvars` (+ `<name>.secrets.tfvars`). Default `prod` |
| `--profile <name>` | AWS CLI profile (otherwise `AWS_PROFILE` or the default profile) |
| `--region <region>` | Override `aws_region` from the tfvars file |
| `--project <name>` | Override `project_name` from the tfvars file (used by CI) |
| `-y`, `--yes` | No confirmation prompts (Terraform runs with `-auto-approve`) |
| `-h`, `--help` | Show the script's help |

### `npm run deploy -- [options]`

| Option | Meaning |
|---|---|
| *(none)* | Terraform apply, then build and deploy backend and frontend, then smoke test |
| `--infra-only` | Only Terraform |
| `--app-only` | Skip Terraform; deploy code to an existing environment (what CI uses) |
| `--skip-backend` | Don't build/deploy the backend |
| `--skip-frontend` | Don't build/deploy the frontend |
| `--tag <tag>` | Deploy an existing backend image from ECR instead of building one |
| `--replace-server` | Rebuild the EC2 server from the latest Amazon Linux AMI (OS patching); data volume and Elastic IP kept |
| `--replace <address>` | Force Terraform to recreate a resource, repeatable (e.g. `random_password.origin_verify` to rotate a secret) |

### `npm run destroy -- [options]`

| Option | Meaning |
|---|---|
| *(none)* | Asks you to type `<project>-<env>`, then deletes every resource, the state bucket and leftover SSM parameters, and scans for leftovers |
| `--keep-state` | Keep the Terraform state bucket |

### `npm run ops -- <command> [options]`

| Command | Meaning |
|---|---|
| `status` | Server state, SSM connectivity, deployed version, live health check, dashboard URL |
| `logs [group]` | CloudWatch logs; group = `backend` (default), `nginx`, `mongo`, `system`, `ssm`. Options: `--since 30m\|2h\|1d`, `-f`/`--follow` |
| `shell` | Interactive shell on the server via SSM Session Manager (needs AWS CLI + Session Manager plugin) |
| `exec "<command>"` | Run a shell command on the server as root and print the output |
| `redeploy` | Restart the current backend version (picks up new env vars, secrets and server files) |
| `rollback [--tag <tag>]` | Deploy the previous backend image (or the given tag) |
| `backup` | MongoDB backup to S3 now (`database_mode = "local"`) |
| `backups` | List MongoDB backups |
| `restore <s3-key>` | Restore a backup - replaces the data of every collection it contains |

### Environment variables the tooling understands

| Variable | Effect |
|---|---|
| `AWS_PROFILE` | AWS credentials profile (same as `--profile`) |
| `TF_VAR_<name>` | Any Terraform variable, e.g. `TF_VAR_mongodb_uri` instead of the secrets file |
| `TF_LOG=DEBUG` | Verbose Terraform logs for troubleshooting |
| `NO_COLOR=1` | Disable colored output |

---

## 18. Terraform outputs

Show them with `terraform -chdir=infra output`, or one value with `terraform -chdir=infra output -raw app_url`. The values come from the environment the scripts initialised most recently. `npm run status -- --env <name>` shows the main ones for any environment.

| Output | What it is |
|---|---|
| `app_url` | Public URL of the app (`https://<id>.cloudfront.net` or your domain) |
| `api_health_url` | Health check through CloudFront |
| `cloudfront_domain_name` | CloudFront hostname (target for a CNAME when DNS is outside Route 53) |
| `cloudfront_distribution_id` | Distribution ID (cache invalidations, console) |
| `frontend_bucket` | S3 bucket holding the React build |
| `artifacts_bucket` | S3 bucket holding server files and MongoDB backups |
| `ecr_repository_url` | Registry repository of the backend image |
| `instance_id` / `instance_type` | The EC2 server and its (auto-selected) type |
| `elastic_ip` | Server's static public IP (allow-list it in MongoDB Atlas) |
| `vpc_id` / `private_subnet_ids` / `app_security_group_id` | For paid add-ons (DocumentDB, load balancer...) |
| `ssm_session_command` | AWS CLI command to open a shell on the server |
| `log_groups` | CloudWatch log group names |
| `dashboard_url` | CloudWatch dashboard |
| `github_actions_variables` | Values to create as GitHub repository variables (when `github_repository` is set) |
| `deploy_manifest` | Everything the deploy scripts need (also stored in SSM at `/<project>/<env>/deploy/manifest`) |
