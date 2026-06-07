# Terraform module — Collector Querido Diario
#
# Replica bit-perfect a configuracao do Lambda em prod hospedada hoje no
# monorepo `fiscal-digital` (terraform/modules/lambdas + iam + eventbridge +
# monitoring). O cutover α (PR 4 separado) usa `terraform import` para
# claim os recursos existentes neste state — por isso names, runtime,
# memory, timeout, env vars e schedule precisam casar exatamente com o
# que ja esta deployado.
#
# Bootstrap zip: placeholder vazio so para criar o resource Lambda no
# import. O CI deploy.yml empacota o bundle real apos `terraform apply`
# via `aws lambda update-function-code` (ver lifecycle.ignore_changes).

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

resource "aws_lambda_function" "collector" {
  function_name    = "fiscal-digital-collector-prod"
  role             = aws_iam_role.collector.arn
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = 300
  memory_size      = 512
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = merge(local.common_env, {
      GAZETTES_QUEUE_URL = var.gazettes_queue_url
    })
  }

  lifecycle {
    # CI deploy.yml roda `aws lambda update-function-code` apos apply.
    # Terraform nao gerencia o codigo — so a infra.
    ignore_changes = [filename, source_code_hash]
  }
}

# ─── CloudWatch log group — retencao 30 dias ────────────────────────────────
# 30 dias para RCA de incidentes detectados ate uma semana depois.
# Custo: ~$0.03/GB/mes — insignificante no volume atual.

resource "aws_cloudwatch_log_group" "collector" {
  name              = "/aws/lambda/fiscal-digital-collector-prod"
  retention_in_days = 30
}

# ─── EventBridge — schedule MON-FRI 07:00 UTC ───────────────────────────────
# 2026-05-11: retomada do schedule diario.
# 2026-06-07: alterado para MON-FRI apos auditoria de 14 dias (24/05 a 07/06)
# que confirmou ZERO ingest em sabados/domingos mesmo nas 5 cidades onde QD
# ainda indexa (Feira de Santana, Maceio, Niteroi, Serra, Sao Bernardo).
# Diarios oficiais brasileiros raramente publicam fim de semana. Economiza
# ~28% de invocacoes Lambda sem perda de cobertura.

resource "aws_cloudwatch_event_rule" "collector_daily" {
  name                = "fiscal-digital-daily-collector-prod"
  description         = "Aciona o collector segunda a sexta as 07:00 UTC (04:00 BRT)."
  schedule_expression = "cron(0 7 ? * MON-FRI *)"
}

resource "aws_cloudwatch_event_target" "collector" {
  rule = aws_cloudwatch_event_rule.collector_daily.name
  arn  = aws_lambda_function.collector.arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowEventBridgeInvokeCollector"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.collector.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.collector_daily.arn
}
