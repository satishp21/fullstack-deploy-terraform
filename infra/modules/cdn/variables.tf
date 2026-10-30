variable "name" {
  type = string
}

variable "account_id" {
  type = string
}

variable "api_origin_domain" {
  description = "Public DNS name of the app server (Elastic IP)."
  type        = string
}

variable "api_path_patterns" {
  type = list(string)
}

variable "origin_verify_secret" {
  description = "Value of the X-Origin-Verify header CloudFront sends to the app server."
  type        = string
  sensitive   = true
}

variable "enable_spa_routing" {
  type = bool
}

variable "price_class" {
  type = string
}

variable "domain_name" {
  type    = string
  default = ""
}

variable "route53_zone_id" {
  description = "Hosted zone for domain_name: Terraform creates the certificate and DNS records."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "Existing us-east-1 certificate for domain_name (DNS hosted outside Route 53)."
  type        = string
  default     = ""
}
