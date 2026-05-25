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
