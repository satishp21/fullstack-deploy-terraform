output "instance_id" {
  value = aws_instance.app.id
}

output "instance_arn" {
  value = aws_instance.app.arn
}

output "public_ip" {
  value = aws_eip.app.public_ip
}

output "public_dns" {
  description = "Elastic IP public DNS name - used as the CloudFront API origin."
  value       = aws_eip.app.public_dns
}

output "security_group_id" {
  value = aws_security_group.app.id
}

output "role_arn" {
  value = aws_iam_role.app.arn
}

output "artifacts_bucket" {
  value = aws_s3_bucket.artifacts.id
}

output "artifacts_bucket_arn" {
  value = aws_s3_bucket.artifacts.arn
}

output "data_volume_id" {
  value = length(aws_ebs_volume.data) > 0 ? aws_ebs_volume.data[0].id : null
}

output "log_group_names" {
  value = local.log_group_names
}
