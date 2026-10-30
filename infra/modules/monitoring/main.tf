################################################################################
# Alerting: SNS topic -> email. CloudWatch alarms can only notify topics in their own
# region, so the CloudFront alarm (us-east-1) gets a second topic there.
# Always free: 10 alarms, 1,000 email notifications/month.
################################################################################

locals {
  notify = var.alert_email != ""
}

resource "aws_sns_topic" "alerts" {
  name = "${var.name}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  count = local.notify ? 1 : 0

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_sns_topic" "alerts_global" {
  provider = aws.us_east_1

  name = "${var.name}-alerts-global"
}

resource "aws_sns_topic_subscription" "email_global" {
  count    = local.notify ? 1 : 0
  provider = aws.us_east_1

  topic_arn = aws_sns_topic.alerts_global.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

locals {
  actions        = [aws_sns_topic.alerts.arn]
  global_actions = [aws_sns_topic.alerts_global.arn]
  instance_dims  = { InstanceId = var.instance_id }
}

################################################################################
# EC2 health
################################################################################

# The OS stopped responding (kernel panic, out of memory, broken network): reboot it.
resource "aws_cloudwatch_metric_alarm" "instance_status_check" {
  alarm_name          = "${var.name}-instance-status-check"
  alarm_description   = "Instance status check failing for 3 minutes - rebooting the instance."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_Instance"
  dimensions          = local.instance_dims
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = concat(local.actions, ["arn:${var.partition}:automate:${var.aws_region}:ec2:reboot"])
  ok_actions          = local.actions
}

# AWS hardware/host problem. EC2 automatic recovery (enabled on the instance) moves it to
# healthy hardware; this alarm only notifies you.
resource "aws_cloudwatch_metric_alarm" "system_status_check" {
  alarm_name          = "${var.name}-system-status-check"
  alarm_description   = "System (AWS host) status check failing - EC2 automatic recovery will move the instance."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  dimensions          = local.instance_dims
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  alarm_name          = "${var.name}-cpu-high"
  alarm_description   = "Average CPU above 80% for 15 minutes."
  namespace           = "AWS/EC2"
  metric_name         = "CPUUtilization"
  dimensions          = local.instance_dims
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

# Burstable instances (t2/t3/t4g) slow down to their baseline when credits run out.
# A full hour below the threshold is required: new T3/T4g instances start with zero credits,
# and the alarm shouldn't fire just because a server was (re)created.
resource "aws_cloudwatch_metric_alarm" "cpu_credits_low" {
  count = var.is_burstable_instance ? 1 : 0

  alarm_name          = "${var.name}-cpu-credits-low"
  alarm_description   = "CPU credit balance near zero for an hour - the instance is throttled to its baseline. Optimise CPU use or choose a bigger instance."
  namespace           = "AWS/EC2"
  metric_name         = "CPUCreditBalance"
  dimensions          = local.instance_dims
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 12
  threshold           = 5
  comparison_operator = "LessThanThreshold"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

# Memory and disk come from the CloudWatch agent (namespace CWAgent).
resource "aws_cloudwatch_metric_alarm" "memory_high" {
  alarm_name          = "${var.name}-memory-high"
  alarm_description   = "Memory above 90% for 15 minutes - risk of out-of-memory kills."
  namespace           = "CWAgent"
  metric_name         = "mem_used_percent"
  dimensions          = local.instance_dims
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 90
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_metric_alarm" "disk_root_high" {
  alarm_name          = "${var.name}-disk-root-high"
  alarm_description   = "Root volume more than 85% full."
  namespace           = "CWAgent"
  metric_name         = "disk_used_percent"
  dimensions          = merge(local.instance_dims, { path = "/", fstype = "xfs" })
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_metric_alarm" "disk_data_high" {
  count = var.monitor_data_volume ? 1 : 0

  alarm_name          = "${var.name}-disk-data-high"
  alarm_description   = "MongoDB data volume more than 80% full - grow data_volume_size_gb."
  namespace           = "CWAgent"
  metric_name         = "disk_used_percent"
  dimensions          = merge(local.instance_dims, { path = "/data", fstype = "xfs" })
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

################################################################################
# Application health: AppHealthy is published every minute by the server itself
# (healthcheck.sh). No data at all means the server is down -> INSUFFICIENT_DATA
# also notifies.
################################################################################

resource "aws_cloudwatch_metric_alarm" "app_unhealthy" {
  alarm_name                = "${var.name}-app-unhealthy"
  alarm_description         = "The API health check is failing (or the server stopped reporting)."
  namespace                 = var.metric_namespace
  metric_name               = "AppHealthy"
  statistic                 = "Minimum"
  period                    = 60
  evaluation_periods        = 3
  threshold                 = 1
  comparison_operator       = "LessThanThreshold"
  treat_missing_data        = "missing"
  alarm_actions             = local.actions
  ok_actions                = local.actions
  insufficient_data_actions = local.actions
}

################################################################################
# CloudFront 5xx error rate, ignoring periods with too few requests to be meaningful.
################################################################################

resource "aws_cloudwatch_metric_alarm" "cloudfront_5xx" {
  provider = aws.us_east_1

  alarm_name          = "${var.name}-cloudfront-5xx"
  alarm_description   = "More than 5% of requests returned 5xx (with at least 20 requests in 5 minutes)."
  comparison_operator = "GreaterThanThreshold"
  threshold           = 5
  evaluation_periods  = 2
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.global_actions
  ok_actions          = local.global_actions

  metric_query {
    id          = "rate"
    expression  = "IF(requests >= 20, errors, 0)"
    label       = "5xx error rate (%)"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      namespace   = "AWS/CloudFront"
      metric_name = "5xxErrorRate"
      period      = 300
      stat        = "Average"
      dimensions  = { DistributionId = var.cloudfront_distribution_id, Region = "Global" }
    }
  }

  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/CloudFront"
      metric_name = "Requests"
      period      = 300
      stat        = "Sum"
      dimensions  = { DistributionId = var.cloudfront_distribution_id, Region = "Global" }
    }
  }
}

################################################################################
# Dashboard (free: 3 dashboards with up to 50 metrics each)
################################################################################

locals {
  disk_paths = var.monitor_data_volume ? ["/", "/data"] : ["/"]

  dashboard_widgets = [
    {
      type = "metric", x = 0, y = 0, width = 12, height = 6
      properties = {
        title   = "API health (1 = healthy)"
        region  = var.aws_region
        view    = "timeSeries"
        stat    = "Minimum"
        period  = 60
        metrics = [[var.metric_namespace, "AppHealthy"]]
        yAxis   = { left = { min = 0, max = 1 } }
      }
    },
    {
      type = "metric", x = 12, y = 0, width = 12, height = 6
      properties = {
        title  = "CloudFront requests"
        region = "us-east-1"
        view   = "timeSeries"
        stat   = "Sum"
        period = 300
        metrics = [
          ["AWS/CloudFront", "Requests", "DistributionId", var.cloudfront_distribution_id, "Region", "Global"],
        ]
      }
    },
    {
      type = "metric", x = 0, y = 6, width = 12, height = 6
      properties = {
        title  = "CloudFront error rates (%)"
        region = "us-east-1"
        view   = "timeSeries"
        stat   = "Average"
        period = 300
        metrics = [
          ["AWS/CloudFront", "4xxErrorRate", "DistributionId", var.cloudfront_distribution_id, "Region", "Global"],
          ["AWS/CloudFront", "5xxErrorRate", "DistributionId", var.cloudfront_distribution_id, "Region", "Global"],
        ]
      }
    },
    {
      type = "metric", x = 12, y = 6, width = 12, height = 6
      properties = {
        title  = "EC2 CPU (%) and CPU credit balance"
        region = var.aws_region
        view   = "timeSeries"
        stat   = "Average"
        period = 300
        metrics = [
          ["AWS/EC2", "CPUUtilization", "InstanceId", var.instance_id],
          ["AWS/EC2", "CPUCreditBalance", "InstanceId", var.instance_id, { yAxis = "right" }],
        ]
      }
    },
    {
      type = "metric", x = 0, y = 12, width = 12, height = 6
      properties = {
        title  = "Memory and swap used (%)"
        region = var.aws_region
        view   = "timeSeries"
        stat   = "Average"
        period = 300
        metrics = [
          ["CWAgent", "mem_used_percent", "InstanceId", var.instance_id],
          ["CWAgent", "swap_used_percent", "InstanceId", var.instance_id],
        ]
        yAxis = { left = { min = 0, max = 100 } }
      }
    },
    {
      type = "metric", x = 12, y = 12, width = 12, height = 6
      properties = {
        title   = "Disk used (%)"
        region  = var.aws_region
        view    = "timeSeries"
        stat    = "Maximum"
        period  = 300
        metrics = [for p in local.disk_paths : ["CWAgent", "disk_used_percent", "InstanceId", var.instance_id, "path", p, "fstype", "xfs"]]
        yAxis   = { left = { min = 0, max = 100 } }
      }
    },
  ]
}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = var.name
  dashboard_body = jsonencode({ widgets = local.dashboard_widgets })
}

################################################################################
# Cost guard-rail: account-wide monthly budget with email alerts.
################################################################################

resource "aws_budgets_budget" "monthly" {
  count = var.monthly_budget_usd > 0 && local.notify ? 1 : 0

  name         = "${var.name}-monthly-cost"
  budget_type  = "COST"
  limit_amount = format("%.1f", var.monthly_budget_usd) # AWS stores e.g. "10.0"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}
