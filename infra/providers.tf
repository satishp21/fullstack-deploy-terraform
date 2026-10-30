provider "aws" {
  region = var.aws_region

  # Every resource gets Project / Environment / ManagedBy tags: used for cost tracking
  # and by scripts/destroy.mjs to find anything left behind.
  default_tags {
    tags = local.common_tags
  }
}

# CloudFront is a global service whose certificates (ACM) and metrics live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = local.common_tags
  }
}
