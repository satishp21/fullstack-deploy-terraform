variable "name" {
  description = "Resource name prefix (<project>-<environment>)."
  type        = string
}

variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "account_id" {
  type = string
}

variable "partition" {
  type = string
}

# ----- Placement -------------------------------------------------------------

variable "vpc_id" {
  type = string
}

variable "subnet_id" {
  description = "Public subnet for the instance."
  type        = string
}

variable "availability_zone" {
  description = "AZ of subnet_id (the data volume must live in the same AZ)."
  type        = string
}

# ----- Instance --------------------------------------------------------------

variable "instance_type" {
  type = string
}

variable "architecture" {
  description = "x86_64 or arm64; selects the Amazon Linux 2023 AMI."
  type        = string
}

variable "cpu_credits" {
  type = string
}

variable "root_volume_size_gb" {
  type = number
}

variable "swap_size_mb" {
  type = number
}

variable "docker_compose_version" {
  type = string
}

variable "nginx_image" {
  type = string
}

# ----- Application -----------------------------------------------------------

variable "app_port" {
  type = number
}

variable "health_check_path" {
  type = string
}

variable "client_max_body_size" {
  type = string
}

variable "ecr_repository_url" {
  type = string
}

variable "ecr_repository_arn" {
  type = string
}

variable "ssm_prefix" {
  description = "Parameter Store hierarchy the server may read (/<project>/<env>)."
  type        = string
}

variable "metric_namespace" {
  description = "CloudWatch namespace of the AppHealthy metric."
  type        = string
}

# ----- Database --------------------------------------------------------------

variable "database_mode" {
  type = string
}

variable "mongo_image" {
  type = string
}

variable "mongo_cache_size_gb" {
  type = number
}

variable "mongo_database_name" {
  type = string
}

variable "mongo_root_username" {
  type = string
}

variable "mongo_app_username" {
  type = string
}

variable "data_volume_size_gb" {
  type = number
}

variable "backup_schedule" {
  type = string
}

variable "backup_retention_days" {
  type = number
}

# ----- Logging ---------------------------------------------------------------

variable "log_group_prefix" {
  type = string
}

variable "log_retention_days" {
  type = number
}
