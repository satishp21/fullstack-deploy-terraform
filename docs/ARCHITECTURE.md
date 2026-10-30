# Architecture

This page covers how requests flow, how deployments work, what happens when the server boots, how the design handles failures, and why it is built this way.

---

## 1. Request flow

```text
Browser ──HTTPS──► CloudFront edge (nearest of 600+ locations)
                     │
                     ├─ path matches /api/*  ──► [no cache] ──HTTP:80 + X-Origin-Verify──► Elastic IP
                     │                                                                     │
                     │                                         Security group: only CloudFront IP ranges
                     │                                                                     ▼
                     │                                       nginx container (port 80)
                     │                                         1. header check (403 if missing/wrong)
                     │                                         2. strips the secret header
                     │                                         3. proxies to backend:<app_port>
                     │                                                                     ▼
                     │                                       backend container (your Express app)
                     │                                                                     ▼
                     │                                       mongo container (local mode) / Atlas (external)
                     │
                     └─ anything else ──► CloudFront Function (SPA rewrite) ──► edge cache ──(miss)──► S3 (OAC)
```

- **Same origin for UI and API.** The React app calls `/api/...` on its own domain, so there's no CORS configuration, no preflight requests, and cookies just work (`SameSite=Lax` is fine).
- **Headers the API receives:** all viewer headers except `Host` (`Authorization`, cookies, query strings, `User-Agent`...), plus `X-Forwarded-For: <client-ip>, <cloudfront-ip>` and `X-Forwarded-Proto: https`. With `app.set('trust proxy', 2)`, Express reports the real client IP in `req.ip`.
- **Timeouts:** CloudFront waits up to 60 s for the origin; nginx `proxy_read_timeout` is 60 s. Long-running work should be asynchronous (queue + polling).
- **WebSockets** (e.g. socket.io) work through CloudFront and nginx. Add the path, e.g. `"/socket.io/*"`, to `api_path_patterns`.

---

## 2. Deployment flow

```text
your machine / CI                                      AWS
─────────────────                                      ───
npm run deploy
 ├─ ensure state bucket ─────────────────────────────► S3  <project>-<env>-tfstate-<account>
 ├─ terraform init + apply ──────────────────────────► all infrastructure; SSM deploy manifest
 ├─ docker buildx build --push ──────────────────────► ECR <project>-<env>/backend:<timestamp>-<sha>
 ├─ frontend build (npm ci && npm run build)
 ├─ SSM SendCommand: deploy-app.sh <tag> ────────────► EC2
 │                                                       ├─ wait for first-boot bootstrap (new server)
 │                                                       ├─ aws s3 cp deploy/ → /opt/app   (latest config)
 │                                                       ├─ configure-host.sh (CloudWatch agent, timers)
 │                                                       ├─ SSM params → runtime/app.env, runtime/compose.env
 │                                                       ├─ docker compose pull
 │                                                       ├─ docker compose up -d --wait (health checks, 5 min max)
 │                                                       └─ unhealthy? → restore previous tag, exit 1
 ├─ ssm put-parameter deploy/image_tag = <tag> ──────► "last known good" version
 ├─ upload frontend (assets, then HTML; prune) ──────► S3 website bucket
 ├─ CloudFront invalidation /* ──────────────────────► edges fetch the new index.html
 └─ GET https://<app>/api/health  (smoke test)
```

**Ordering choices**
- **Build everything before changing anything.** A failing Docker or frontend build aborts the deploy with production untouched.
- **Backend before frontend.** A new UI may need new API endpoints. Keep APIs backward compatible for one release, since the old UI may still be open in browsers.
- **Last known good tag.** It's written only after the server reports healthy. Reboots and instance replacements always start a version that worked.

