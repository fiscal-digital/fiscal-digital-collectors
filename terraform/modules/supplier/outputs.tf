output "lambda_arn" {
  description = "ARN do Lambda supplier-collector."
  value       = aws_lambda_function.supplier_collector.arn
}

output "lambda_function_name" {
  description = "Nome da Lambda — input para `aws lambda update-function-code` no deploy.yml."
  value       = aws_lambda_function.supplier_collector.function_name
}

output "iam_role_arn" {
  description = "ARN do IAM role do Lambda."
  value       = aws_iam_role.supplier.arn
}

output "iam_role_name" {
  description = "Nome do IAM role."
  value       = aws_iam_role.supplier.name
}

output "log_group_name" {
  description = "Nome do CloudWatch log group."
  value       = aws_cloudwatch_log_group.supplier_collector.name
}

output "eventbridge_rule_arn" {
  description = "ARN do EventBridge rule que dispara o refresh diario."
  value       = aws_cloudwatch_event_rule.supplier_refresh_daily.arn
}

output "sqs_queue_arn" {
  description = "ARN da fila SQS enrich-on-demand."
  value       = aws_sqs_queue.supplier_enrich.arn
}

output "sqs_queue_url" {
  description = "URL da fila SQS enrich-on-demand (usada pelo analyzer/Fiscais)."
  value       = aws_sqs_queue.supplier_enrich.url
}

output "sqs_dlq_arn" {
  description = "ARN da DLQ — monitorar para mensagens parqueadas."
  value       = aws_sqs_queue.supplier_enrich_dlq.arn
}
