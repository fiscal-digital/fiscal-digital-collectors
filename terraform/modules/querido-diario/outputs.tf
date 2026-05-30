output "lambda_arn" {
  description = "ARN do Lambda collector — usado para referencia cross-state no cutover α."
  value       = aws_lambda_function.collector.arn
}

output "lambda_function_name" {
  description = "Nome da Lambda — input para `aws lambda update-function-code` no deploy.yml."
  value       = aws_lambda_function.collector.function_name
}

output "iam_role_arn" {
  description = "ARN do IAM role assumido pelo Lambda."
  value       = aws_iam_role.collector.arn
}

output "iam_role_name" {
  description = "Nome do IAM role — util para attachments adicionais externos ao modulo."
  value       = aws_iam_role.collector.name
}

output "log_group_name" {
  description = "Nome do CloudWatch log group."
  value       = aws_cloudwatch_log_group.collector.name
}

output "eventbridge_rule_arn" {
  description = "ARN do EventBridge rule que dispara o schedule diario."
  value       = aws_cloudwatch_event_rule.collector_daily.arn
}
