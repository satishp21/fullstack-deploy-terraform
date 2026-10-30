################################################################################
# Project
################################################################################

variable "project_name" {
  description = "Short name used to prefix every resource. Lowercase letters, numbers and hyphens."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,18}[a-z0-9]$", var.project_name))
    error_message = "project_name must be 3-20 characters of lowercase letters, numbers and hyphens, starting with a letter."
  }
}

variable "environment" {
  description = "Environment name (prod, staging, dev...). Set automatically by scripts/deploy.mjs from --env."
  type        = string
  default     = "prod"

  validation {
    condition     = can(regex("^[a-z][a-z0-9]{1,9}$", var.environment))
    error_message = "environment must be 2-10 lowercase letters or numbers, starting with a letter."
  }
}

variable "aws_region" {
  description = "AWS region for all regional resources."
  type        = string
  default     = "us-east-1"
}

variable "tags" {
  description = "Extra tags applied to every resource."
  type        = map(string)
  default     = {}
}

################################################################################
# Network
################################################################################

variable "vpc_cidr" {
  description = "CIDR block of the VPC."
  type        = string
  default     = "10.20.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be a valid IPv4 CIDR block, e.g. 10.20.0.0/16."
  }
}

variable "az_count" {
  description = "Number of availability zones to create subnets in (the app server uses the first one)."
  type        = number
  default     = 2

  validation {
    condition     = var.az_count >= 1 && var.az_count <= 3
    error_message = "az_count must be between 1 and 3."
  }
}

variable "enable_nat_gateway" {
  description = "PAID (~$33/month). Creates a NAT gateway so private subnets get internet access. Not needed by the free-tier layout."
  type        = bool
  default     = false
}

variable "enable_vpc_flow_logs" {
  description = "Send VPC flow logs (rejected traffic) to CloudWatch Logs. Can exceed the 5 GB free log allowance on busy VPCs."
  type        = bool
  default     = false
}

################################################################################
# App server (EC2)
################################################################################

variable "instance_type" {
  description = "EC2 instance type. Empty = automatically pick the free-tier micro type for your account (t2.micro or t3.micro)."
  type        = string
  default     = ""
}

variable "cpu_credits" {
  description = "Burstable CPU credit mode. \"standard\" never bills extra for CPU (recommended on free tier) but a new T3/T4g starts with zero credits, so its first boot is slower. \"unlimited\" bursts freely and bills $0.05/vCPU-hour for sustained use above baseline."
  type        = string
  default     = "standard"

  validation {
    condition     = contains(["standard", "unlimited"], var.cpu_credits)
    error_message = "cpu_credits must be \"standard\" or \"unlimited\"."
  }
}

variable "root_volume_size_gb" {
  description = "Root EBS volume size (OS, Docker images, swap). Free tier covers 30 GB of EBS in total."
  type        = number
  default     = 20

  validation {
    condition     = var.root_volume_size_gb >= 10
    error_message = "root_volume_size_gb must be at least 10."
  }
}

variable "swap_size_mb" {
  description = "Swap file size in MiB. Micro instances have only 1 GiB of RAM; swap protects against out-of-memory kills. 0 disables it."
  type        = number
  default     = 2048
}

variable "docker_compose_version" {
  description = "Docker Compose plugin release installed on the server (github.com/docker/compose/releases)."
  type        = string
  default     = "v2.40.3"
}

variable "nginx_image" {
  description = "Container image for the nginx reverse proxy on the server."
  type        = string
  default     = "nginx:stable-alpine"
}

################################################################################
# Backend (Express API)
################################################################################

variable "backend_path" {
  description = "Path of the backend folder (contains package.json), relative to the repository root or absolute."
  type        = string
  default     = "app/backend"
}

variable "backend_dockerfile" {
  description = "Dockerfile for the backend, relative to the repository root. Empty = <backend_path>/Dockerfile if it exists, otherwise templates/Dockerfile.node."
  type        = string
  default     = ""
}

variable "app_port" {
  description = "Port your Express server listens on inside its container (the server is started with PORT set to this value)."
  type        = number
  default     = 8080

  validation {
    condition     = var.app_port >= 1 && var.app_port <= 65535
    error_message = "app_port must be a valid TCP port."
  }
}

variable "health_check_path" {
  description = "Backend URL path that returns HTTP 2xx when healthy. Must match one of api_path_patterns."
  type        = string
  default     = "/api/health"

  validation {
    condition     = startswith(var.health_check_path, "/")
    error_message = "health_check_path must start with \"/\"."
  }
}

