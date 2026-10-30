# Costs, free tier and paid upgrades

> Prices are approximate **us-east-1 on-demand** prices at the time of writing. Check the [AWS Pricing Calculator](https://calculator.aws/) and the [Free Tier page](https://aws.amazon.com/free/) for your region and account.

Contents:
[Free tier in 2025+](#the-aws-free-tier-in-2025-and-later) ·
[What this stack uses](#what-this-stack-uses) ·
[Monthly estimates](#monthly-cost-estimates) ·
[Avoiding surprise charges](#avoiding-surprise-charges) ·
[Paid production architecture](#the-paid-production-architecture)

---

## The AWS free tier in 2025 and later

AWS replaced its free tier for **new accounts on 15 July 2025**.

### Accounts created before 15 July 2025 ("legacy" free tier)
- **12-month offers** from the sign-up date, including:
  - EC2: 750 hours/month of Linux **t2.micro** (or **t3.micro** in regions without t2)
  - 750 hours/month of **public IPv4** addresses
  - EBS: 30 GB of General Purpose SSD
  - S3: 5 GB Standard storage, 20,000 GET + 2,000 PUT requests
  - ECR: 500 MB/month private storage
  - Application Load Balancer: 750 hours + 15 LCUs (useful for the [HA upgrade](#3-high-availability-alb--auto-scaling-group))
- **Always free** offers (see below) continue after the 12 months.
- After 12 months, everything not "always free" is billed normally.

### Accounts created on or after 15 July 2025
- **Credits**: $100 at sign-up plus up to $100 more for completing onboarding activities (e.g. launching an EC2 instance, setting up a budget).
- Choice of a **Free plan** or a **Paid plan** at sign-up:
  - *Free plan*: no charges until the credits are used up or **6 months** pass, whichever is first. Then you upgrade to the Paid plan, or the account is closed after a grace period. Some services and features aren't available on the Free plan; for example, CloudFront flat-rate plans.
  - *Paid plan*: credits still apply, with no restrictions.
- EC2 instance types available on the Free plan: t3.micro, t3.small, t4g.micro, t4g.small, c7i-flex.large, m7i-flex.large. Their usage is **deducted from the credits**.
- **Always free** offers apply as well.

### Always free (both)
| Service | Monthly allowance |
|---|---|
| CloudFront | 1 TB data out, 10 M requests, 2 M CloudFront Function invocations |
| Data transfer out to the internet (all services combined) | 100 GB |
| CloudWatch | 10 custom metrics, 10 alarm metrics, 5 GB logs (ingest + storage + Insights scans), 3 dashboards, 1 M API requests |
| SNS | 1 M publishes, 1,000 email deliveries |
| Systems Manager | Parameter Store standard, Run Command and Session Manager for EC2 are free (always, not a "tier") |
| KMS | 20,000 requests (AWS-managed keys have no monthly fee) |

**How this project adapts.** With `instance_type = ""`, Terraform asks EC2 which micro types are *free-tier eligible* for your account in the region (`DescribeInstanceTypes` with the `free-tier-eligible` filter). It prefers `t2.micro` (the free type for legacy accounts) and otherwise picks `t3.micro`. To check what your account gets:

```bash
aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true --query "InstanceTypes[].InstanceType" --region us-east-1
```

---

## What this stack uses

| Resource | Quantity | Covered by | If not covered |
|---|---|---|---|
| EC2 micro instance | 1 × 730 h/month | Legacy 12-month (750 h) / credits | t3.micro ~$7.60/mo, t2.micro ~$8.50/mo |
| EBS gp3 | 20 GB + 10 GB | Legacy 12-month (30 GB) / credits | ~$2.40/mo |
| Public IPv4 (Elastic IP) | 1 × 730 h | Legacy 12-month (750 h) / credits | ~$3.65/mo |
| S3 | a few MB-GB (site, deploy files, backups, state) | 5 GB legacy / credits | $0.023/GB-mo + requests |
| ECR | ~100-250 MB | 500 MB legacy / credits | $0.10/GB-mo |
| CloudFront | your traffic | Always free (1 TB, 10 M requests) | from $0.085/GB |
| CloudWatch | 5 custom metrics, ≤ 10 alarm metrics, 1 dashboard, logs | Always free | $0.30/metric, $0.10/alarm, $0.50/GB logs |
| SNS email, SSM, IAM, KMS (managed keys), VPC, security groups, S3 endpoint | - | Free | - |
| AWS Budgets (1 budget, no actions) | 1 | No charge | - |
| *Optional* Route 53 hosted zone | 1 | **Never free** | $0.50/mo |
| *Optional* NAT gateway | 1 | **Never free** | ~$33/mo + $0.045/GB |

---

## Monthly cost estimates

| Scenario | Estimate |
|---|---|
| Legacy account, first 12 months, one environment, light traffic | **≈ $0** |
| Legacy account after 12 months | **≈ $14.5/month** (t2.micro $8.5 + EBS $2.4 + IPv4 $3.65) |
| New account (credits), t3.micro | **≈ $13.7/month from credits** ($100 lasts ~7 months, but the Free plan ends at 6) |
| New account, `instance_type = "t3.small"` (2 GiB, more comfortable) | **≈ $21/month** |
| Two environments (prod + dev) running all month | roughly **double** (the 750 free hours cover one instance) |
| + custom domain in Route 53 | + $0.50/month |

---

## Avoiding surprise charges

Built in:
- **Budget alerts** (`monthly_budget_usd`, default $10) at 50% and 80% actual and 100% forecast.
- **`cpu_credits = "standard"`**: t3/t4g default to *unlimited* mode, which can bill for sustained CPU use; standard mode throttles instead.
- **Retention limits**: logs 14 days, ECR 10 images, backups 14 days, old S3 versions 30-90 days.
- **No NAT gateway, no ALB, no Route 53, no interface endpoints** by default.
- **`npm run destroy`** removes everything, including the state bucket, and reports leftovers.

Your part:
- Turn on *Billing preferences → Free Tier usage alerts*.
- Check *Billing → Free Tier* now and then ("Month-to-date usage" vs. "Forecasted").
- Don't leave extra environments running; one EC2 instance is what the free hours cover.
- If you created anything by hand in the console, delete it yourself; `destroy` only removes what Terraform created.

---

## The paid production architecture

With a paid account and real traffic, this is the target architecture. Each piece below lists its benefit, cost and the change to make.

```text
              Route 53 (custom domain) ── ACM certificate
                         │
                 CloudFront + AWS WAF
           ┌─────────────┴──────────────┐
      S3 (frontend)          Application Load Balancer (HTTPS, ACM) ── public subnets, 2-3 AZs
                                        │
                     Auto Scaling group or ECS Fargate service ── PRIVATE subnets, 2-3 AZs
                                        │                         (egress via NAT gateway / VPC endpoints)
                MongoDB Atlas M10+ (VPC peering/PrivateLink)  or  Amazon DocumentDB (multi-AZ)
                                        │
        Secrets Manager · CloudWatch · X-Ray · GuardDuty · CloudTrail · AWS Backup · Config
```

Approximate monthly baseline: **$120-200** (ALB ~$23, 2 × t3.small ~$30, NAT ~$33, Atlas M10 ~$57 or DocumentDB ~$60+, WAF ~$10, misc ~$10), before traffic.

### 1. Private subnets + NAT gateway
**Why:** the servers get no public IP at all.
**Cost:** NAT gateway ~$0.045/h (~$33/month) + $0.045/GB processed, per AZ for full HA. Alternative: interface VPC endpoints for ECR (api + dkr), SSM (ssm, ssmmessages, ec2messages), CloudWatch Logs and STS, at ~$7.30/month each per AZ. The S3 gateway endpoint is already in place and free.
**Change:** `enable_nat_gateway = true`, then put instances in `module.network.private_subnet_ids`. A private instance can't be a CloudFront custom origin directly, so it goes behind an ALB (step 3) or uses **CloudFront VPC origins**.

### 2. End-to-end TLS
**Why:** encrypt the CloudFront → origin hop (currently HTTP, restricted to CloudFront IPs and authenticated by a secret header).
**Options:** (a) an ALB with an ACM certificate (free cert) for `origin.example.com`, with CloudFront using `origin_protocol_policy = "https-only"`; (b) CloudFront **VPC origins** to a private ALB/instance (no internet path at all); (c) a Let's Encrypt certificate on nginx for an origin hostname you own (free, but you manage renewal).

### 3. High availability: ALB + Auto Scaling group
**Why:** survive an instance or AZ failure, and deploy with zero downtime (rolling instance refresh).
**Cost:** ALB ~$16.50/month + LCUs + public IPv4 per AZ (~$7.30 for 2 AZs). Legacy accounts get 750 ALB hours free for 12 months. Plus one extra instance per AZ.
**Prerequisite:** move the database **off** the instances (step 4), since instances become disposable.
**Sketch:**

```hcl
resource "aws_lb" "app" {
  name               = "${local.name}-alb"
  load_balancer_type = "application"
  subnets            = module.network.public_subnet_ids
  security_groups    = [aws_security_group.alb.id] # 443 from the CloudFront prefix list
}

resource "aws_lb_target_group" "app" {
  name     = "${local.name}-tg"
  port     = 80
  protocol = "HTTP"
  vpc_id   = module.network.vpc_id
  health_check {
    path    = var.health_check_path
    matcher = "200"
  }
}

resource "aws_autoscaling_group" "app" {
  min_size            = 2
  max_size            = 4
  vpc_zone_identifier = module.network.private_subnet_ids
  target_group_arns   = [aws_lb_target_group.app.arn]
  health_check_type   = "ELB"
  launch_template {
    id      = aws_launch_template.app.id # same AMI/user-data/IAM as today
    version = "$Latest"
  }
  instance_refresh {
    strategy = "Rolling"
    preferences { min_healthy_percentage = 50 }
  }
}
```

Then point the CloudFront API origin at `aws_lb.app.dns_name` and deploy by updating the image tag in SSM and triggering an instance refresh, or with SSM Run Command on all instances by tag.

### 4. Managed database
| Option | Cost | Notes |
|---|---|---|
| **MongoDB Atlas M0** | Free | 512 MB, shared, no backups. Already supported: `database_mode = "external"` |
| **MongoDB Atlas Flex** | ~$8-30/month | Small production workloads, backups included |
| **MongoDB Atlas M10+** | from ~$57/month | Dedicated, replica set across AZs, continuous backups/point-in-time restore, VPC peering/PrivateLink. Full MongoDB compatibility |
| **Amazon DocumentDB** | from ~$60/month (db.t3.medium) + storage/IO | AWS-native, multi-AZ replicas, PITR. MongoDB-*compatible* (not every feature); requires TLS |

**DocumentDB sketch:**

```hcl
resource "aws_docdb_subnet_group" "this" {
  name       = "${local.name}-docdb"
  subnet_ids = module.network.private_subnet_ids
}

resource "aws_docdb_cluster" "this" {
  cluster_identifier      = "${local.name}-docdb"
  engine                  = "docdb"
  master_username         = "appadmin"
  master_password         = random_password.docdb.result
  db_subnet_group_name    = aws_docdb_subnet_group.this.name
  vpc_security_group_ids  = [aws_security_group.docdb.id] # 27017 from module.app_server.security_group_id
  storage_encrypted       = true
  backup_retention_period = 7
  deletion_protection     = true
}

resource "aws_docdb_cluster_instance" "this" {
  count              = 2 # primary + replica in another AZ
  identifier         = "${local.name}-docdb-${count.index}"
  cluster_identifier = aws_docdb_cluster.this.id
  instance_class     = "db.t3.medium"
}
```

Then set `database_mode = "external"` and `mongodb_uri` to the cluster endpoint (see [DEPLOY_YOUR_OWN_APP.md](DEPLOY_YOUR_OWN_APP.md#amazon-documentdb-paid) for the TLS parameters).

### 5. Serverless containers: ECS on Fargate
**Why:** no OS to patch, per-task IAM roles, rolling deployments with circuit-breaker rollback, auto scaling on CPU or requests.
**Cost:** ~0.25 vCPU + 0.5 GB ≈ $9/month per task (×2 for HA) + ALB + NAT/endpoints.
**Change:** replace `modules/app-server` with an ECS cluster, task definition (image from the same ECR repository, secrets from SSM via `secrets` / `valueFrom`) and a service behind the ALB. The deploy script then calls `UpdateService` instead of SSM Run Command.

### 6. AWS Secrets Manager
**Why:** automatic rotation (built-in for DocumentDB), resource policies, cross-account sharing.
**Cost:** $0.40/secret/month + $0.05 per 10,000 API calls.
**Change:** store secrets in `aws_secretsmanager_secret`, grant `secretsmanager:GetSecretValue` to the server role, and read them in `deploy-app.sh` (`aws secretsmanager get-secret-value`).

### 7. AWS WAF / CloudFront flat-rate plans
**Why:** block common exploits (OWASP top 10, known bad IPs, bots) and rate-limit abusive clients before they reach the server.
**Cost:** ~$5/web ACL + $1/rule group + $0.60/million requests; managed rule groups like `AWSManagedRulesCommonRuleSet` are included in the rule price. Since November 2025, **CloudFront flat-rate plans** (Free, Pro, Business, Premium) bundle CDN, WAF and DDoS protection at a fixed monthly price with no overages. They aren't available to accounts on the Free (credits) plan; check current terms.
**Change:** an `aws_wafv2_web_acl` with `scope = "CLOUDFRONT"` (created in us-east-1), set as `web_acl_id` on the distribution.

### 8. Backups: AWS Backup / snapshots
**Why:** crash-consistent volume snapshots on a schedule, cross-region copies, vault lock.
**Cost:** EBS snapshots ~$0.05/GB-month (incremental).
**Note:** snapshots aren't deleted by `terraform destroy`; delete the vault's recovery points before tearing down.

### 9. Security and audit
| Service | Purpose | Cost |
|---|---|---|
| **CloudTrail** | Audit log of every API call; the first management-event trail is free (pay for S3 storage) | ~$0 |
| **GuardDuty** | Threat detection (compromised instances, crypto mining, credential misuse) | 30-day free trial, then usage-based (a few $/month for small accounts) |
| **AWS Config** | Resource configuration history and compliance rules | ~$0.003 per configuration item |
| **Security Hub** | Aggregated findings + CIS/AWS Foundational benchmarks | 30-day trial, then per check |
| **IAM Access Analyzer** | Finds unintended public or cross-account access | External access analysis is free |

### 10. Observability
- **CloudWatch Synthetics** canary on `/api/health` from outside AWS (~$0.0012 per run).
- **AWS X-Ray** or OpenTelemetry for request tracing.
- **Detailed monitoring** (1-minute EC2 metrics): ~$2.10/instance/month.
