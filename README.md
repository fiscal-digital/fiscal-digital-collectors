<p align="center">
  <img src="https://raw.githubusercontent.com/fiscal-digital/fiscal-digital-web/main/brand/logo/symbol.svg" width="96" alt="Fiscal Digital" />
</p>

# Fiscal Digital — Collectors

**Adaptadores de coleta de fontes públicas brasileiras para o pipeline do Fiscal Digital.**

[fiscaldigital.org](https://fiscaldigital.org) · [@FiscalDigitalBR](https://x.com/FiscalDigitalBR)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Status: Produção parcial](https://img.shields.io/badge/Status-Produção%20parcial-yellow.svg)]()
[![Brand: CC BY 4.0](https://img.shields.io/badge/Brand-CC%20BY%204.0-blue.svg)](https://github.com/fiscal-digital/fiscal-digital-web/tree/main/brand)

---

## 🇧🇷 Português

Este repo contém *adapters* que normalizam fontes públicas brasileiras para o formato consumido pela engine de fiscalização ([`fiscal-digital`](https://github.com/fiscal-digital/fiscal-digital)).

### Fontes em escopo

| Fase | Fonte | Dados | Status |
|---|---|---|---|
| MVP | [Querido Diário](https://queridodiario.ok.org.br) (OKFN BR) | Diários oficiais municipais | ✅ |
| MVP | Receita Federal | CNPJ — situação, sócios, data abertura | 🚧 |
| MVP | CGU dados.gov.br | CEIS / CNEP (empresas suspensas e multadas) | 🚧 |
| Fase 2 | TSE | Doações de campanha | 🟡 planejado |
| Fase 2 | TCE-RS | Auditorias e irregularidades | 🟡 planejado |
| Fase 2 | Portal da Transparência Federal | Repasses federais ao município | 🟡 planejado |

### Stack

TypeScript strict · Node.js 24.x · AWS Lambda agendada via EventBridge · DynamoDB para cache idempotente · SQS rate limiting · Terraform.

### Status

✅ **Querido Diário em produção** desde 11 de maio de 2026. Pipeline diário ativo (cron 07:00 UTC = 04:00 BRT) coletando diários oficiais de 44 cidades indexadas. Cache de extração já populado em ~35.000 gazettes (chave EVO-001), reduzindo custo de reanálise futura para uma fração da primeira passada.

A implementação atual do collector Querido Diário vive em `fiscal-digital/packages/collector/` até estabilizar contrato de saída. Este repo passa a hospedar as próximas integrações (Receita Federal, CGU CEIS/CNEP, TSE) conforme cada uma amadurece.

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

### Status

✅ **Querido Diário in production** since May 11, 2026. Daily pipeline active (cron 07:00 UTC = 04:00 BRT) collecting official gazettes from 44 indexed cities. Extraction cache already populated for ~35,000 gazettes (key EVO-001), reducing future reanalysis cost to a fraction of the first pass.

The current Querido Diário collector lives in `fiscal-digital/packages/collector/` until its output contract stabilizes. This repo hosts the next integrations (Receita Federal, CGU CEIS/CNEP, TSE) as each one matures.

License: MIT.

---

*Sobre os ombros de [Serenata de Amor](https://serenata.ai) e [Querido Diário](https://queridodiario.ok.org.br) (OKFN Brasil).*
