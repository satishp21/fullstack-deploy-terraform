variable "name" {
  description = "Name prefix for resources."
  type        = string
}

variable "aws_region" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "azs" {
  description = "Availability zones to create one public and one private subnet in."
  type        = list(string)

  validation {
    condition     = length(var.azs) >= 1
    error_message = "At least one availability zone is required (none offers the selected instance type?)."
  }
}

variable "enable_nat_gateway" {
  type    = bool
  default = false
}

variable "enable_flow_logs" {
  type    = bool
  default = false
}

variable "log_group_prefix" {
  type = string
}

variable "log_retention_days" {
  type = number
}
