# IAM role + policies — Lambda collector Querido Diario
#
# Espelha terraform/modules/iam/main.tf (resource "aws_iam_role" "collector")
# do monorepo fiscal-digital. Cutover α importa este role pelo mesmo nome
# (`fiscal-digital-collector-prod`) e remove do state do monorepo.

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "collector" {
  name               = "fiscal-digital-collector-prod"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

# ─── Logs basicos ───────────────────────────────────────────────────────────
# CloudWatch Logs nao usa policy condicional — escopa por log group prefix
# fiscal-digital-* (mantem mesma forma do monorepo).

resource "aws_iam_policy" "collector_logs" {
  name = "fiscal-digital-collector-logs-prod"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/fiscal-digital-*:*"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "collector_logs" {
  role       = aws_iam_role.collector.name
  policy_arn = aws_iam_policy.collector_logs.arn
}

# ─── DynamoDB + SQS + KMS + S3 (PDF cache) ──────────────────────────────────
# Replica bit-perfect a policy aws_iam_role_policy.collector do monorepo.

resource "aws_iam_role_policy" "collector" {
  role = aws_iam_role.collector.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
        Resource = var.gazettes_table_arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = var.gazettes_queue_arn
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = var.kms_key_arn
      },
      {
        # Cache de PDFs do Querido Diario — PutObject + HeadObject para
        # idempotencia + GetObject usado em smoke tests do cache.
        Sid    = "GazettesPdfCache"
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:HeadObject", "s3:GetObject"]
        Resource = [
          var.gazettes_cache_bucket_arn,
          "${var.gazettes_cache_bucket_arn}/*",
        ]
      },
    ]
  })
}
