data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

locals {
  name       = "${var.project_name}-${var.environment}"
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition

  # SSM parameters and CloudWatch log groups share one hierarchy: /<project>/<env>/...
  path_prefix      = "/${var.project_name}/${var.environment}"
  metric_namespace = "${var.project_name}/${var.environment}"

  local_db            = var.database_mode == "local"
  mongo_root_username = "root"
  mongo_app_username  = "app"

  common_tags = merge(var.tags, {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  })
}
