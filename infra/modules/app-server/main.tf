################################################################################
# The application server: one EC2 instance running Docker Compose
#   nginx (port 80, only reachable from CloudFront) -> Express API -> MongoDB (optional)
#
# Resilience on a single instance:
#   - EC2 automatic recovery moves the instance to healthy hardware on host failure
#   - CloudWatch alarm reboots it when the OS stops responding (monitoring module)
#   - containers restart automatically; Docker starts on boot
#   - MongoDB data lives on a separate EBS volume that survives instance replacement
#   - the Elastic IP keeps the CloudFront origin address stable
################################################################################

locals {
  local_db = var.database_mode == "local"
}

# Latest Amazon Linux 2023 AMI (ignored after creation - see lifecycle below).
data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-${var.architecture}"
}

# AWS-managed list of the IP ranges CloudFront uses to reach origins.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

################################################################################
# Security group: HTTP from CloudFront only. No SSH - shell access is through
# SSM Session Manager, so no inbound port besides 80 is ever open.
################################################################################

resource "aws_security_group" "app" {
  name_prefix = "${var.name}-app-"
  description = "App server: HTTP from CloudFront only"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.name}-app"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "http_from_cloudfront" {
  security_group_id = aws_security_group.app.id
  description       = "HTTP from CloudFront origin-facing servers"
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.app.id
  description       = "Outbound: ECR, S3, SSM, CloudWatch, OS packages, external database"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

################################################################################
# Elastic IP: a stable public address (and DNS name) for the CloudFront origin.
################################################################################

resource "aws_eip" "app" {
  domain = "vpc"

  tags = {
    Name = "${var.name}-app"
  }
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}

################################################################################
# EC2 instance
################################################################################

# Tracks the CPU architecture so that switching between x86 and ARM (e.g. t3.micro ->
# t4g.small) replaces the instance: an x86 AMI cannot boot on ARM hardware.
resource "terraform_data" "architecture" {
  input = var.architecture
}

resource "aws_instance" "app" {
  ami                    = data.aws_ssm_parameter.al2023_ami.value
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name
  monitoring             = false # detailed (1-minute) monitoring is paid

  # Minimal first-boot script: download the deploy files from S3 and run bootstrap.sh.
  user_data = replace(templatefile("${path.module}/templates/user-data.sh.tftpl", {
    artifacts_bucket = aws_s3_bucket.artifacts.id
    aws_region       = var.aws_region
  }), "\r\n", "\n")

  # "standard" = the instance is throttled instead of billed when it runs out of CPU credits.
  dynamic "credit_specification" {
    for_each = can(regex("^t[0-9]", var.instance_type)) ? [1] : []
    content {
      cpu_credits = var.cpu_credits
    }
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # IMDSv2 only (blocks SSRF-style credential theft)
    http_put_response_hop_limit = 2          # lets containers use the instance role if your app needs AWS APIs
  }

  maintenance_options {
    auto_recovery = "default"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size_gb
    encrypted             = true
    delete_on_termination = true

    tags = {
      Name = "${var.name}-root"
    }
  }

  tags = {
    Name = "${var.name}-app"
  }

  lifecycle {
    # Don't replace the server whenever AWS publishes a new AMI or the boot script changes.
    # To move to the latest AMI on purpose: npm run deploy -- --replace-server
    # (= terraform apply -replace="module.app_server.aws_instance.app").
    ignore_changes = [ami, user_data]

    # ...but an architecture change does replace it (data volume and Elastic IP move over).
    replace_triggered_by = [terraform_data.architecture]
  }

  # The boot script needs its files in S3 and its IAM permissions in place.
  depends_on = [
    aws_s3_object.deploy_files,
    aws_s3_object.settings,
    aws_s3_object.cloudwatch_agent_config,
    aws_iam_role_policy.app,
    aws_iam_role_policy_attachment.ssm_core,
    aws_iam_role_policy_attachment.cloudwatch_agent,
  ]
}

################################################################################
# MongoDB data volume (database_mode = "local")
# Separate from the root disk so the data survives instance replacement.
################################################################################

resource "aws_ebs_volume" "data" {
  count = local.local_db ? 1 : 0

  availability_zone = var.availability_zone
  size              = var.data_volume_size_gb
  type              = "gp3"
  encrypted         = true

  tags = {
    Name = "${var.name}-mongo-data"
  }
}

resource "aws_volume_attachment" "data" {
  count = local.local_db ? 1 : 0

  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data[0].id
  instance_id = aws_instance.app.id

  # Stop the instance (clean MongoDB shutdown) before detaching on replace/destroy.
  stop_instance_before_detaching = true
}
