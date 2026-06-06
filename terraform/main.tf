# Terraform — Collectors do Fiscal Digital
#
# Convencao:
# - Cada collector e um modulo em `modules/<collector-name>/`
# - State remoto: S3 backend (compartilhado com fiscal-digital monorepo
#   via key separada — ver TODO em terraform/backend.tf)
#
# Cutover α (executado pelo Diego apos PR 3 + PR 4 mergearem):
#   1. `terraform import` no state deste repo, claiming os recursos
#      hospedados hoje pelo state do monorepo
#   2. `terraform state rm` no state do monorepo
#   3. Apply aqui = no-op (recursos ja existem, atributos casam)
# A mesma Lambda ARN sobrevive — sem rebuild, sem downtime.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source = "hashicorp/aws"
      # 6.x necessario para runtime nodejs24.x (alinhado ao monorepo
      # fiscal-digital). Bootstrap deste repo pinava 5.x; promovido para
      # 6.x ao migrar o primeiro collector real (Querido Diario).
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "fiscal-digital"
      Repo      = "fiscal-digital-collectors"
      ManagedBy = "terraform"
      Env       = var.environment
    }
  }
}

# ─── Querido Diario collector ────────────────────────────────────────────────
# ARNs dependentes (DynamoDB gazettes, SQS gazettes, KMS) sao gerenciados
# pelo state do monorepo `fiscal-digital`. Hoje sao literais/data lookups;
# pos-cutover Diego pode migrar para `terraform_remote_state` se decidir
# expor outputs cross-state. Manter literais simplifica o import.

data "aws_caller_identity" "current" {}

locals {
  # ARNs construidos a partir do account_id da credencial do CI/CD — evita
  # hardcoding e mantem o repo OSS sem expor Account ID.
  gazettes_table_arn        = "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/fiscal-digital-gazettes-prod"
  gazettes_queue_arn        = "arn:aws:sqs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:fiscal-digital-gazettes-queue-prod"
  gazettes_queue_url        = "https://sqs.${var.aws_region}.amazonaws.com/${data.aws_caller_identity.current.account_id}/fiscal-digital-gazettes-queue-prod"
  gazettes_cache_bucket_arn = "arn:aws:s3:::fiscal-digital-gazettes-cache-prod"

  # Supplier collector (MIT-02 / EVO-002) — tabelas DDB gerenciadas pelo monorepo.
  suppliers_table_arn = "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/fiscal-digital-suppliers-prod"
  alerts_table_arn    = "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/fiscal-digital-alerts-prod"

  # KMS alias — resolvido via data source para evitar hardcoding do key UUID.
}

data "aws_kms_alias" "prod" {
  name = "alias/fiscal-digital-kms-prod"
}

module "querido_diario" {
  source                    = "./modules/querido-diario"
  environment               = var.environment
  aws_region                = var.aws_region
  gazettes_table_arn        = local.gazettes_table_arn
  gazettes_queue_arn        = local.gazettes_queue_arn
  gazettes_queue_url        = local.gazettes_queue_url
  gazettes_cache_bucket_arn = local.gazettes_cache_bucket_arn
  kms_key_arn               = data.aws_kms_alias.prod.target_key_arn
}

# ─── Supplier collector ─────────────────────────────────────────────────────
# MIT-02 / EVO-002 — Lambda novo (nasce neste repo, sem cutover do monorepo).
# Tabelas DDB sao gerenciadas pelo monorepo; aqui so consumimos via ARN.
# CGU secret ARN: resolvido via data source (evita expor ARN/hash em vars e
# garante que prod.tfvars nao precise ser atualizado manualmente).

# CGU Portal da Transparencia secret — criado fora do terraform (rotacao manual,
# fora do blast radius do CI). Lookup por nome evita expor o ARN/hash em vars.
data "aws_secretsmanager_secret" "cgu" {
  name = "fiscaldigital-cgu-prod"
}

module "supplier" {
  source              = "./modules/supplier"
  environment         = var.environment
  aws_region          = var.aws_region
  suppliers_table_arn = local.suppliers_table_arn
  alerts_table_arn    = local.alerts_table_arn
  cgu_secret_arn      = data.aws_secretsmanager_secret.cgu.arn
  kms_key_arn         = data.aws_kms_alias.prod.target_key_arn
}