**Downtime per deploy:** Compose recreates the backend container in place, so expect a few seconds of 502s while the new container starts (`start_period` 60 s, typically 2-10 s). Zero-downtime deploys need two backends behind a load balancer; see [COSTS_AND_UPGRADES.md](COSTS_AND_UPGRADES.md#3-high-availability-alb--auto-scaling-group).

---

## 3. Server boot sequence

First boot of a new instance:

```text
cloud-init → user-data (rendered by Terraform; knows only the bucket name + region)
  1. aws s3 cp s3://<artifacts>/deploy/ /opt/app/     (retries for 5 minutes)
  2. /opt/app/bin/bootstrap.sh
       dnf install docker jq amazon-cloudwatch-agent
       /etc/docker/daemon.json (log rotation, live-restore) → systemctl enable --now docker
       install Docker Compose plugin (SHA-256 verified)
       2 GB swap file, vm.swappiness=10, vm.max_map_count
       wait for the data volume → mkfs.xfs if empty → mount /data (fstab, by UUID)
       configure-host.sh: CloudWatch agent config, systemd timers
       touch /opt/app/state/bootstrapped
  3. /opt/app/bin/deploy-app.sh   (no tag → reads deploy/image_tag; "none" on a new environment → no-op)
```

On **reboot**: Docker starts on boot and every container has `restart: unless-stopped`, so the app comes back by itself with the same version. Timers resume.

On an **instance type change**: Terraform stops the instance, changes the type and starts it again. Everything else stays the same; expect a few minutes of downtime.

On **instance replacement** (`npm run deploy -- --replace-server` to get the newest AMI, an `instance_type` change between x86 and ARM, or a change that forces a new instance, such as another subnet): Terraform stops the old instance, moves the data volume and Elastic IP to the new one, and user-data redeploys the last known-good tag. MongoDB data is preserved.

Everything after user-data is in files under `infra/modules/app-server/files/`, synced from S3 on every deployment. Changing how the server behaves never requires replacing it: edit the files, then run `npm run deploy`.

---

## 4. Configuration flow

```text
infra/environments/<env>.tfvars ─┐
<env>.secrets.tfvars ────────────┼─► terraform apply ─┬─► SSM /<p>/<e>/app/*       ─┐
random_password (generated) ─────┘                    ├─► SSM /<p>/<e>/internal/*  ─┼─► deploy-app.sh renders
                                                      ├─► S3 deploy/settings.env   ─┘   runtime/*.env (root, 0600)
                                                      └─► S3 deploy/*.sh, compose, nginx, systemd    │
                                                                                                      ▼
                                                                                         docker compose up
```

| File on the server | Source | Used for |
|---|---|---|
| `/opt/app/settings.env` | Terraform (non-secret) | Script settings and Compose interpolation (ports, images, log groups, bucket...) |
| `/opt/app/runtime/app.env` | SSM `/<p>/<e>/app/*` | Environment of the backend container |
| `/opt/app/runtime/compose.env` | SSM `/<p>/<e>/internal/*` + image tag | Compose interpolation of secrets (MongoDB passwords, origin secret) |

---

## 5. Failure scenarios

| Failure | What happens | Recovery time | Your action |
|---|---|---|---|
| Backend process crashes | Docker restarts it (`restart: unless-stopped`) | seconds | Check `npm run logs` |
| New release unhealthy | `deploy-app.sh` restores the previous tag; deploy fails | ~1-5 min | Fix and redeploy |
| Bad release that passed health checks | - | - | `npm run ops -- rollback` |
| Server out of memory | Kernel kills the largest process, Docker restarts it; swap softens spikes; `memory-high` alarm | seconds-minutes | Bigger instance (`t3.small`) |
| OS hangs / kernel panic | `instance-status-check` alarm **reboots** the instance after 3 min | ~5 min | Investigate the system log |
| AWS host hardware failure | **EC2 automatic recovery** migrates the instance (same ID, IP, volumes) | ~5-10 min | None |
| Availability zone outage | App down until the AZ recovers (single instance) | AZ-dependent | Paid: multi-AZ ALB + ASG + managed DB |
| MongoDB data corruption / bad migration | - | - | `npm run ops -- restore <backup>` (daily backups, `backup_retention_days`) |
| Instance terminated by mistake | `terraform apply` recreates it; data volume and EIP reattach; last good tag deployed | ~10 min | `npm run deploy` |
| Data volume lost | Restore the latest S3 backup to a new volume | ~15 min | `npm run deploy`, then `ops restore` |
| CloudFront / S3 regional issue | Managed by AWS (highly available) | - | None |
| Credentials leaked in the app | - | - | Rotate in `secrets.tfvars` → deploy → `ops redeploy` |

**Recovery objectives (local MongoDB):** RPO ≤ 24 h (daily backup; run `ops backup` before risky changes). RTO ≈ 5-15 min for the common cases above. For lower RPO use MongoDB Atlas (continuous backups on paid tiers) or DocumentDB (point-in-time restore).

---

## 6. Design decisions

| Decision | Why | Trade-off / upgrade path |
|---|---|---|
| **CloudFront in front of everything** | Free TLS, global caching, one domain (no CORS), security headers, DDoS absorption (AWS Shield Standard is included), static files never touch the server | API hop CloudFront → EC2 is HTTP. Upgrade: ALB + ACM |
| **EC2 + Docker Compose** instead of ECS/EKS/Fargate/Lambda | Free-tier compatible, runs any Express app unchanged, easy to understand and debug (`docker ps`) | Single server. Upgrade: ECS on Fargate behind an ALB |
| **No ALB** | ALB + its public IPs cost ~$23+/month | No multi-instance load balancing. CloudFront targets one origin |
| **Public subnet + CloudFront-only security group** instead of a private subnet + NAT | NAT gateway costs ~$33/month | Server has a public IP, but nothing besides CloudFront on port 80 can connect |
| **Elastic IP DNS as origin** | Stable across instance replacement; CloudFront needs a DNS name | $3.65/month public IPv4 (free first 12 months on older accounts) |
| **MongoDB on the instance (default)** | Free, no external accounts, fast (same host) | Single node, daily backups. Switch to Atlas (`database_mode = "external"`) any time |
| **Separate EBS data volume** | Data survives instance replacement | Volume is tied to one AZ |
| **SSM instead of SSH** | No keys, no open ports, IAM-controlled and audited | Needs the SSM agent online (built into AL2023) |
| **Parameter Store instead of Secrets Manager** | Free; encrypted with KMS | No automatic rotation |
| **Terraform for infra, scripts for app releases** | App deploys don't need infra permissions or a Terraform run; CI role stays minimal | Two tools, which the scripts wrap into one command |
| **Node.js deploy tooling** | MERN developers already have Node; one implementation for Windows/macOS/Linux/CI; AWS SDK avoids CLI quoting and MIME-type issues | Needs `npm install` at the repo root |
| **Immutable, timestamped image tags** | Every deploy is traceable to a commit and rollbacks are exact | ECR keeps the last 10 images |
| **S3-native Terraform state locking** | No DynamoDB table to create or pay for (Terraform 1.11+) | Requires a recent Terraform |
