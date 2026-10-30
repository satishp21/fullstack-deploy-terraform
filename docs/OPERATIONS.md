# Operations runbook

All commands run from the repository root. Add `--env <name>` for an environment other than `prod`, and `--profile <name>` for a non-default AWS profile.

Contents:
[Status](#status) ·
[Logs](#logs) ·
[Shell access](#shell-access) ·
[Deploy, redeploy, roll back](#deploy-redeploy-roll-back) ·
[Configuration and secrets](#configuration-and-secrets) ·
[Backups and restore](#backups-and-restore) ·
[Scaling up](#scaling-up) ·
[Growing disks](#growing-disks) ·
[Patching the operating system](#patching-the-operating-system) ·
[Rotating secrets](#rotating-secrets) ·
[Custom domain](#custom-domain) ·
[Alarms: what to do](#alarms-what-to-do) ·
[Environments](#environments) ·
[Keeping costs at zero](#keeping-costs-at-zero)

---

## Status

```bash
npm run status
```

Shows the server state, SSM agent connectivity, deployed backend version, a live health check through CloudFront, and the dashboard URL. For the graphs, open the **CloudWatch dashboard** `<project>-<env>`.

---

## Logs

```bash
npm run logs                              # backend, last 30 minutes
npm run logs -- backend --follow          # stream (Ctrl+C to stop)
npm run logs -- nginx --since 2h          # access log (JSON) and proxy errors
npm run logs -- mongo                     # MongoDB (local mode)
npm run logs -- system --since 1d         # bootstrap.log, deploy.log, backup.log, cloud-init
npm run logs -- ssm                       # output of deploy/ops commands
```

**CloudWatch Logs Insights** (console → CloudWatch → Logs Insights; select the log group):

```sql
-- Slowest API requests (nginx JSON log)
fields @timestamp, method, uri, status, request_time
| sort request_time desc
| limit 20

-- 5xx responses per URI
filter status >= 500
| stats count(*) as errors by uri
| sort errors desc

-- Backend errors (sample app JSON logger)
filter level = "error"
| fields @timestamp, msg, error, path
| sort @timestamp desc
```

Logs are kept `log_retention_days` (default 14) days. Ingestion beyond 5 GB/month is billed at $0.50/GB, so lower `LOG_LEVEL` if a chatty app approaches that.

---

## Shell access

```bash
npm run ops -- shell
```

This opens an SSM Session Manager shell with no SSH keys and no port 22. It needs the AWS CLI and the [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html). Useful commands on the server:

```bash
sudo -i                                   # become root
cd /opt/app && source bin/lib.sh && load_settings
compose ps                                # container status (compose = docker compose with the right files)
compose logs --tail 100 backend           # recent backend logs
docker stats --no-stream                  # CPU / memory per container
free -m; df -h / /data                    # memory, disk
tail -f /var/log/app/deploy.log           # deployment log
systemctl list-timers 'app-*'             # health-metric and backup timers
cat /opt/app/state/current_tag            # running version
```

Run a single command without a session:

```bash
npm run ops -- exec "docker ps"
npm run ops -- exec "df -h / /data && free -m"
```

Quote the command so the shell passes it to the script as one argument.

---

## Deploy, redeploy, roll back

| Goal | Command |
|---|---|
| Full deploy (Terraform + app) | `npm run deploy` |
| Code only (fast) | `npm run deploy -- --app-only` |
| Frontend only | `npm run deploy -- --app-only --skip-backend` |
| Backend only | `npm run deploy -- --app-only --skip-frontend` |
| Non-interactive (CI) | add `--yes` |
| Restart current version (new env vars/secrets, new server files) | `npm run ops -- redeploy` |
| Roll back to the previous image | `npm run ops -- rollback` |
| Deploy a specific image | `npm run ops -- rollback --tag 20261030-142501-a1b2c3d4` or `npm run deploy -- --app-only --skip-frontend --tag <tag>` |
| List images | console → ECR → `<project>-<env>/backend` |

**Automatic rollback.** If a new backend doesn't become healthy within 5 minutes, `deploy-app.sh` restarts the previous version and the deploy fails. The SSM `deploy/image_tag` keeps pointing at the last good version.

**Frontend rollback.** Redeploy an older commit (`git checkout <sha> && npm run deploy -- --app-only --skip-backend`). The website bucket is versioned, so single files can also be restored in the S3 console (*Show versions*).

---

## Configuration and secrets

| Change | Steps |
|---|---|
| Non-secret env var | Edit `app_environment` in `<env>.tfvars` → `npm run deploy -- --infra-only` → `npm run ops -- redeploy` |
| Secret env var | Edit `app_secrets` in `<env>.secrets.tfvars` → same two commands |
| Quick hotfix without Terraform | `aws ssm put-parameter --name /<project>/<env>/app/KEY --value VALUE --type SecureString --overwrite` → `npm run ops -- redeploy` (parameters added this way aren't managed by Terraform; keep tfvars in sync) |
| Remove a variable | Remove it from tfvars → `--infra-only` deploy (Terraform deletes the parameter) → `ops redeploy` |
| Inspect current values | `aws ssm get-parameters-by-path --path /<project>/<env>/app --with-decryption --query "Parameters[].[Name,Value]" --output table` |

Frontend build variables (`frontend_build_env`) are baked in at build time: run `npm run deploy -- --skip-backend`.

---

## Backups and restore

*Only for `database_mode = "local"`. With Atlas or DocumentDB, use the provider's backups.*

- **Automatic**: `app-backup.timer` runs `mongodump --archive --gzip` daily at `backup_schedule` (default 03:00 UTC). The dump streams straight to `s3://<project>-<env>-artifacts-<account>/backups/mongo/YYYY/MM/mongo-<timestamp>.archive.gz`, and backups older than `backup_retention_days` are deleted automatically.
- **On demand**: `npm run ops -- backup` (do this before risky changes).
- **List**: `npm run ops -- backups`.
- **Restore** (replaces every collection contained in the backup; users are not touched):

  ```bash
  npm run ops -- restore backups/mongo/2026/10/mongo-20261030T030000Z.archive.gz
  ```

- **Download a backup and load it locally**:

  ```bash
  aws s3 cp s3://<artifacts-bucket>/backups/mongo/2026/10/mongo-...archive.gz ./backup.archive.gz
  cd app && docker compose up -d mongo
  docker compose exec -T mongo mongorestore --archive --gzip --drop --nsExclude "admin.*" < ../backup.archive.gz
  ```

- **Check that backups are running**: `npm run logs -- system --since 2d` (look for `Backup complete`). Test a restore into a dev environment now and then.

---

## Scaling up

**Bigger instance.** Set `instance_type` (e.g. `"t3.small"`, 2 GiB, ~$15/month) and run `npm run deploy`. Terraform stops the instance, changes the type and starts it, causing a few minutes of downtime. Raise `mongo_cache_size_gb` with RAM (≈ 50% of RAM minus 1 GB; `0.5` on 2 GiB).

**x86 ↔ ARM (e.g. `t3.small` → `t4g.small`).** Change `instance_type` and run `npm run deploy`. Terraform detects the architecture change and **replaces** the server, because an x86 AMI can't run on ARM. The data volume and Elastic IP move to the new server, and the backend image is rebuilt for arm64 automatically. Expect 5-10 minutes of downtime, and run `npm run ops -- backup` first.

**More than one server** requires a load balancer and an external database; see [COSTS_AND_UPGRADES.md](COSTS_AND_UPGRADES.md#3-high-availability-alb--auto-scaling-group).

---

## Growing disks

EBS volumes can grow online (not shrink), once every 6 hours.

```bash
# 1. raise data_volume_size_gb (or root_volume_size_gb) in tfvars, then
npm run deploy -- --infra-only
# 2. grow the filesystem
npm run ops -- exec "xfs_growfs /data"          # data volume
npm run ops -- exec "reboot"                    # root volume: grown automatically at boot by cloud-init
```

The free tier covers 30 GB of EBS in total (root 20 + data 10 by default).

---

## Patching the operating system

Amazon Linux 2023 pins package versions to the AMI release, so the clean way to patch is a fresh AMI:

```bash
npm run ops -- backup                    # local DB: safety first
npm run deploy -- --replace-server       # new instance from the latest AL2023 AMI
```

The data volume and Elastic IP move to the new server, and the last known-good backend version is deployed automatically. Expect 5-10 minutes of downtime; do it monthly or when a security bulletin requires it. To patch in place instead: `npm run ops -- exec "dnf upgrade -y --releasever=latest && reboot"`.

Container images: nginx uses the moving `stable-alpine` tag and MongoDB the `8.0` tag, so a redeploy (`npm run ops -- redeploy`) pulls their latest patch releases. Your backend gets patched base images when you rebuild (`npm run deploy -- --app-only`).

---

## Rotating secrets

**App secrets** (`app_secrets`): change the value in `<env>.secrets.tfvars` → `npm run deploy -- --infra-only` → `npm run ops -- redeploy`.

**CloudFront ↔ origin secret:**

```bash
npm run deploy -- --infra-only --replace random_password.origin_verify
npm run ops -- redeploy
```

Expect a few minutes of 403s on the API while CloudFront propagates the new header; do it in a quiet period.

**MongoDB app password** (local mode). MongoDB stores the password itself, so update the parameter, change the password in MongoDB, then restart the app:

```bash
# 1. new password in SSM (also updates the connection string)
npm run deploy -- --infra-only --replace "random_password.mongo_app[0]"

# 2. on the server (npm run ops -- shell):
sudo -i
cd /opt/app && source bin/lib.sh && load_settings
NEW=$(aws ssm get-parameter --name "$SSM_PREFIX/internal/MONGO_APP_PASSWORD" --with-decryption --query Parameter.Value --output text)
compose exec -T -e NEW="$NEW" mongo sh -c 'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval "db.getSiblingDB(process.env.MONGO_APP_DATABASE).changeUserPassword(process.env.MONGO_APP_USERNAME, process.env.NEW)"'
exit

# 3. restart the backend with the new connection string
npm run ops -- redeploy
```

---

## Custom domain

**DNS in Route 53** (easiest; $0.50/month per hosted zone):
1. Register a domain in Route 53, or create a hosted zone for an existing domain and set the 4 NS records at your registrar.
2. In `<env>.tfvars`:
   ```hcl
   domain_name     = "app.example.com"
   route53_zone_id = "Z0123456789ABCDEFGHIJ"
   ```
3. `npm run deploy`. Terraform requests an ACM certificate in us-east-1, validates it through DNS, attaches it to CloudFront and creates the `A`/`AAAA` alias records.

**DNS elsewhere** (Cloudflare, GoDaddy, Namecheap...):
1. ACM console, region **us-east-1** → *Request certificate* → `app.example.com` → DNS validation → add the shown CNAME record at your DNS provider → wait for *Issued*.
2. In `<env>.tfvars`:
   ```hcl
   domain_name         = "app.example.com"
   acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/..."
   ```
3. `npm run deploy`, then create a CNAME `app.example.com → <cloudfront_domain_name output>` at your DNS provider. On Cloudflare, set it to "DNS only" (grey cloud). Apex domains (`example.com`) need CNAME flattening or ALIAS support at the provider.

---

## Alarms: what to do

| Alarm | Likely cause | Action |
|---|---|---|
| `app-unhealthy` (ALARM) | Backend crashed/looping, DB down, bad deploy | `npm run status`, `npm run logs -- backend`; `npm run ops -- rollback` if it started after a deploy |
| `app-unhealthy` (INSUFFICIENT_DATA) | Server stopped or unreachable | `npm run status`; EC2 console status checks; recovery is automatic for host failures |
| `instance-status-check` | OS hang, out of memory, full disk | Auto-reboot is triggered. Afterwards check `memory-high`/`disk-*-high` and the system log |
| `system-status-check` | AWS hardware/network issue | Auto-recovery handles it; nothing to do |
| `cpu-high` / `cpu-credits-low` | Sustained load beyond a micro instance's 10-20% baseline | Optimise hot endpoints, cache, or move to `t3.small` |
| `memory-high` | App + MongoDB too big for 1 GiB | Fix leaks, reduce `mongo_cache_size_gb`, move to `t3.small` or MongoDB Atlas |
| `disk-root-high` | Docker images, logs | `npm run ops -- exec "docker system prune -af"`; grow the root volume |
| `disk-data-high` | Database growth | Grow `data_volume_size_gb`; archive old data |
| `cloudfront-5xx` | Origin down or erroring | Same as `app-unhealthy`; check the nginx log for 502/504 |
| Budget email | Unexpected spend | Billing console → *Bills* and *Cost Explorer* by service; `npm run destroy` anything unused |

---

## Environments

```bash
copy infra\environments\prod.tfvars infra\environments\staging.tfvars   # cp on macOS/Linux
# edit staging.tfvars (alert_email, instance_type...)
npm run deploy -- --env staging
npm run status -- --env staging
npm run destroy -- --env staging
```

Each environment has its own state bucket, VPC, server, buckets and URL. Only one instance is covered by the 750 free hours.

---

## Keeping costs at zero

- Run **one** environment on a free-tier account, and destroy environments you don't use (`npm run destroy -- --env dev`).
- Keep `cpu_credits = "standard"`, and leave `enable_nat_gateway` off.
- Don't add a Route 53 hosted zone unless you need a custom domain ($0.50/month).
- Watch *Billing → Free Tier* usage and the budget emails.
- Stopping the instance (EC2 console) pauses compute charges, but the Elastic IP and EBS volumes keep billing. `npm run destroy` is the only way to reach $0.
