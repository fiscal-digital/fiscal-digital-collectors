# Terraform skeleton — modulos concretos virao nos PRs 3 e 5.
#
# Convencao:
# - Cada collector e um modulo em `modules/<collector-name>/`
# - State remoto: S3 backend (compartilhado com fiscal-digital monorepo
#   via key separada — ver TODO em terraform/backend.tf)

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
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
