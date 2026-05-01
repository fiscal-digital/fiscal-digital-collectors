# Fiscal Digital — Collectors

## Hierarquia de contexto (lê PRIMEIRO)

Antes de qualquer trabalho aqui, **abrir e ler [`../fiscal-digital/CLAUDE.md`](../fiscal-digital/CLAUDE.md)**.

Esse é o documento mestre do projeto. Princípios inegociáveis, regras de
ouro (TypeScript strict, Node 24, OIDC, kebab-case AWS), governança open
source, contrato de brand pack — tudo lá. **Não duplicar conteúdo aqui.**

---

## Escopo local

Este repo contém **adapters** que coletam dados de fontes públicas brasileiras
e normalizam para o formato consumido pela engine.

### Fontes em escopo (Fase 1 MVP)

- **Querido Diário API** (OKFN Brasil) — diários oficiais municipais
- **Receita Federal** — CNPJ (situação, sócios, data abertura)
- **CGU dados.gov.br** — CEIS / CNEP (empresas suspensas e multadas)

### Stack

- TypeScript strict, Node.js 24.x
- AWS Lambda agendada via EventBridge
- DynamoDB para cache de respostas idempotentes
- SQS para rate limiting (60 req/min Querido Diário)
- Terraform com estado remoto

### Convenções específicas

- **Naming AWS:** `fiscal-digital-collector-<source>-prod` (kebab-case)
- **Idempotência obrigatória:** todo collector é seguro para re-execução
- **Cache antes de fetch:** consultar DynamoDB primeiro, bater na fonte só se cache miss
- **Rate limits:** respeitar limites das APIs externas
- **Logs estruturados JSON** com ID de execução

### Brand pack

Não usado neste repo (sem UI). Brand pack mestre vive em
`fiscal-digital-web/brand/`. Se precisar de tokens (improvável), seguir
o padrão de consumo definido no CLAUDE.md mestre.
