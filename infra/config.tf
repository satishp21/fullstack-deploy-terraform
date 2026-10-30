################################################################################
# Runtime configuration and secrets, stored in SSM Parameter Store (standard tier: free).
#
#   <prefix>/app/<NAME>       -> environment variables of the backend container
#   <prefix>/internal/<NAME>  -> values used by the server itself (MongoDB and nginx secrets)
#   <prefix>/deploy/...       -> deployment state (current image tag, deploy manifest)
#
# The server reads them on every deployment (modules/app-server/files/bin/deploy-app.sh).
# Generated passwords are kept in the Terraform state, which is why the state bucket is
# private, versioned and encrypted.
################################################################################

resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

resource "random_password" "mongo_root" {
  count   = local.local_db ? 1 : 0
  length  = 32
  special = false
}

resource "random_password" "mongo_app" {
  count   = local.local_db ? 1 : 0
  length  = 32
  special = false
}

locals {
  mongodb_uri = local.local_db ? format(
    "mongodb://%s:%s@mongo:27017/%s?authSource=%s",
    local.mongo_app_username,
    random_password.mongo_app[0].result,
    var.mongo_database_name,
    var.mongo_database_name,
  ) : var.mongodb_uri

  app_secret_names = toset(nonsensitive(keys(var.app_secrets)))
}

# ---------------------------------------------------------------------------
# Backend environment variables
# ---------------------------------------------------------------------------

resource "aws_ssm_parameter" "mongodb_uri" {
  name        = "${local.path_prefix}/app/${var.mongodb_uri_env_name}"
  description = "MongoDB connection string for the backend"
  type        = "SecureString"
  value       = local.mongodb_uri

  lifecycle {
    precondition {
      condition = (
        length(setintersection(keys(var.app_environment), local.app_secret_names)) == 0 &&
        !contains(concat(keys(var.app_environment), tolist(local.app_secret_names)), var.mongodb_uri_env_name)
      )
      error_message = "The same variable name appears more than once across app_environment, app_secrets and mongodb_uri_env_name."
    }
  }
}

resource "aws_ssm_parameter" "app_environment" {
  for_each = var.app_environment

  name  = "${local.path_prefix}/app/${each.key}"
  type  = "String"
  value = each.value
}

resource "aws_ssm_parameter" "app_secrets" {
  for_each = local.app_secret_names

  name  = "${local.path_prefix}/app/${each.key}"
  type  = "SecureString"
  value = var.app_secrets[each.key]
}

# ---------------------------------------------------------------------------
# Server-internal secrets
# ---------------------------------------------------------------------------

resource "aws_ssm_parameter" "origin_verify_secret" {
  name        = "${local.path_prefix}/internal/ORIGIN_VERIFY_SECRET"
  description = "Secret header CloudFront adds to API requests; nginx rejects requests without it"
  type        = "SecureString"
  value       = random_password.origin_verify.result
}

resource "aws_ssm_parameter" "mongo_root_password" {
  count = local.local_db ? 1 : 0

  name        = "${local.path_prefix}/internal/MONGO_ROOT_PASSWORD"
  description = "MongoDB root password (backups and administration)"
  type        = "SecureString"
  value       = random_password.mongo_root[0].result
}

resource "aws_ssm_parameter" "mongo_app_password" {
  count = local.local_db ? 1 : 0

  name        = "${local.path_prefix}/internal/MONGO_APP_PASSWORD"
  description = "Password of the least-privilege MongoDB user the backend connects with"
  type        = "SecureString"
  value       = random_password.mongo_app[0].result
}

# ---------------------------------------------------------------------------
# Deployment state
# ---------------------------------------------------------------------------

# Last successfully deployed backend image tag. Written by scripts/deploy.mjs after each
# healthy rollout, so Terraform only creates it.
resource "aws_ssm_parameter" "image_tag" {
  name        = "${local.path_prefix}/deploy/image_tag"
  description = "Backend image tag currently deployed (updated by the deploy script)"
  type        = "String"
  value       = "none"

  lifecycle {
    ignore_changes = [value]
  }
}

# Everything the deploy script / CI pipeline needs to know about this environment.
locals {
  deploy_manifest = {
    project_name               = var.project_name
    environment                = var.environment
    name                       = local.name
    aws_region                 = var.aws_region
    account_id                 = local.account_id
    app_url                    = module.cdn.app_url
    cloudfront_distribution_id = module.cdn.distribution_id
    frontend_bucket            = module.cdn.frontend_bucket
    artifacts_bucket           = module.app_server.artifacts_bucket
    ecr_repository_url         = module.ecr.repository_url
    instance_id                = module.app_server.instance_id
    instance_type              = local.instance_type
    docker_platform            = local.docker_platform
    ssm_prefix                 = local.path_prefix
    image_tag_parameter        = aws_ssm_parameter.image_tag.name
    database_mode              = var.database_mode
    health_check_path          = var.health_check_path
    backend_path               = var.backend_path
    backend_dockerfile         = var.backend_dockerfile
    frontend_path              = var.frontend_path
    frontend_build_command     = var.frontend_build_command
    frontend_build_dir         = var.frontend_build_dir
    frontend_build_env         = var.frontend_build_env
    log_groups                 = module.app_server.log_group_names
    dashboard_url              = module.monitoring.dashboard_url
  }
}

resource "aws_ssm_parameter" "deploy_manifest" {
  name        = "${local.path_prefix}/deploy/manifest"
  description = "Deployment coordinates read by scripts/deploy.mjs --app-only and CI/CD"
  type        = "String"
  tier        = "Standard"
  value       = jsonencode(local.deploy_manifest)
}