variable "api_path_patterns" {
  description = "CloudFront path patterns routed to the backend; everything else is served from the React build. Add e.g. \"/socket.io/*\" for websockets."
  type        = list(string)
  default     = ["/api/*"]

  validation {
    condition     = length(var.api_path_patterns) >= 1 && length(var.api_path_patterns) <= 20 && alltrue([for p in var.api_path_patterns : startswith(p, "/") && p != "/*"])
    error_message = "api_path_patterns needs 1-20 patterns, each starting with \"/\" (and not \"/*\", which would hide the frontend)."
  }
}

variable "app_environment" {
  description = "Non-secret environment variables for the backend container (stored in SSM Parameter Store as String)."
  type        = map(string)
  default     = {}

  validation {
    condition     = alltrue([for k, v in var.app_environment : can(regex("^[A-Za-z_][A-Za-z0-9_]*$", k)) && v != ""])
    error_message = "app_environment keys must be valid variable names (letters, digits, underscore) and values must not be empty."
  }
}

variable "app_secrets" {
  description = "Secret environment variables for the backend container (SSM SecureString). Put them in environments/<env>.secrets.tfvars, never in git."
  type        = map(string)
  default     = {}
  sensitive   = true

  validation {
    condition     = alltrue([for k in nonsensitive(keys(var.app_secrets)) : can(regex("^[A-Za-z_][A-Za-z0-9_]*$", k))])
    error_message = "app_secrets keys must be valid variable names (letters, digits, underscore)."
  }
}

variable "client_max_body_size" {
  description = "Largest request body nginx accepts (e.g. file uploads), in nginx syntax: 10m, 512k..."
  type        = string
  default     = "10m"

  validation {
    condition     = can(regex("^[0-9]+[kKmMgG]?$", var.client_max_body_size))
    error_message = "client_max_body_size must look like 10m, 512k or 1g."
  }
}

################################################################################
# Frontend (React)
################################################################################

variable "frontend_path" {
  description = "Path of the React app folder (contains package.json), relative to the repository root or absolute."
  type        = string
  default     = "app/frontend"
}

variable "frontend_build_command" {
  description = "Shell command that builds the frontend, run inside frontend_path."
  type        = string
  default     = "npm ci && npm run build"
}

variable "frontend_build_dir" {
  description = "Build output folder inside frontend_path: \"dist\" for Vite, \"build\" for Create React App."
  type        = string
  default     = "dist"
}

variable "frontend_build_env" {
  description = "Environment variables for the frontend build, e.g. { VITE_APP_NAME = \"My app\" }. They end up in public JavaScript - never put secrets here."
  type        = map(string)
  default     = {}
}

variable "enable_spa_routing" {
  description = "Serve index.html for paths without a file extension so client-side routing (React Router) works on refresh."
  type        = bool
  default     = true
}

################################################################################
# Database (MongoDB)
################################################################################

variable "database_mode" {
  description = "\"local\" = MongoDB container on the app server with its own EBS volume and daily S3 backups (free). \"external\" = use mongodb_uri (MongoDB Atlas, Amazon DocumentDB...)."
  type        = string
  default     = "local"

  validation {
    condition     = contains(["local", "external"], var.database_mode)
    error_message = "database_mode must be \"local\" or \"external\"."
  }
}

variable "mongodb_uri" {
  description = "Connection string used when database_mode = \"external\". Put it in environments/<env>.secrets.tfvars."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = var.database_mode != "external" || nonsensitive(startswith(var.mongodb_uri, "mongodb://") || startswith(var.mongodb_uri, "mongodb+srv://"))
    error_message = "mongodb_uri (mongodb:// or mongodb+srv://) is required when database_mode = \"external\"."
  }
}

variable "mongodb_uri_env_name" {
  description = "Name of the environment variable your backend reads the connection string from (MONGODB_URI, MONGO_URI, DATABASE_URL...)."
  type        = string
  default     = "MONGODB_URI"

  validation {
    condition     = can(regex("^[A-Za-z_][A-Za-z0-9_]*$", var.mongodb_uri_env_name))
    error_message = "mongodb_uri_env_name must be a valid environment variable name."
  }
}

variable "mongo_database_name" {
  description = "Database name used in the generated connection string (database_mode = \"local\")."
  type        = string
  default     = "app"

  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{1,38}$", var.mongo_database_name))
    error_message = "mongo_database_name may contain letters, numbers, - and _ (max 38 characters)."
  }
}

