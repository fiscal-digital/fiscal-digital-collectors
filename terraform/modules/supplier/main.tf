# Terraform module — Collector Supplier (RFB BrasilAPI + CGU CEIS/CNEP)
#
# Lambda novo do MIT-02 / EVO-002. Enriquece profile cadastral de fornecedores
# e persiste em fiscal-digital-suppliers-prod (sk = PROFILE).
#
# 3 modos de invocacao (handler decide via shape do event):
#   1. backfill        — manual (aws lambda invoke), 1 cidade por vez
#   2. scheduled       — EventBridge cron diario 08:00 UTC (05:00 BRT off-peak)
#   3. enrich-on-demand — SQS-triggered (CNPJ literal no MessageBody)
#
# Bootstrap zip: placeholder vazio so para criar o recurso. Deploy.yml
# empacota o bundle real e roda `aws lambda update-function-code`.

data "archive_file" "placeholder" {
  type        = "zip"
  output_path = "${path.module}/placeholder.zip"
  source {
    content  = "exports.handler = async () => ({ statusCode: 200, body: 'placeholder' })"
    filename = "index.js"
  }
}

locals {
  common_env = {
    AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
    NODE_OPTIONS                        = "--enable-source-maps"
  }
}

# ─── Lambda ──────────────────────────────────────────────────────────────────

resource "aws_lambda_function" "supplier_collector" {
  function_name    = "fiscal-digital-supplier-collector-prod"
  role             = aws_iam_role.supplier.arn
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = 300
  memory_size      = 512
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = merge(local.common_env, {
      SUPPLIERS_TABLE = "fiscal-digital-suppliers-prod"
      ALERTS_TABLE    = "fiscal-digital-alerts-prod"
      CGU_SECRET_ARN  = var.cgu_secret_arn
      LOG_LEVEL       = "INFO"
    })
  }

  lifecycle {
    # CI deploy.yml roda `aws lambda update-function-code` apos apply.
    ignore_changes = [filename, source_code_hash]
  }
}

# ─── CloudWatch log group — retencao 30 dias ────────────────────────────────

resource "aws_cloudwatch_log_group" "supplier_collector" {
  name              = "/aws/lambda/fiscal-digital-supplier-collector-prod"
  retention_in_days = 30
}

# ─── EventBridge — schedule diario 08:00 UTC (refresh PROFILEs > 30 dias) ───
# 08:00 UTC = 05:00 BRT — off-peak para nao competir com o collector-prod
# (07:00 UTC) nem com cargas matinais das APIs externas (BrasilAPI/CGU).

resource "aws_cloudwatch_event_rule" "supplier_refresh_daily" {
  name                = "fiscal-digital-supplier-refresh-prod"
  description         = "Refresh diario do supplier collector (re-enriquece PROFILEs > 30 dias)."
  schedule_expression = "cron(0 8 * * ? *)"
}

resource "aws_cloudwatch_event_target" "supplier_refresh" {
  rule = aws_cloudwatch_event_rule.supplier_refresh_daily.name
  arn  = aws_lambda_function.supplier_collector.arn
}

resource "aws_lambda_permission" "allow_eventbridge_supplier" {
  statement_id  = "AllowEventBridgeInvokeSupplierCollector"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.supplier_collector.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.supplier_refresh_daily.arn
}

# ─── SQS — fila enrich-on-demand + DLQ ──────────────────────────────────────
# Visibility timeout = lambda timeout (300s) — evita reentrega prematura
# enquanto o handler ainda processa o batch.
# Retention 14d — janela suficiente para RCA e replay manual.

resource "aws_sqs_queue" "supplier_enrich_dlq" {
  name                       = "fiscal-digital-supplier-enrich-dlq-prod"
  message_retention_seconds  = 1209600 # 14 dias
  visibility_timeout_seconds = 300
  kms_master_key_id          = var.kms_key_arn
}

resource "aws_sqs_queue" "supplier_enrich" {
  name                       = "fiscal-digital-supplier-enrich-prod"
  message_retention_seconds  = 1209600 # 14 dias
  visibility_timeout_seconds = 300
  kms_master_key_id          = var.kms_key_arn

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.supplier_enrich_dlq.arn
    maxReceiveCount     = 5
  })
}

# Event source mapping SQS → Lambda. batch_size=5 mantem latencia baixa por
# CNPJ (rate-limited internamente no adapter ~350ms BrasilAPI + ~150ms CGU).
resource "aws_lambda_event_source_mapping" "supplier_enrich_sqs" {
  event_source_arn = aws_sqs_queue.supplier_enrich.arn
  function_name    = aws_lambda_function.supplier_collector.arn
  batch_size       = 5
  enabled          = true
}
