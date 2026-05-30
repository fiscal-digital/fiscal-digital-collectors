variable "environment" {
  type        = string
  description = "Ambiente (prod, staging). Reservado para tags futuras."
  default     = "prod"
}

variable "aws_region" {
  type        = string
  description = "Regiao AWS — usada para policies que referenciam ARNs de log group."
  default     = "us-east-1"
}

variable "gazettes_table_arn" {
  type        = string
  description = "ARN da DynamoDB table fiscal-digital-gazettes-prod (gerenciada no monorepo)."
}

variable "gazettes_queue_arn" {
  type        = string
  description = "ARN da fila SQS fiscal-digital-gazettes-prod (gerenciada no monorepo)."
}

variable "gazettes_queue_url" {
  type        = string
  description = "URL da fila SQS gazettes — env var da Lambda."
}

variable "gazettes_cache_bucket_arn" {
  type        = string
  description = "ARN do bucket S3 fiscal-digital-gazettes-cache-prod (gerenciado no monorepo)."
  default     = "arn:aws:s3:::fiscal-digital-gazettes-cache-prod"
}

variable "kms_key_arn" {
  type        = string
  description = "ARN da chave KMS alias/fiscal-digital-kms-prod usada para encrypt das mensagens SQS."
}