variable "mongo_image" {
  description = "MongoDB container image (database_mode = \"local\")."
  type        = string
  default     = "mongo:8.0"
}

variable "mongo_cache_size_gb" {
  description = "WiredTiger cache size. Keep 0.25 on 1 GiB instances; raise on bigger ones (about 50% of RAM minus 1 GB)."
  type        = number
  default     = 0.25

  validation {
    condition     = var.mongo_cache_size_gb >= 0.25
    error_message = "mongo_cache_size_gb must be at least 0.25."
  }
}

variable "data_volume_size_gb" {
  description = "Size of the dedicated EBS volume that stores MongoDB data (database_mode = \"local\")."
  type        = number
  default     = 10

  validation {
    condition     = var.data_volume_size_gb >= 1
    error_message = "data_volume_size_gb must be at least 1."
  }
}

variable "backup_schedule" {
  description = "When the MongoDB backup to S3 runs, in systemd OnCalendar syntax (server time is UTC)."
  type        = string
  default     = "*-*-* 03:00:00"
}

variable "backup_retention_days" {
  description = "Days to keep MongoDB backups in S3."
  type        = number
  default     = 14

  validation {
    condition     = var.backup_retention_days >= 1
    error_message = "backup_retention_days must be at least 1."
  }
}

################################################################################
# CDN and custom domain
################################################################################

variable "domain_name" {
  description = "Optional custom domain (e.g. app.example.com). Empty = use the free *.cloudfront.net address."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone containing domain_name (~$0.50/month). Terraform then creates the certificate and DNS records."
  type        = string
  default     = ""

  validation {
    condition     = var.domain_name == "" || var.route53_zone_id != "" || var.acm_certificate_arn != ""
    error_message = "With domain_name, set route53_zone_id (DNS in Route 53) or acm_certificate_arn (DNS elsewhere)."
  }
}

variable "acm_certificate_arn" {
  description = "For DNS hosted outside Route 53: ARN of an ISSUED ACM certificate for domain_name in us-east-1. You then create a CNAME to cloudfront_domain_name yourself."
  type        = string
  default     = ""

  validation {
    condition     = var.acm_certificate_arn == "" || can(regex("^arn:aws[a-z-]*:acm:us-east-1:", var.acm_certificate_arn))
    error_message = "acm_certificate_arn must be an ACM certificate in us-east-1 (CloudFront only uses certificates from that region)."
  }
}

variable "cloudfront_price_class" {
  description = "CloudFront edge locations to use. PriceClass_100 = North America + Europe (cheapest); PriceClass_200 adds Asia, Middle East, Africa; PriceClass_All = everywhere."
  type        = string
  default     = "PriceClass_100"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.cloudfront_price_class)
    error_message = "cloudfront_price_class must be PriceClass_100, PriceClass_200 or PriceClass_All."
  }
}

################################################################################
# Monitoring and cost control
################################################################################

variable "alert_email" {
  description = "Email that receives alarm and budget notifications (confirm the subscription emails AWS sends). Empty = no notifications."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Monthly AWS cost budget for the whole account; emails at 50%/80% actual and 100% forecast. 0 disables it."
  type        = number
  default     = 10
}

variable "log_retention_days" {
  description = "How long CloudWatch keeps logs."
  type        = number
  default     = 14

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.log_retention_days)
    error_message = "log_retention_days must be a value CloudWatch supports (1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, ...)."
  }
}

################################################################################
# Container registry
################################################################################

variable "ecr_max_image_count" {
  description = "Number of backend images kept in ECR (older ones are deleted; they remain available for rollback until then)."
  type        = number
  default     = 10
}

################################################################################
# CI/CD (GitHub Actions)
################################################################################

variable "github_repository" {
  description = "\"owner/repo\" allowed to deploy through GitHub Actions (OIDC, no stored AWS keys). Empty = CI/CD role not created."
  type        = string
  default     = ""

  validation {
    condition     = var.github_repository == "" || can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must look like \"owner/repo\"."
  }
}

variable "github_branch" {
  description = "Branch whose workflows may deploy."
  type        = string
  default     = "main"
}

variable "create_github_oidc_provider" {
  description = "Create the account-wide GitHub OIDC identity provider. Set false if your account already has one (only one can exist)."
  type        = bool
  default     = true
}
