# Terraform state is stored in S3 (versioned + encrypted) with S3-native locking,
# so no DynamoDB lock table is needed.
#
# bucket / key / region are supplied at init time by scripts/deploy.mjs, which also
# creates the bucket the first time:
#   terraform init -backend-config="bucket=<project>-<env>-tfstate-<account-id>" \
#                  -backend-config="key=<project>/<env>/terraform.tfstate" \
#                  -backend-config="region=<aws-region>"
terraform {
  backend "s3" {
    encrypt      = true
    use_lockfile = true
  }
}
