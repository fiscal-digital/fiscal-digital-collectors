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

variable "suppliers_table_arn" {
  type        = string
  description = "ARN da DynamoDB table fiscal-digital-suppliers-prod (gerenciada no monorepo)."
}

variable "alerts_table_arn" {
  type        = string
  description = "ARN da DynamoDB table fiscal-digital-alerts-prod (gerenciada no monorepo). Lida no modo backfill."
}

variable "cgu_secret_arn" {
  type        = string
  description = "ARN do Secret com a chave-api-dados do Portal da Transparencia. Pode ser vazio em ambientes sem CGU (degrade gracioso)."
  default     = ""
}

variable "kms_key_arn" {
  type        = string
  description = "ARN da chave KMS alias/fiscal-digital-kms-prod usada para encrypt do SQS e Secrets."
}
