# State remoto S3 — compartilha bucket + lock table com o monorepo
# fiscal-digital, mas com key dedicada para isolar o state deste repo.
#
# Decisao: reusar `fiscal-digital-terraform-state` + `fiscal-digital-terraform-lock`
# (mesmos do monorepo) economiza setup de bucket/table adicionais e mantem
# governanca centralizada. O isolamento de state e garantido pela key
# dedicada `fiscal-digital-collectors/terraform.tfstate`.
terraform {
  backend "s3" {
    bucket         = "fiscal-digital-terraform-state"
    key            = "fiscal-digital-collectors/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "fiscal-digital-terraform-lock"
    encrypt        = true
  }
}
