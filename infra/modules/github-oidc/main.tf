################################################################################
# GitHub Actions -> AWS without stored access keys.
# GitHub issues a short-lived OIDC token per workflow run; AWS exchanges it for
# temporary credentials of this role, but only for the configured repo + branch
# (or GitHub environment). The role can deploy the app and nothing else.
################################################################################

variable "name" {
  type = string
}

variable "environment" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "partition" {
  type = string
}

variable "github_repository" {
  description = "owner/repo"
  type        = string
}

variable "github_branch" {
  type = string
}

variable "create_oidc_provider" {
  type = bool
}

variable "ecr_repository_arn" {
  type = string
}

variable "frontend_bucket_arn" {
  type = string
}

variable "cloudfront_distribution_arn" {
  type = string
}

variable "instance_arn" {
  type = string
}

variable "readable_parameter_arns" {
  type = list(string)
}

variable "image_tag_parameter_arn" {
  type = string
}

locals {
  github_oidc_url = "https://token.actions.githubusercontent.com"
}

# Only one GitHub provider can exist per AWS account. Set create_github_oidc_provider = false
# if another project already created it.
resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 1 : 0

  url            = local.github_oidc_url
  client_id_list = ["sts.amazonaws.com"]
  # AWS validates GitHub's certificate through its own trust store; the thumbprints are
  # kept for compatibility with older tooling.
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 0 : 1

  url = local.github_oidc_url
}

locals {
  oidc_provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Pushes to the deploy branch, or jobs that use the GitHub environment named like ours.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repository}:ref:refs/heads/${var.github_branch}",
        "repo:${var.github_repository}:environment:${var.environment}",
      ]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "${var.name}-github-deploy"
  description          = "Assumed by GitHub Actions (${var.github_repository}) to deploy ${var.name}"
  assume_role_policy   = data.aws_iam_policy_document.assume.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPushBackend"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [var.ecr_repository_arn]
  }

  statement {
    sid       = "ListFrontendBucket"
    actions   = ["s3:ListBucket"]
    resources = [var.frontend_bucket_arn]
  }

  statement {
    sid       = "WriteFrontendFiles"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${var.frontend_bucket_arn}/*"]
  }

  statement {
    sid       = "InvalidateCdnCache"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = [var.cloudfront_distribution_arn]
  }

  statement {
    sid       = "ReadDeployState"
    actions   = ["ssm:GetParameter"]
    resources = var.readable_parameter_arns
  }

  statement {
    sid       = "RecordDeployedTag"
    actions   = ["ssm:PutParameter"]
    resources = [var.image_tag_parameter_arn]
  }

  statement {
    sid     = "RunDeployOnServer"
    actions = ["ssm:SendCommand"]
    resources = [
      var.instance_arn,
      "arn:${var.partition}:ssm:${var.aws_region}::document/AWS-RunShellScript",
    ]
  }

  statement {
    sid = "TrackDeployCommand"
    actions = [
      "ssm:DescribeInstanceInformation",
      "ssm:GetCommandInvocation",
      "ssm:ListCommandInvocations",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy-app"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}

output "role_arn" {
  value = aws_iam_role.deploy.arn
}
