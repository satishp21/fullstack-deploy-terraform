# AWS services in detail

For every AWS service the stack uses, this page covers what it is, how this project uses and configures it, the Terraform file that creates it, free-tier limits, cost beyond them, and the paid upgrade.

Prices are approximate **us-east-1 on-demand** prices; check the [AWS Pricing Calculator](https://calculator.aws/) for your region. Free tier details depend on when your account was created (see [COSTS_AND_UPGRADES.md](COSTS_AND_UPGRADES.md#the-aws-free-tier-in-2025-and-later)).

Contents:
[VPC](#1-amazon-vpc) ·
[EC2](#2-amazon-ec2) ·
[EBS](#3-amazon-ebs) ·
[Elastic IP](#4-elastic-ip-public-ipv4) ·
[Security groups](#5-security-groups) ·
[IAM](#6-iam-and-sts) ·
[Systems Manager](#7-aws-systems-manager-ssm) ·
[ECR](#8-amazon-ecr) ·
[S3](#9-amazon-s3) ·
[CloudFront](#10-amazon-cloudfront) ·
[ACM & Route 53](#11-acm-and-route-53-optional-custom-domain) ·
[CloudWatch](#12-amazon-cloudwatch) ·
[SNS](#13-amazon-sns) ·
[Budgets](#14-aws-budgets) ·
[KMS](#15-aws-kms) ·
[Tagging API](#16-resource-groups-tagging-api) ·
[On the server](#17-software-on-the-server) ·
[Permissions to deploy](#permissions-needed-to-deploy)

---

## 1. Amazon VPC

**What it is.** A Virtual Private Cloud is your own isolated network inside AWS. You define its IP range, split it into subnets (each in one availability zone), and control routing.

**How this project uses it** ([`infra/modules/network/main.tf`](../infra/modules/network/main.tf)):

| Resource | Purpose |
|---|---|
| VPC `10.20.0.0/16` | DNS support + DNS hostnames enabled (needed for EC2 public DNS names) |
| 2 **public subnets** (`10.20.0.0/24`, `10.20.1.0/24`) | Route `0.0.0.0/0` to the internet gateway. The app server lives in the first one. `map_public_ip_on_launch = false`: nothing gets a random public IP |
| 2 **private subnets** (`10.20.10.0/24`, `10.20.11.0/24`) | No internet route by default. Free to create, and ready for paid upgrades (ALB targets, DocumentDB, RDS) |
| **Internet gateway** | Two-way internet access for public subnets |
| **Route tables** | One public, one per private subnet (so a NAT gateway per AZ can be added later) |
| **S3 gateway endpoint** | Traffic to S3 (deploy files, backups, AL2023 package repos) stays on the AWS network. Free |
| **Default security group** | Stripped of all rules (CIS benchmark), so nothing can accidentally use it |
| *NAT gateway* (optional) | `enable_nat_gateway = true`: internet for private subnets. **~$33/month + $0.045/GB** |
| *Flow logs* (optional) | `enable_vpc_flow_logs = true`: rejected connections to CloudWatch Logs |

The AZs are chosen automatically from those offering your instance type (`t2.micro` is missing in some AZs). See `data "aws_ec2_instance_type_offerings"` in [`infra/main.tf`](../infra/main.tf).

**Free tier.** VPCs, subnets, route tables, internet gateways, security groups and gateway endpoints are free. NAT gateways, interface endpoints (~$7.30/month each per AZ), and data processed by them are not.

**Why the server is in a public subnet.** A server in a private subnet needs a NAT gateway (~$33/month) or several interface endpoints (ECR API, ECR DKR, SSM, SSM Messages, EC2 Messages, CloudWatch Logs: roughly 6 × $7.30) to reach AWS APIs and download packages. Instead, the server sits in a public subnet whose security group admits **only CloudFront**, on port 80. The result is similar exposure, for free.

**Console:** VPC → Your VPCs (filter by the `Project` tag).

---

## 2. Amazon EC2

**What it is.** Virtual servers. You pick an instance type (CPU/RAM), an AMI (OS image) and storage.

**How this project uses it** ([`infra/modules/app-server/main.tf`](../infra/modules/app-server/main.tf)): **one** instance runs everything server-side through Docker Compose (nginx, your API and optionally MongoDB).

| Setting | Value | Why |
|---|---|---|
| AMI | Latest **Amazon Linux 2023** from the public SSM parameter `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-<arch>` | Supported until 2029, SSM agent preinstalled, `dnf` packages for Docker and the CloudWatch agent |
| Instance type | `instance_type = ""` → auto | `data "aws_ec2_instance_types"` with filter `free-tier-eligible = true` finds what *your* account gets for free: `t2.micro` (older accounts) or `t3.micro`. Set it explicitly for anything else |
| Architecture | Derived from the instance type | `t4g`/Graviton = arm64 (cheaper per GB of RAM); the deploy script builds the image for the matching platform. Changing architecture replaces the instance automatically (`terraform_data.architecture` + `replace_triggered_by`) |
| `credit_specification` | `standard` | t3 defaults to *unlimited*, which **bills** sustained CPU above baseline ($0.05/vCPU-hour). *Standard* throttles instead, so you never get a surprise charge. T3/T4g get no launch credits, so a new server's first boot runs throttled (10-15 min). t2 instances get 30 launch credits |
| `metadata_options` | `http_tokens = required`, hop limit 2 | **IMDSv2 only**: blocks the classic SSRF credential-theft attack. Hop limit 2 lets containers use the instance role if your app calls AWS APIs (e.g. S3 uploads) |
| `maintenance_options.auto_recovery` | `default` | If the AWS host fails, EC2 moves the instance to healthy hardware with the same ID, IP and volumes |
| `monitoring` | `false` | Detailed (1-minute) monitoring is paid; the CloudWatch agent covers what matters |
| User data | [`templates/user-data.sh.tftpl`](../infra/modules/app-server/templates/user-data.sh.tftpl) | Downloads `deploy/` from S3 and runs `bootstrap.sh` then `deploy-app.sh` |
| `lifecycle.ignore_changes` | `ami`, `user_data` | New AMIs don't replace your server unexpectedly. Patch deliberately with `-replace` (see [OPERATIONS.md](OPERATIONS.md#patching-the-operating-system)) |
| IAM instance profile | `<name>-app-server` | See [IAM](#6-iam-and-sts) |

**Memory budget on a 1 GiB micro instance:** OS + agents ~250 MB, Docker ~60 MB, MongoDB with a 0.25 GB cache ~350 MB, Node API ~100 MB, nginx ~10 MB. That's tight but works, and the **2 GB swap file** absorbs spikes. If the `memory-high` alarm fires regularly, use `t3.small` (2 GiB).

**Free tier.** Accounts created before 15 July 2025 get 750 hours/month of t2.micro (t3.micro where t2 is unavailable) for 12 months. 750 hours is one instance running all month; two instances use it up in half a month. Newer accounts pay from credits: t3.micro is ~$0.0104/h (~$7.60/month).

**Paid upgrade.** Run 2+ instances in an **Auto Scaling group** behind an **Application Load Balancer** across AZs, with the database moved off the instance (Atlas or DocumentDB). Or replace EC2 with **ECS on Fargate**. See [COSTS_AND_UPGRADES.md](COSTS_AND_UPGRADES.md#the-paid-production-architecture).

**Console:** EC2 → Instances → `<project>-<env>-app` (Status checks tab, Monitoring tab, *Actions → Monitor and troubleshoot → Get system log*).

---

## 3. Amazon EBS

**What it is.** Network block storage (virtual disks) for EC2.

**How this project uses it:**

| Volume | Size | Details |
|---|---|---|
| Root | `root_volume_size_gb = 20` | gp3, encrypted, deleted with the instance. OS, Docker images, the 2 GB swap file |
| MongoDB data (`database_mode = "local"`) | `data_volume_size_gb = 10` | gp3, encrypted, **separate resource** (`aws_ebs_volume.data`), mounted at `/data`. It survives instance replacement: Terraform stops the old instance, detaches the volume and attaches it to the new one (`stop_instance_before_detaching = true` for a clean MongoDB shutdown) |

The first boot formats the data volume as XFS, but only if it is empty. It then mounts it by UUID with `nofail` (see `mount_data_volume` in [`bootstrap.sh`](../infra/modules/app-server/files/bin/bootstrap.sh)). The script finds the disk whether it appears as NVMe (`t3`, `t4g`) or Xen (`t2`).

**Free tier.** 30 GB of General Purpose SSD for 12 months (older accounts). The defaults total exactly 30 GB. Beyond that, gp3 is ~$0.08/GB-month.

**Paid upgrade.** Scheduled snapshots with **AWS Backup** or **Data Lifecycle Manager** (~$0.05/GB-month of changed data). They're not enabled here because snapshots survive `terraform destroy` and would keep costing money. MongoDB is backed up logically to S3 instead.

---

## 4. Elastic IP (public IPv4)

**What it is.** A static public IPv4 address you own until you release it.

**How this project uses it.** CloudFront needs a stable **DNS name** for the API origin; IP addresses aren't accepted. The Elastic IP's public DNS name (`ec2-1-2-3-4.compute-1.amazonaws.com`) stays the same even when the instance is replaced, so CloudFront never needs updating. The instance gets no random public IP at launch; the EIP is associated right after it starts.

**Cost.** Since February 2024, AWS charges **$0.005/hour (~$3.65/month)** for every public IPv4 address, attached or not. Older accounts get 750 hours/month free for 12 months.

**Paid upgrade.** Behind an ALB, instances need no public IP; the ALB has its own addresses, also billed per IP.

---

## 5. Security groups

**What it is.** A stateful virtual firewall attached to network interfaces.

**How this project uses it** ([`app-server/main.tf`](../infra/modules/app-server/main.tf)):

| Direction | Rule |
|---|---|
| Inbound | **TCP 80 only from the AWS-managed prefix list `com.amazonaws.global.cloudfront.origin-facing`**: the IP ranges CloudFront uses to reach origins. Nothing else, not even SSH |
| Outbound | All (ECR, S3, SSM, CloudWatch, GitHub for the Compose binary, OS packages, external databases such as Atlas) |

Because the prefix list contains every CloudFront edge, another person's CloudFront distribution could technically reach your server. The **`X-Origin-Verify` secret header** closes that gap: nginx rejects requests without it.

**Free.**

---

## 6. IAM and STS

**What it is.** Identity and Access Management controls *who* can do *what* on *which* resource. STS issues temporary credentials.

**Roles created:**

**`<name>-app-server`** (instance profile, [`app-server/iam.tf`](../infra/modules/app-server/iam.tf)). Programs on the server get rotating temporary credentials from IMDSv2; no access keys are stored on disk.

| Permission | Why |
|---|---|
| `AmazonSSMManagedInstanceCore` (AWS managed) | SSM agent: Session Manager, Run Command |
| `CloudWatchAgentServerPolicy` (AWS managed) | CloudWatch agent metrics and logs, Docker `awslogs` driver, the `AppHealthy` metric |
| `ecr:GetAuthorizationToken` + pull actions **on this repository only** | Pull the backend image |
| `s3:GetObject` on `artifacts/deploy/*`, `s3:ListBucket` limited to the `deploy/` and `backups/` prefixes | Download server files |
| `s3:GetObject/PutObject/AbortMultipartUpload` on `artifacts/backups/*` | Write and restore MongoDB backups |
| `ssm:GetParameter(s)/GetParametersByPath` on `parameter/<project>/<env>/*` | Read its own configuration and secrets, nothing else |

**`<name>-github-deploy`** (optional, [`github-oidc/main.tf`](../infra/modules/github-oidc/main.tf)). This role is assumed by GitHub Actions through **OpenID Connect**. GitHub signs a token for each workflow run, and AWS checks the token's `aud` (`sts.amazonaws.com`) and `sub` (`repo:<owner>/<repo>:ref:refs/heads/<branch>`). The role can push to this ECR repository, write the website bucket, invalidate this distribution, read the deploy manifest, record the image tag and run commands on this instance. It cannot touch any other resource.

**GitHub OIDC provider.** This is an account-wide singleton: only one can exist per AWS account. Set `create_github_oidc_provider = false` if your account already has it.

**Free.**

### Permissions needed to deploy

The identity running `npm run deploy` creates IAM roles, so it needs broad rights. The simplest options are **AdministratorAccess**, or **PowerUserAccess + IAMFullAccess**. A scoped policy needs these services: `ec2`, `s3`, `cloudfront`, `iam` (roles, instance profiles, OIDC providers, policies), `ssm`, `ecr`, `logs`, `cloudwatch`, `sns`, `budgets`, `acm`, `route53`, `sts`, `tag:GetResources`.

---

## 7. AWS Systems Manager (SSM)

**What it is.** A suite for managing servers. This project uses four of its parts, all free:

### Parameter Store: configuration and secrets
[`infra/config.tf`](../infra/config.tf) creates a hierarchy per environment:

```text
/<project>/<env>/app/MONGODB_URI            SecureString  generated (local) or your mongodb_uri (external)
/<project>/<env>/app/<KEY>                  String        each entry of app_environment
/<project>/<env>/app/<KEY>                  SecureString  each entry of app_secrets
/<project>/<env>/internal/ORIGIN_VERIFY_SECRET   SecureString  CloudFront ↔ nginx shared secret
/<project>/<env>/internal/MONGO_ROOT_PASSWORD    SecureString  local MongoDB root (backups)
/<project>/<env>/internal/MONGO_APP_PASSWORD     SecureString  local MongoDB app user
/<project>/<env>/deploy/image_tag           String        last known-good backend image tag
/<project>/<env>/deploy/manifest            String        JSON used by --app-only deploys and CI
```

On every deployment, `deploy-app.sh` reads `…/app/*` into the container's environment and `…/internal/*` into Compose variables. Both are written to root-only files (`chmod 600`) on the server. You can also add parameters by hand under `…/app/`; the next `npm run ops -- redeploy` picks them up:

```bash
aws ssm put-parameter --name /mern-demo/prod/app/FEATURE_FLAG --type String --value on
```

**Free tier.** Standard parameters (up to 10,000, 4 KB each) are free. SecureString uses the AWS-managed key `aws/ssm`, also free. *Paid alternative:* **Secrets Manager** ($0.40/secret/month) adds automatic rotation and cross-account sharing.

### Run Command: deployments
The deploy script calls `SendCommand` with the `AWS-RunShellScript` document, running `/opt/app/bin/deploy-app.sh <tag>` as root, and polls `GetCommandInvocation` for the result. Output also goes to the `/<project>/<env>/ssm` log group. **Free** for EC2.

### Session Manager: shell without SSH
`npm run ops -- shell` (`aws ssm start-session`) opens an interactive shell through the SSM agent's outbound connection. There are no keys to manage, no port 22, and every session is authorized by IAM and recorded in CloudTrail. **Free.**

### Public parameters: AMI lookup
`/aws/service/ami-amazon-linux-latest/...` always points to the latest Amazon Linux 2023 AMI.

**Console:** Systems Manager → Parameter Store / Run Command / Session Manager / Fleet Manager.

---

## 8. Amazon ECR

**What it is.** Elastic Container Registry, a private Docker registry.

**How this project uses it** ([`modules/ecr/main.tf`](../infra/modules/ecr/main.tf)): repository `<project>-<env>/backend`.

| Setting | Value | Why |
|---|---|---|
| Tag mutability | `IMMUTABLE` | A tag always means the same image; rollbacks are reliable. Each deploy pushes a unique tag (`20261030-142501-a1b2c3d4`) |
| Scan on push | on | Free basic CVE scan of OS packages (results in the console) |
| Encryption | AES256 | At rest |
| Lifecycle policy | keep last `ecr_max_image_count` (10), untagged deleted after 1 day | Bounded storage, while keeping a rollback window |
| `force_delete` | `true` | `destroy` works even with images inside |

**Free tier.** 500 MB/month of private storage for 12 months (older accounts). Image layers are shared, so 10 versions of a Node app are typically 100-250 MB. Beyond that it's $0.10/GB-month. Data transfer from ECR to EC2 in the same region is free.

---

## 9. Amazon S3

**What it is.** Object storage.

**Buckets in this project** (all private: Block Public Access, TLS-only bucket policy, SSE-S3 encryption, `BucketOwnerEnforced`):

| Bucket | Created by | Contents | Lifecycle |
|---|---|---|---|
| `<name>-web-<account>` | [`cdn/main.tf`](../infra/modules/cdn/main.tf) | React build. Readable **only** by this CloudFront distribution (OAC + `AWS:SourceArn` condition) | Versioned; old versions expire after 30 days |
| `<name>-artifacts-<account>` | [`app-server/storage.tf`](../infra/modules/app-server/storage.tf) | `deploy/` (files the server runs, uploaded by Terraform) and `backups/mongo/YYYY/MM/*.archive.gz` | Backups expire after `backup_retention_days`; old deploy-file versions after 30 days |
| `<project>-<env>-tfstate-<account>` | `scripts/lib/aws.mjs` (before `terraform init`) | Terraform state + lock file | Versioned; old versions expire after 90 days |

**How the frontend is uploaded.** The deploy script uploads with the AWS SDK rather than `aws s3 sync`, which on Windows can guess wrong Content-Types from the registry. Each file gets an explicit Content-Type and a cache policy:

| Files | Cache-Control |
|---|---|
| `*.html`, `service-worker.js`/`sw.js` | `no-cache` (browsers and CloudFront revalidate every time) |
| `assets/*` (Vite), `static/*` (CRA): content-hashed names | `public, max-age=31536000, immutable` |
| everything else (favicon, robots.txt, manifest) | `public, max-age=300` |

HTML is uploaded last, so a new `index.html` never points at files that aren't there yet. Old hashed assets are kept 30 days for visitors who still have the old page open.

**Free tier.** 5 GB Standard storage, 20,000 GET and 2,000 PUT requests per month for 12 months (older accounts). PUT requests are the ones to watch: each frontend deploy uploads every file. A 20-file build deployed 50 times is 1,000 PUTs.

---

## 10. Amazon CloudFront

**What it is.** A global content delivery network with 600+ edge locations. Users connect to the nearest edge over HTTPS.

**How this project uses it** ([`cdn/main.tf`](../infra/modules/cdn/main.tf)): a single distribution is the **only public entry point**.

| Behavior | Origin | Cache policy | Origin request policy | Notes |
|---|---|---|---|---|
| `api_path_patterns` (default `/api/*`) | EC2 Elastic IP DNS, HTTP:80, header `X-Origin-Verify` | `Managed-CachingDisabled` | `Managed-AllViewerExceptHostHeader` (all headers incl. `Authorization`, cookies, query strings) | All methods allowed (GET/POST/PUT/PATCH/DELETE/OPTIONS), WebSockets supported |
| default `/*` | S3 website bucket via **Origin Access Control** (SigV4-signed) | `Managed-CachingOptimized` (honours the Cache-Control set at upload) | - | Compression (gzip/brotli), SPA function |

Shared settings: HTTP→HTTPS redirect, HTTP/2 and HTTP/3, IPv6, `Managed-SecurityHeadersPolicy` (HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `X-XSS-Protection`), and `PriceClass_100` (North America + Europe edges) by default.

**CloudFront Function `spa-rewrite`** ([`functions/spa-rewrite.js`](../infra/modules/cdn/functions/spa-rewrite.js)) runs on each viewer request to the S3 behavior. A path whose last segment has no dot (`/tasks/42`) is rewritten to `/index.html`, so React Router works on refresh and deep links. This is better than "custom error responses", which would also turn real API 404s into HTML pages.

**Invalidation.** Each frontend deploy invalidates `/*`. A wildcard counts as one path, and the first 1,000 paths per month are free.

**Free tier (always free).** 1 TB data transfer out, 10,000,000 HTTP(S) requests, 2,000,000 CloudFront Function invocations per month.

**Paid upgrades.** **AWS WAF** with managed rule groups (~$5/web ACL + $1/rule + $0.60/million requests). **CloudFront flat-rate plans** (since Nov 2025) bundle CDN, WAF and DDoS protection for a fixed monthly price; they aren't available to Free-plan accounts. **Origin Shield**. **VPC origins** (private servers without public IPs). A CloudFront → **ALB with an ACM certificate** for HTTPS end to end.

**Console:** CloudFront → Distributions → Monitoring / Invalidations / Behaviors.

---

## 11. ACM and Route 53 (optional custom domain)

Set `domain_name = "app.example.com"` and `route53_zone_id = "Z0123..."`:

- **ACM** issues a free public TLS certificate. CloudFront requires the certificate in **us-east-1**, so Terraform uses the `aws.us_east_1` provider alias. Validation is automatic through DNS records Terraform writes into your hosted zone.
- **Route 53** gets `A` and `AAAA` alias records pointing the domain at the distribution. Alias queries to CloudFront are free.
- The viewer certificate switches to SNI with minimum TLS 1.2 (`TLSv1.2_2021`).

**Cost.** ACM public certificates are free. A Route 53 hosted zone is **$0.50/month** (not free tier) plus $0.40 per million standard queries. If your domain's DNS is elsewhere (Cloudflare, GoDaddy...), skip Route 53: request the certificate in ACM (us-east-1) yourself, set `acm_certificate_arn`, and point a CNAME at the `cloudfront_domain_name` output. See [OPERATIONS.md](OPERATIONS.md#custom-domain).

---

## 12. Amazon CloudWatch

**What it is.** AWS's monitoring service: logs, metrics, alarms, dashboards.

### Logs
Log groups (retention `log_retention_days`, default 14):

| Group | Written by | Contains |
|---|---|---|
| `/<project>/<env>/backend` | Docker `awslogs` driver | Your API's stdout/stderr (the sample app logs JSON) |
| `/<project>/<env>/nginx` | Docker `awslogs` driver | Access log as JSON (status, latency, CloudFront request ID) + errors |
| `/<project>/<env>/mongo` | Docker `awslogs` driver | MongoDB logs (local mode) |
| `/<project>/<env>/system` | CloudWatch agent | `bootstrap.log`, `deploy.log`, `backup.log`, `cloud-init-output.log` per instance |
| `/<project>/<env>/ssm` | SSM Run Command | Output of every deploy/ops command |

Groups are created by Terraform *before* the server starts, so nothing creates them implicitly without retention. Query them with **Logs Insights**; examples are in [OPERATIONS.md](OPERATIONS.md#logs).

### Metrics
- **EC2 built-in**: CPU, status checks, CPU credit balance (5-minute basic monitoring).
- **CloudWatch agent** (`CWAgent` namespace): `mem_used_percent`, `swap_used_percent`, `disk_used_percent` for `/` and `/data`. EC2 can't see inside the OS, so the agent is needed for memory and disk.
- **Custom** `AppHealthy` (namespace `<project>/<env>`): `healthcheck.sh` runs every minute (systemd timer), calls the health endpoint *through nginx with the origin secret*, and publishes 1 or 0.
- **CloudFront**: requests, 4xx/5xx error rates (in us-east-1).

### Alarms ([`modules/monitoring/main.tf`](../infra/modules/monitoring/main.tf))

| Alarm | Condition | Action |
|---|---|---|
| `instance-status-check` | OS unreachable for 3 min | **Reboot instance** + email |
| `system-status-check` | AWS host problem 2 min | Email (auto-recovery moves the instance) |
| `cpu-high` | CPU > 80% for 15 min | Email |
| `cpu-credits-low` | Credit balance < 5 for a full hour (burstable types) | Email: the server is being throttled |
| `memory-high` | Memory > 90% for 15 min | Email |
| `disk-root-high` / `disk-data-high` | > 85% / > 80% | Email |
| `app-unhealthy` | `AppHealthy` < 1 for 3 min, **or no data** (server down) | Email |
| `cloudfront-5xx` | 5xx rate > 5% with ≥ 20 requests in 5 min (metric math) | Email (us-east-1 topic) |

### Dashboard
`<project>-<env>`: API health, CloudFront requests and error rates, CPU and credits, memory and swap, disk. The URL is printed after each deploy.

**Free tier (always free).** 10 custom metrics (this stack publishes 5), 10 alarm metrics (this stack uses up to 10; the metric-math alarm counts 2), 5 GB log ingestion + storage, 3 dashboards, 1 million API requests. Beyond: $0.30/metric-month, $0.10/alarm-metric-month, $0.50/GB logs ingested.

---

## 13. Amazon SNS

**What it is.** A pub/sub notification service.

Two topics: `<name>-alerts` (regional alarms) and `<name>-alerts-global` in us-east-1 (the CloudFront alarm, because alarms can only notify topics in their own region). With `alert_email` set, both get an email subscription, so **confirm both emails** AWS sends. Topics use no KMS encryption, because CloudWatch can't publish to topics encrypted with the AWS-managed SNS key.

**Free tier (always free).** 1 million publishes and 1,000 email deliveries per month.

---

## 14. AWS Budgets

A monthly **cost** budget (`monthly_budget_usd`, default $10) for the **whole account** (that's what matters on a free-tier account), with emails at 50% and 80% of actual spend and at 100% of *forecasted* spend. It's created only when `alert_email` is set. Budgets without actions don't cost anything.

Also enable *Billing → Billing preferences → Free Tier usage alerts*. It's an account setting that Terraform doesn't manage.

---

## 15. AWS KMS

Everything is encrypted with **AWS-managed keys** (`aws/ebs`, `aws/ssm`) or S3-managed keys (SSE-S3). These carry no monthly fee, and KMS requests are free up to 20,000/month. *Paid alternative:* customer-managed keys ($1/key/month) for custom key policies, cross-account access or your own rotation schedule.

---

## 16. Resource Groups Tagging API

The provider's `default_tags` give every resource `Project`, `Environment` and `ManagedBy = terraform`. After deleting, `npm run destroy` queries the Tagging API (`tag:GetResources`) in your region and us-east-1 and lists anything still carrying your project/environment tags. You can do the same in the console: *Resource Groups & Tag Editor → Tag Editor*. **Free.**

---

## 17. Software on the server

Not AWS services, but part of the platform ([`infra/modules/app-server/files/`](../infra/modules/app-server/files/)):

| Component | Role |
|---|---|
| **Amazon Linux 2023** | OS; `dnf` packages for Docker, jq and the CloudWatch agent |
| **Docker + Compose plugin** (`docker_compose_version`) | Runs the stack; `live-restore` keeps containers up during Docker daemon restarts; checksum-verified Compose download |
| **nginx** (`nginx:stable-alpine`) | Origin-secret check, JSON access logs, gzip, request size limit, WebSocket upgrade, dynamic DNS re-resolution of the backend container |
| **Your backend** | Image from ECR, `init: true` (signal handling), health check through Node itself, env from Parameter Store |
| **MongoDB** (`mongo:8.0`, local mode) | On `/data` (EBS); WiredTiger cache 0.25 GB; app user with `readWrite` on its own database created on first start; 60 s graceful stop |
| **systemd timers** | `app-healthcheck.timer` (every minute → `AppHealthy` metric), `app-backup.timer` (daily `mongodump` → S3) |
| **CloudWatch agent** | Memory/swap/disk metrics + server log files |
| **Scripts** (`/opt/app/bin`) | `bootstrap.sh` (first boot), `configure-host.sh` (agent + timers, every deploy), `deploy-app.sh` (deploy with rollback), `backup-mongo.sh`, `restore-mongo.sh`, `healthcheck.sh` |
