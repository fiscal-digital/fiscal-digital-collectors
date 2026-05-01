<p align="center">
  <img src="https://raw.githubusercontent.com/fiscal-digital/fiscal-digital-web/main/brand/logo/symbol.svg" width="96" alt="Fiscal Digital" />
</p>

# Fiscal Digital — Collectors

**Adaptadores de coleta de fontes públicas brasileiras para o pipeline do Fiscal Digital.**

[fiscaldigital.org](https://fiscaldigital.org) · [@FiscalDigitalBR](https://x.com/FiscalDigitalBR)

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

🚧 **Em desenvolvimento.** Primeira fonte (Querido Diário) já roda dentro do repo `fiscal-digital`. Este repo passa a hospedar as integrações conforme amadurecem e ganham contratos estáveis.

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

Status: under development.

License: MIT.

---

*Sobre os ombros de [Serenata de Amor](https://serenata.ai) e [Querido Diário](https://queridodiario.ok.org.br) (OKFN Brasil).*
