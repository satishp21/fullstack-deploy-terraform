################################################################################
# Instance type, CPU architecture and availability zones
################################################################################

# Instance types this account may use under the AWS Free Tier in this region.
data "aws_ec2_instance_types" "free_tier" {
  filter {
    name   = "free-tier-eligible"
    values = ["true"]
  }

  filter {
    name   = "processor-info.supported-architecture"
    values = ["x86_64"]
  }
}

locals {
  # Accounts created before 15 July 2025 get 750 free hours of t2.micro (t3.micro in regions
  # without t2); newer accounts are offered t3.micro. An explicit var.instance_type always wins.
  instance_type = var.instance_type != "" ? var.instance_type : (
    contains(data.aws_ec2_instance_types.free_tier.instance_types, "t2.micro") ? "t2.micro" : "t3.micro"
  )
}

data "aws_ec2_instance_type" "app" {
  instance_type = local.instance_type
}

locals {
  # Graviton (t4g, m7g...) instances need arm64 images; everything else uses x86_64.
  architecture    = contains(data.aws_ec2_instance_type.app.supported_architectures, "arm64") ? "arm64" : "x86_64"
  docker_platform = local.architecture == "arm64" ? "linux/arm64" : "linux/amd64"
}

data "aws_availability_zones" "available" {
  state = "available"

  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

# Not every AZ offers every instance type (t2.micro is missing in some), so only use AZs that do.
data "aws_ec2_instance_type_offerings" "app" {
  location_type = "availability-zone"

  filter {
    name   = "instance-type"
    values = [local.instance_type]
  }
}

locals {
  supported_azs = [
    for az in data.aws_availability_zones.available.names : az
    if contains(data.aws_ec2_instance_type_offerings.app.locations, az)
  ]
  azs = slice(local.supported_azs, 0, min(var.az_count, length(local.supported_azs)))
}

################################################################################
# Modules
################################################################################

module "network" {
  source = "./modules/network"

  name               = local.name
  aws_region         = var.aws_region
  vpc_cidr           = var.vpc_cidr
  azs                = local.azs
  enable_nat_gateway = var.enable_nat_gateway
  enable_flow_logs   = var.enable_vpc_flow_logs
  log_group_prefix   = local.path_prefix
  log_retention_days = var.log_retention_days
}

module "ecr" {
  source = "./modules/ecr"

  repository_name = "${local.name}/backend"
  max_image_count = var.ecr_max_image_count
}

module "app_server" {
  source = "./modules/app-server"

  name         = local.name
  project_name = var.project_name
  environment  = var.environment
  aws_region   = var.aws_region
  account_id   = local.account_id
  partition    = local.partition

  vpc_id            = module.network.vpc_id
  subnet_id         = module.network.public_subnet_ids[0]
  availability_zone = local.azs[0]

  instance_type          = local.instance_type
  architecture           = local.architecture
  cpu_credits            = var.cpu_credits
  root_volume_size_gb    = var.root_volume_size_gb
  swap_size_mb           = var.swap_size_mb
  docker_compose_version = var.docker_compose_version
  nginx_image            = var.nginx_image

  app_port             = var.app_port
  health_check_path    = var.health_check_path
  client_max_body_size = var.client_max_body_size
  ecr_repository_url   = module.ecr.repository_url
  ecr_repository_arn   = module.ecr.repository_arn
  ssm_prefix           = local.path_prefix
  metric_namespace     = local.metric_namespace

  database_mode         = var.database_mode
  mongo_image           = var.mongo_image
  mongo_cache_size_gb   = var.mongo_cache_size_gb
  mongo_database_name   = var.mongo_database_name
  mongo_root_username   = local.mongo_root_username
  mongo_app_username    = local.mongo_app_username
  data_volume_size_gb   = var.data_volume_size_gb
  backup_schedule       = var.backup_schedule
  backup_retention_days = var.backup_retention_days

  log_group_prefix   = local.path_prefix
  log_retention_days = var.log_retention_days
}

module "cdn" {
  source = "./modules/cdn"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name                 = local.name
  account_id           = local.account_id
  api_origin_domain    = module.app_server.public_dns
  api_path_patterns    = var.api_path_patterns
  origin_verify_secret = random_password.origin_verify.result
  enable_spa_routing   = var.enable_spa_routing
  price_class          = var.cloudfront_price_class
  domain_name          = var.domain_name
  route53_zone_id      = var.route53_zone_id
  acm_certificate_arn  = var.acm_certificate_arn
}

module "monitoring" {
  source = "./modules/monitoring"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name                       = local.name
  aws_region                 = var.aws_region
  partition                  = local.partition
  alert_email                = var.alert_email
  monthly_budget_usd         = var.monthly_budget_usd
  instance_id                = module.app_server.instance_id
  is_burstable_instance      = data.aws_ec2_instance_type.app.burstable_performance_supported
  monitor_data_volume        = local.local_db
  metric_namespace           = local.metric_namespace
  cloudfront_distribution_id = module.cdn.distribution_id
}

module "github_oidc" {
  source = "./modules/github-oidc"
  count  = var.github_repository != "" ? 1 : 0

  name                        = local.name
  environment                 = var.environment
  aws_region                  = var.aws_region
  partition                   = local.partition
  github_repository           = var.github_repository
  github_branch               = var.github_branch
  create_oidc_provider        = var.create_github_oidc_provider
  ecr_repository_arn          = module.ecr.repository_arn
  frontend_bucket_arn         = module.cdn.frontend_bucket_arn
  cloudfront_distribution_arn = module.cdn.distribution_arn
  instance_arn                = module.app_server.instance_arn
  readable_parameter_arns     = [aws_ssm_parameter.deploy_manifest.arn, aws_ssm_parameter.image_tag.arn]
  image_tag_parameter_arn     = aws_ssm_parameter.image_tag.arn
}
