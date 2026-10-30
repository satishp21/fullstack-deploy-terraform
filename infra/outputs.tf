output "app_url" {
  description = "Public URL of the application."
  value       = module.cdn.app_url
}

output "api_health_url" {
  description = "Backend health check through CloudFront."
  value       = "${module.cdn.app_url}${var.health_check_path}"
}

output "cloudfront_domain_name" {
  description = "CloudFront domain (point a CNAME here if you manage DNS outside Route 53)."
  value       = module.cdn.domain_name
}

output "cloudfront_distribution_id" {
  value = module.cdn.distribution_id
}

output "frontend_bucket" {
  description = "S3 bucket holding the React build."
  value       = module.cdn.frontend_bucket
}

output "artifacts_bucket" {
  description = "S3 bucket holding server deployment files and MongoDB backups."
  value       = module.app_server.artifacts_bucket
}

output "ecr_repository_url" {
  description = "Container registry for backend images."
  value       = module.ecr.repository_url
}

output "instance_id" {
  value = module.app_server.instance_id
}

output "instance_type" {
  description = "Instance type in use (auto-selected when instance_type is empty)."
  value       = local.instance_type
}

output "elastic_ip" {
  description = "Static public IP of the app server (only reachable from CloudFront)."
  value       = module.app_server.public_ip
}

output "vpc_id" {
  value = module.network.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnets, for paid add-ons such as DocumentDB or an internal load balancer."
  value       = module.network.private_subnet_ids
}

output "app_security_group_id" {
  description = "Security group of the app server (allow it in a database's security group)."
  value       = module.app_server.security_group_id
}

output "ssm_session_command" {
  description = "Open a shell on the server (needs the AWS CLI Session Manager plugin). No SSH keys or open ports involved."
  value       = "aws ssm start-session --target ${module.app_server.instance_id} --region ${var.aws_region}"
}

output "log_groups" {
  description = "CloudWatch log groups."
  value       = module.app_server.log_group_names
}

output "dashboard_url" {
  description = "CloudWatch dashboard."
  value       = module.monitoring.dashboard_url
}

output "github_actions_variables" {
  description = "Repository variables to create in GitHub (Settings > Secrets and variables > Actions > Variables)."
  value = var.github_repository == "" ? null : {
    AWS_ROLE_ARN = module.github_oidc[0].role_arn
    AWS_REGION   = var.aws_region
    PROJECT_NAME = var.project_name
    DEPLOY_ENV   = var.environment
  }
}

output "deploy_manifest" {
  description = "Machine-readable summary used by scripts/deploy.mjs."
  value       = local.deploy_manifest
}
