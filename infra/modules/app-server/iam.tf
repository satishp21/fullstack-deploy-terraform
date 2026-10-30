################################################################################
# IAM role of the app server (via an instance profile). No access keys ever live
# on the server: the AWS CLI and Docker get short-lived credentials from IMDSv2.
################################################################################

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${var.name}-app-server"
  description        = "App server: SSM management, CloudWatch, ECR pull, own config and backups"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_instance_profile" "app" {
  name = "${var.name}-app-server"
  role = aws_iam_role.app.name
}

# Session Manager (shell without SSH) and Run Command (deployments).
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:${var.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# CloudWatch agent (memory/disk metrics, log files), Docker awslogs driver, custom metrics.
resource "aws_iam_role_policy_attachment" "cloudwatch_agent" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:${var.partition}:iam::aws:policy/CloudWatchAgentServerPolicy"
}

data "aws_iam_policy_document" "app" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPullBackendImage"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [var.ecr_repository_arn]
  }

  statement {
    sid       = "ListArtifacts"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.artifacts.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["deploy/*", "backups/*"]
    }
  }

  statement {
    sid       = "ReadDeployFiles"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/deploy/*"]
  }

  statement {
    sid       = "ReadWriteBackups"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload"]
    resources = ["${aws_s3_bucket.artifacts.arn}/backups/*"]
  }

  statement {
    sid = "ReadOwnConfiguration"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
    ]
    resources = ["arn:${var.partition}:ssm:${var.aws_region}:${var.account_id}:parameter${var.ssm_prefix}/*"]
  }
}

resource "aws_iam_role_policy" "app" {
  name   = "app-server"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}
