# =============================================================================
# Configuration of the "prod" environment  ->  npm run deploy -- --env prod
#
# To add another environment (e.g. dev), copy this file to dev.tfvars and run
#   npm run deploy -- --env dev
# Secrets do NOT go here: copy example.secrets.tfvars to prod.secrets.tfvars (git-ignored).
# Every variable is documented in infra/variables.tf and in README.md.
# =============================================================================

# ----- Project ---------------------------------------------------------------
# Prefix for all resource names: 3-20 chars, lowercase letters/numbers/hyphens.
project_name = "mern-demo"

# Region to deploy into. Pick one close to your users (e.g. us-east-1, eu-west-1, ap-south-1).
aws_region = "us-east-1"

# ----- Alerts and cost control ----------------------------------------------------
# Alarm + budget emails. AWS sends confirmation emails you must click.
alert_email = ""

# Monthly budget for the whole AWS account (email at 50% / 80% / forecast 100%). 0 = off.
monthly_budget_usd = 10

# ----- App server -------------------------------------------------------------
# Empty = automatically pick the free-tier micro instance (t2.micro or t3.micro).
# Paid examples: "t3.small" (2 GiB RAM), "t4g.small" (ARM, cheaper per GiB).
instance_type = ""

# ----- Backend (Express) -----------------------------------------------------
backend_path      = "app/backend" # folder with package.json (relative to the repo root)
app_port          = 5000          # port your server listens on (receives PORT=<this>)
health_check_path = "/api/health" # must return HTTP 200 when healthy
api_path_patterns = ["/api/*"]    # paths CloudFront sends to the backend

# Plain (non-secret) environment variables for the backend container.
app_environment = {
  SMTP_PORT = "587"
}

# ----- Frontend (React) ------------------------------------------------------
frontend_path          = "app/frontend"
frontend_build_command = "npm ci && npm run build"
frontend_build_dir     = "dist" # "build" for Create React App
frontend_build_env     = { VITE_API_BASE_URL = "/api" }

# ----- Database --------------------------------------------------------------
# "local"    = MongoDB container on the server + EBS volume + daily S3 backups (free)
# "external" = MongoDB Atlas / DocumentDB; set mongodb_uri in prod.secrets.tfvars
database_mode        = "local"
mongodb_uri_env_name = "MONGO_URI" # env var your backend reads the connection string from

# ----- CI/CD (optional) ------------------------------------------------------
# "owner/repo" to let GitHub Actions deploy with short-lived credentials (OIDC).
github_repository = ""
github_branch     = "main"
