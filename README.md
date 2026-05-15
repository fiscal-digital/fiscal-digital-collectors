<p align="center">
  <img src="https://raw.githubusercontent.com/fiscal-digital/fiscal-digital-web/main/brand/logo/symbol.svg" width="96" alt="Fiscal Digital" />
</p>

# Fiscal Digital — Collectors

**Adaptadores de coleta de fontes públicas brasileiras para o pipeline do Fiscal Digital.**

[fiscaldigital.org](https://fiscaldigital.org) · [@FiscalDigitalBR](https://x.com/FiscalDigitalBR)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status: dev](https://img.shields.io/badge/status-em%20desenvolvimento-yellow.svg)]()

---

## 🇧🇷 Português

Este repo contém *adapters* que normalizam fontes públicas brasileiras para o formato consumido pela engine de fiscalização ([`fiscal-digital`](https://github.com/fiscal-digital/fiscal-digital)).

### Fontes em escopo

| Fase | Fonte | Dados | Status |
|---|---|---|---|
| MVP | [Querido Diário](https://queridodiario.ok.org.br) (OKFN BR) | Diários oficiais municipais | 🚧 |
| MVP | Receita Federal | CNPJ — situação, sócios, data abertura | 🚧 |
| MVP | CGU dados.gov.br | CEIS / CNEP (empresas suspensas e multadas) | 🚧 |
| Fase 2 | TSE | Doações de campanha | 🟡 planejado |
| Fase 2 | TCE-RS | Auditorias e irregularidades | 🟡 planejado |
| Fase 2 | Portal da Transparência Federal | Repasses federais ao município | 🟡 planejado |

### Stack

TypeScript strict · Node.js 24.x · AWS Lambda agendada via EventBridge · DynamoDB para cache idempotente · SQS rate limiting · Terraform.

### Status

✅ **Em produção.** Collector do Querido Diário roda diariamente desde 2026-05-11 dentro do repo [`fiscal-digital`](https://github.com/fiscal-digital/fiscal-digital), via Lambda agendada por EventBridge. Arquiva PDFs em S3 com cache de extração (texto + excerpts) para reprocessamento futuro sem custo. Cobertura atual: 50 cidades ativas + 2 planejadas. Este repo (`fiscal-digital-collectors`) hospeda os próximos adaptadores conforme amadurecem (Fase 2: RFB, CGU CEIS/CNEP, TSE).

### Princípios

- **Idempotência:** todo collector é seguro para re-execução
- **Rate limit obrigatório:** respeitar limites das APIs externas (60 req/min Querido Diário, etc.)
- **Cache antes de chamada:** consultar DynamoDB antes de bater na fonte
- **Logs estruturados:** JSON com ID de execução obrigatório

### Licença

MIT — ver [LICENSE](LICENSE).

---

## 🇺🇸 English

Public data source adapters for the Fiscal Digital pipeline. Normalizes Brazilian public registries (gazettes, company tax IDs, federal sanctions) for consumption by the fiscal engine ([`fiscal-digital`](https://github.com/fiscal-digital/fiscal-digital)).

Stack: TypeScript strict, AWS Lambda + EventBridge, DynamoDB cache, SQS rate limiting, Terraform.

Status: in production. The Querido Diário collector runs daily since 2026-05-11 inside the [`fiscal-digital`](https://github.com/fiscal-digital/fiscal-digital) repo, archiving PDFs to S3 with an extraction cache (text + excerpts) so reprocessing is free. Current coverage: 50 active cities plus 2 planned. This repo (`fiscal-digital-collectors`) will host the next adapters as they mature (Phase 2: RFB, CGU CEIS/CNEP, TSE).

License: MIT.

---

*Sobre os ombros de [Serenata de Amor](https://serenata.ai) e [Querido Diário](https://queridodiario.ok.org.br) (OKFN Brasil).*
