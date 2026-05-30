<!-- legal-verified -->
# @fiscal-digital/collector-supplier

Collector de fornecedores. Lambda que enriquece o profile cadastral de um CNPJ
combinando dados da Receita Federal (via BrasilAPI) e CGU CEIS/CNEP (via Portal
da Transparência), e persiste em `fiscal-digital-suppliers-prod`.

Parte do MIT-02 / EVO-002 do roadmap do Fiscal Digital.

## Modos de operação

O handler aceita três tipos de evento:

### 1. `backfill` (manual, one-shot por cidade)

```bash
aws lambda invoke \
  --function-name fiscal-digital-supplier-collector-prod \
  --payload '{"mode":"backfill","cityId":"4305108","limit":500}' \
  --cli-binary-format raw-in-base64-out \
  out.json
```

Faz `Scan` em `fiscal-digital-alerts-prod` filtrando por `cityId`, deduplica
CNPJs presentes em findings, e enriquece cada um sequencialmente. `limit`
limita o número de CNPJs únicos processados (default 500).

Custo aproximado por execução (1 cidade média ~100 CNPJs): ~30 segundos,
1 Scan + 100 lookups BrasilAPI + 100 pares CEIS/CNEP CGU.

### 2. `scheduled` (EventBridge cron diário 08:00 UTC = 05:00 BRT)

Disparado automaticamente pelo `aws_cloudwatch_event_rule.supplier_refresh_daily`.
Faz `Scan` em `fiscal-digital-suppliers-prod` por `sk = PROFILE` com
`lastLookupAt < (now - 30 dias)` e re-enriquece os stale.

Frequência configurável via `cron(0 8 * * ? *)` no módulo Terraform.

### 3. `enrich-on-demand` (SQS-triggered ou manual)

Fila: `fiscal-digital-supplier-enrich-prod` (DLQ:
`fiscal-digital-supplier-enrich-dlq-prod` após 5 tentativas).

Cada mensagem na fila tem o CNPJ literal no `MessageBody`:

```bash
aws sqs send-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/{ACCOUNT}/fiscal-digital-supplier-enrich-prod \
  --message-body "12345678000190"
```

Lambda recebe via event source mapping com `batch_size=5`. Visibility timeout
300s (= timeout do Lambda).

Manual:

```bash
aws lambda invoke \
  --function-name fiscal-digital-supplier-collector-prod \
  --payload '{"mode":"enrich-on-demand","cnpj":"12345678000190"}' \
  --cli-binary-format raw-in-base64-out \
  out.json
```

## Schema persistido (PROFILE)

```
pk = SUPPLIER#{cnpj14}
sk = PROFILE
```

Coexiste na mesma tabela com os items CONTRACT (`sk = {contractedAt}#{contractId}`)
escritos pelo analyzer.

Atributos opcionais (UpdateCommand SET — não sobrescreve com undefined):

| Campo | Tipo | Origem |
|---|---|---|
| `razaoSocial` | S | BrasilAPI |
| `situacaoCadastral` | S | BrasilAPI (`ativa`/`suspensa`/`inapta`/`baixada`/`nula`) |
| `dataAbertura` | S | BrasilAPI (`data_inicio_atividade`) |
| `socios` | SS | BrasilAPI (`qsa[].nome_socio`) |
| `sancoes` | L | CGU CEIS + CNEP |
| `rfbStatus` | S | `ok` / `nao_encontrado` / `erro` |
| `rfbSourceUrl` | S | URL canônica consultada |
| `rfbCapturedAt` | S | ISO8601 do último lookup RFB com sucesso |
| `cguEnabled` | B | false se CGU_SECRET_ARN ausente/inválido |
| `cguCapturedAt` | S | ISO8601 do último lookup CGU |
| `cguSourceUrl` | S | URLs CEIS + CNEP |
| `lastLookupAt` | S | ISO8601 — sempre setado, sinaliza refresh |
| `lastError` | S | mensagem do último erro (opcional) |

## Variáveis de ambiente

| Var | Default | Descrição |
|---|---|---|
| `SUPPLIERS_TABLE` | `fiscal-digital-suppliers-prod` | Tabela DDB |
| `ALERTS_TABLE` | `fiscal-digital-alerts-prod` | Tabela DDB lida no backfill |
| `CGU_SECRET_ARN` | (vazio) | ARN do secret com a `chave-api-dados` da CGU |
| `LOG_LEVEL` | `INFO` | Powertools logger |

`CGU_SECRET_ARN` é opcional. Quando ausente ou indisponível, profile fica
marcado com `cguEnabled = false` e segue sem sancoes — degrade gracioso.

## Rate limits

- BrasilAPI: ~3 req/s (free tier) → 350ms entre calls (interno ao adapter)
- CGU Portal da Transparência: ~400 req/min → 150ms entre pares (interno)

`NODE_ENV=test` desliga o throttle (testes não esperam).

## Limites de escopo

- NÃO lê do engine `validate_cnpj.ts` / `check_sanctions.ts` — usa cópias
  adaptadas em `src/adapters/`. Remover do engine fica pra PR pós Ciclo 4.
- NÃO depende de feature flag SSM (diferente do antigo
  `enable-supplier-write` no analyzer). Lambda nasce ativo.
