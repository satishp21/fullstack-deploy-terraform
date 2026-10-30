################################################################################
# CloudFront: one HTTPS endpoint for the whole app.
#   /api/* (api_path_patterns) -> app server (EC2), never cached
#   everything else            -> React build in a private S3 bucket, cached at the edge
# Same origin for frontend and API, so the browser needs no CORS.
# Free (always): 1 TB data transfer out, 10M requests, 2M function invocations per month.
################################################################################

locals {
  use_custom_domain = var.domain_name != ""
  # Certificate: created + DNS-validated here when the zone is in Route 53, otherwise supplied.
  create_certificate = local.use_custom_domain && var.acm_certificate_arn == ""
  manage_dns         = local.use_custom_domain && var.route53_zone_id != ""

  s3_origin_id  = "frontend-s3"
  api_origin_id = "api-ec2"
}

# AWS-managed policies (looked up by name instead of hard-coding their IDs).
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "Managed-SecurityHeadersPolicy"
}

################################################################################
# Frontend bucket - private; only this CloudFront distribution can read it (OAC).
################################################################################

resource "aws_s3_bucket" "frontend" {
  bucket = "${var.name}-web-${var.account_id}"

  # Lets `npm run destroy` delete the bucket with the website files in it.
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Versioning keeps previous builds for 30 days, so an accidental deletion can be undone.
resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.frontend]
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.name}-web"
  description                       = "CloudFront access to the ${var.name} frontend bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "frontend" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }

  # With ListBucket, a missing file returns 404 instead of 403.
  statement {
    sid       = "AllowCloudFrontList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.frontend.arn]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.frontend.arn, "${aws_s3_bucket.frontend.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend.json

  depends_on = [aws_s3_bucket_public_access_block.frontend]
}

################################################################################
# SPA routing (free: 2M invocations/month)
################################################################################

resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "${var.name}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Serve index.html for client-side routes"
  publish = true
  code    = file("${path.module}/functions/spa-rewrite.js")
}

################################################################################
# Optional custom domain: ACM certificate (free) validated through Route 53
################################################################################

resource "aws_acm_certificate" "this" {
  count    = local.create_certificate ? 1 : 0
  provider = aws.us_east_1 # CloudFront only uses certificates from us-east-1

  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = local.create_certificate ? {
    for option in aws_acm_certificate.this[0].domain_validation_options : option.domain_name => {
      name   = option.resource_record_name
      type   = option.resource_record_type
      record = option.resource_record_value
    }
  } : {}

  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  count    = local.create_certificate ? 1 : 0
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

locals {
  certificate_arn = local.create_certificate ? aws_acm_certificate_validation.this[0].certificate_arn : var.acm_certificate_arn
}

################################################################################
# Distribution
################################################################################

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  comment             = "${var.name} MERN app"
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  price_class         = var.price_class
  default_root_object = "index.html"
  aliases             = local.use_custom_domain ? [var.domain_name] : []

  # React build in S3, read through Origin Access Control.
  origin {
    origin_id                = local.s3_origin_id
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  # Express API on the app server. CloudFront -> server is plain HTTP on port 80, limited to
  # CloudFront IPs by the security group and authenticated by the secret header below.
  # (End-to-end TLS needs a certificate on the origin - see docs/COSTS_AND_UPGRADES.md.)
  origin {
    origin_id   = local.api_origin_id
    domain_name = var.api_origin_domain

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = var.origin_verify_secret
    }
  }

  # Frontend: cached at the edge, compressed, security headers added.
  default_cache_behavior {
    target_origin_id           = local.s3_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id

    dynamic "function_association" {
      for_each = var.enable_spa_routing ? [aws_cloudfront_function.spa_rewrite.arn] : []
      content {
        event_type   = "viewer-request"
        function_arn = function_association.value
      }
    }
  }

  # API: never cached; all headers (except Host), cookies and query strings are forwarded.
  dynamic "ordered_cache_behavior" {
    for_each = var.api_path_patterns
    content {
      path_pattern               = ordered_cache_behavior.value
      target_origin_id           = local.api_origin_id
      viewer_protocol_policy     = "redirect-to-https"
      allowed_methods            = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods             = ["GET", "HEAD"]
      compress                   = true
      cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
      origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
      response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = !local.use_custom_domain
    acm_certificate_arn            = local.use_custom_domain ? local.certificate_arn : null
    ssl_support_method             = local.use_custom_domain ? "sni-only" : null
    minimum_protocol_version       = local.use_custom_domain ? "TLSv1.2_2021" : "TLSv1"
  }

  tags = {
    Name = var.name
  }
}

resource "aws_route53_record" "alias" {
  for_each = local.manage_dns ? toset(["A", "AAAA"]) : toset([])

  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = each.value

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}
