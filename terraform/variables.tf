variable "aws_region" {
  type        = string
  description = "Regiao AWS onde os recursos sao criados."
  default     = "us-east-1"
}

variable "environment" {
  type        = string
  description = "Ambiente (prod, staging). Usado em tags e nomes de recurso."
  default     = "prod"
}

variable "cgu_secret_arn" {
  type        = string
  description = "ARN do Secret com a chave-api-dados do Portal da Transparencia (CGU). Pode ser vazio em ambientes sem CGU."
  default     = ""
}
