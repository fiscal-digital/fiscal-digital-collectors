# IAM role + policies — Lambda supplier-collector
#
# Least-privilege:
#   - DDB: write em suppliers-prod (+ GSI), read em alerts-prod (backfill SCAN)
#   - Secrets: GetSecretValue em fiscaldigital-cgu-prod-*
#   - SQS: ReceiveMessage/DeleteMessage na fila supplier_enrich (+ DLQ)
#   - KMS: Decrypt na chave fiscal-digital-kms-prod (SQS + Secret SSE)

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "supplier_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "supplier" {
  name               = "fiscal-digital-supplier-collector-prod"
  assume_role_policy = data.aws_iam_policy_document.supplier_trust.json
}

# ─── CloudWatch Logs ────────────────────────────────────────────────────────

resource "aws_iam_policy" "supplier_logs" {
  name = "fiscal-digital-supplier-collector-logs-prod"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/fiscal-digital-*:*"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "supplier_logs" {
  role       = aws_iam_role.supplier.name
  policy_arn = aws_iam_policy.supplier_logs.arn
}

# ─── DDB + Secrets + SQS + KMS ─────────────────────────────────────────────

resource "aws_iam_role_policy" "supplier" {
  role = aws_iam_role.supplier.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SuppliersTableWrite"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:Scan",
        ]
        Resource = [
          var.suppliers_table_arn,
          "${var.suppliers_table_arn}/index/*",
        ]
      },
      {
        Sid    = "AlertsTableRead"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:Scan",
        ]
        Resource = [
          var.alerts_table_arn,
          "${var.alerts_table_arn}/index/*",
        ]
      },
      {
        Sid      = "CguSecretRead"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = ["arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:fiscaldigital-cgu-prod-*"]
      },
      {
        Sid    = "EnrichQueueConsume"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility",
        ]
        Resource = [
          aws_sqs_queue.supplier_enrich.arn,
          aws_sqs_queue.supplier_enrich_dlq.arn,
        ]
      },
      {
        Sid      = "KmsDecrypt"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = var.kms_key_arn
      },
    ]
  })
}
