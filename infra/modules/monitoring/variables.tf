variable "name" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "partition" {
  type = string
}

variable "alert_email" {
  type    = string
  default = ""
}

variable "monthly_budget_usd" {
  type    = number
  default = 0
}

variable "instance_id" {
  type = string
}

variable "is_burstable_instance" {
  description = "true for t2/t3/t4g instances (adds a CPU credit balance alarm)."
  type        = bool
}

variable "monitor_data_volume" {
  description = "true when MongoDB runs locally on the /data volume."
  type        = bool
}

variable "metric_namespace" {
  type = string
}

variable "cloudfront_distribution_id" {
  type = string
}
