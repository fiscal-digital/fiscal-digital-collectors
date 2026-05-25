# State remoto S3 — DEFINIR no PR 3 quando o primeiro collector for migrado.
#
# Sugestao: bucket compartilhado com fiscal-digital monorepo, key
# `fiscal-digital-collectors/terraform.tfstate`. Lock table separada:
# `fiscal-digital-collectors-terraform-state`.
#
# terraform {
#   backend "s3" {
#     bucket         = "fiscal-digital-terraform-state-prod"
#     key            = "fiscal-digital-collectors/terraform.tfstate"
#     region         = "us-east-1"
#     dynamodb_table = "fiscal-digital-collectors-terraform-state"
#     encrypt        = true
#   }
# }
