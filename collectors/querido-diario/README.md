<!-- legal-verified -->
# Collector — Querido Diario

Lambda agendada que coleta diarios oficiais municipais via API do
[Querido Diario](https://queridodiario.ok.org.br) (OKFN Brasil), filtra por
palavras-chave fiscais e despacha mensagens para a fila SQS `gazettes-prod`
consumida pelo analyzer no monorepo `fiscal-digital`.

## Schedule

- **EventBridge cron:** `cron(0 7 * * ? *)` UTC (07:00 UTC = 04:00 BRT)
- **Source canonica:** https://queridodiario.ok.org.br
- **Rate limit:** 60 req/min (enforced via SQS)

## Cidades cobertas

Lista canonica vem de `@fiscal-digital/engine` (`cities/index.ts`,
funcao `activeCities()`). Cobertura efetiva depende do Querido Diario ter
o municipio indexado — se o QD nao cobre, o collector pula sem erro.

## Manual backfill

Override do `since` para reprocessar janela historica de uma cidade:

```bash
aws lambda invoke \
  --function-name fiscal-digital-collector-prod \
  --payload '{"backfill":true,"territory_id":"4305108","since":"2024-01-01"}' \
  --cli-binary-format raw-in-base64-out \
  /dev/null
```

`territory_id` e o codigo IBGE de 7 digitos. Caxias do Sul (origem do MVP)
e `4305108`.

## Idempotencia

`pk` em DynamoDB derivado de `gazetteKey(url)` (URL canonica), nao de
`gazette.id` do QD — o id muda entre queries, a URL nao. `PutCommand` com
`ConditionExpression: attribute_not_exists(pk)` evita race entre invocacoes
concorrentes. Detalhe em LRN-20260503-022 no monorepo `fiscal-digital`.

## Archive S3 em 3 camadas

Cada gazette gera 3 objetos em `s3://fiscal-digital-gazettes-cache-prod`:

- **L1 (PDF):** `<pdf-key>.pdf` — fonte original
- **L2 (texto):** `txt/<pdf-key>.txt` — excerpts concatenados (treino futuro)
- **L3' (excerpts JSON):** `excerpts/<pdf-key>.json` — backup imutavel
  do que entrou em DDB

Lifecycle: Glacier apos 181d (~R$ 4/mes para 80 GB cold).

## Dependencias

- `@fiscal-digital/engine` — Skills (`queryDiario`, `extractAll`,
  `lookupMemory`, `saveMemory`), helpers (`gazetteKey`, `pdfCacheS3Key`,
  `pdfCacheUrl`, `requireEnv`, `createLogger`), cities (`activeCities`),
  tipos (`CollectorMessage`)
- `@aws-sdk/client-sqs` — fila gazettes
- `@aws-sdk/client-s3` — archive 3 camadas
- `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` — pk idempotente +
  counter agregado para `/stats`
- `@aws-lambda-powertools/logger` — logs JSON estruturados

## Bundle Lambda

```bash
npm run bundle -w collectors/querido-diario
# gera dist/index.js (esbuild, target node24, externals @aws-sdk/*)
zip -j collectors/querido-diario/dist/function.zip \
  collectors/querido-diario/dist/index.js
```

`@aws-sdk/*` ficam external porque o runtime `nodejs24.x` ja inclui v3
no Lambda runtime.

## Variaveis de ambiente

| Nome | Obrigatorio | Descricao |
|---|---|---|
| `GAZETTES_QUEUE_URL` | sim | URL da fila SQS gazettes-prod |
| `AWS_REGION` | nao (default us-east-1) | regiao AWS |

Leitura via `requireEnv()` do engine (LRN TEC-ENG-001 — nao usar
`process.env.X!`).

## Historico

- 2026-05-24: migrado de `fiscal-digital/packages/collector/` para este
  repo no PR 3 do bootstrap de `fiscal-digital-collectors`. Cutover de prod
  (PR 4, separado) usa estrategia α: `terraform import` no state desse repo
  + `terraform state rm` no state do monorepo, mantendo a mesma Lambda ARN.
- 2026-05-11: schedule diario retomado (cron 07:00 UTC) priorizando arquivo
  completo. Decisao registrada em
  `fiscal-digital/docs/operations/reprocessing-archive-strategy.md`.
