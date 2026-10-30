# Tearing everything down

## One command

```bash
npm run destroy                    # environment "prod"
npm run destroy -- --env dev       # another environment
npm run destroy -- --yes           # no prompt (automation)
npm run destroy -- --keep-state    # keep the Terraform state bucket
```

The script asks you to type the environment name (e.g. `mern-demo-prod`) and then:

1. **`terraform destroy`** of everything in the environment's state (CloudFront deletion takes 5-15 minutes):

   | Deleted | Notes |
   |---|---|
   | CloudFront distribution, CloudFront Function, Origin Access Control | Terraform disables the distribution, waits, then deletes it |
   | Website S3 bucket and **all object versions** | `force_destroy = true` |
   | Artifacts S3 bucket: server files and **all MongoDB backups** | `force_destroy = true` |
   | EC2 instance, root volume, **MongoDB data volume**, Elastic IP | The instance is stopped before the data volume is detached |
   | ECR repository and **all images** | `force_delete = true` |
   | SSM parameters (config, secrets, deploy manifest, image tag) | |
   | CloudWatch log groups, alarms, dashboard; SNS topics and subscriptions; budget | |
   | IAM roles, policies, instance profile; GitHub OIDC role (and provider, if this stack created it) | |
   | VPC, subnets, route tables, internet gateway, S3 endpoint, security groups, NAT gateway (if enabled) | |
   | ACM certificate and Route 53 records (if a custom domain was configured) | **The hosted zone itself is not deleted**; it wasn't created by this project |

2. **The state bucket** `<project>-<env>-tfstate-<account>`, all versions included.
3. **Leftover SSM parameters** under `/<project>/<env>/` that someone added by hand.
4. **Leftover scan**: lists any resource still tagged `Project=<project>`, `Environment=<env>` in your region and us-east-1. The tagging index can lag 5-10 minutes behind deletions, so a resource that was just deleted may still show up briefly. Run `npm run destroy` again later to re-check (safe: it only reports).

## Before you destroy

- **Keep your data?** `npm run ops -- backup`, then download it:
  `aws s3 cp s3://<project>-<env>-artifacts-<account>/backups/mongo/<...>.archive.gz .`
  (`npm run ops -- backups` lists the keys.)
- **Shared GitHub OIDC provider:** if this environment created the account's GitHub OIDC provider (`create_github_oidc_provider = true`) and another project uses it, destroying this environment removes it and breaks the other project's CI. Set `create_github_oidc_provider = false` and `npm run deploy` first, then destroy (or recreate it from the other project).

## Verify that nothing is left

1. The script's leftover scan says *Nothing tagged with this project/environment remains*.
2. Console → **Resource Groups & Tag Editor → Tag Editor**: regions = your region + us-east-1, resource types = All, tag `Project` = your project name → *Search*.
3. Console → **Billing → Bills**: the current month still shows usage up to the deletion time, and next month shows nothing for these services.
4. Optional manual checks: EC2 → Elastic IPs (unattached EIPs cost money), EC2 → Volumes, EC2 → Snapshots, S3, CloudFront.

## If destroy fails halfway

Just run `npm run destroy` again; it's idempotent. Common causes:

| Error | Cause / fix |
|---|---|
| `DistributionNotDisabled` / timeout on CloudFront | Propagation can be slow; re-run |
| `DependencyViolation` on a security group or subnet | Something created **outside** Terraform uses the VPC (e.g. a manual EC2 instance, Lambda ENIs). Delete it, then re-run |
| `Error acquiring the state lock` | A previous run was interrupted. `terraform -chdir=infra force-unlock <LOCK_ID>` (ID shown in the error), then re-run |
| `ExpiredToken` / credentials errors | Log in again (`aws sso login`) and re-run |
| Missing `infra/environments/<env>.tfvars` | Terraform needs the same configuration to destroy. Restore the file (at least `project_name` and `aws_region`) and re-run |
| Missing secrets file with `database_mode = "external"` | Handled: the script passes a placeholder `mongodb_uri` for destroy |

**Last resort.** If the state bucket is gone but resources still exist (e.g. it was deleted by hand), find everything with the Tag Editor (all resources are tagged) and delete it in the console. Work in dependency order: CloudFront → EC2 instance → volumes/EIP → S3 buckets → ECR → VPC (deleting the VPC removes subnets, route tables, gateways) → IAM roles → SSM parameters → CloudWatch.

## Closing the AWS account entirely

If you used a dedicated AWS account just for learning: after `npm run destroy`, go to the root user's *Account* page → *Close account*. AWS deletes any remaining resources after the post-closure period.
