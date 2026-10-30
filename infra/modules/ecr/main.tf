variable "repository_name" {
  type = string
}

variable "max_image_count" {
  description = "Number of images to keep; older ones are expired by the lifecycle policy."
  type        = number
  default     = 10
}

################################################################################
# Private container registry for the backend image.
# Free tier: 500 MB/month of private storage for 12 months (legacy accounts);
# afterwards $0.10/GB-month. Image layers are shared, so 10 Node images take ~100-200 MB.
################################################################################

resource "aws_ecr_repository" "this" {
  name = var.repository_name

  # Tags can never be overwritten: every deployment pushes a unique tag
  # (timestamp + git commit), which makes rollbacks reliable.
  image_tag_mutability = "IMMUTABLE"

  # Lets `npm run destroy` delete the repository even when it still holds images.
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true # basic vulnerability scanning, free
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Delete untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the most recent ${var.max_image_count} images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.max_image_count
        }
        action = { type = "expire" }
      },
    ]
  })
}

output "repository_url" {
  value = aws_ecr_repository.this.repository_url
}

output "repository_arn" {
  value = aws_ecr_repository.this.arn
}
