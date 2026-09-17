<!-- legal-verified: agency names (RFB, CGU) preserved from sources/cgu/README.md and the previous README of this repo (PR #1, merged in main) — not new legal claims. -->
<p align="center">
  <img src="https://raw.githubusercontent.com/fiscal-digital/fiscal-digital-web/main/brand/logo/symbol.svg" width="96" alt="Fiscal Digital" />
</p>

# Fiscal Digital — Collectors

**Adaptadores de coleta de fontes publicas brasileiras para o pipeline do Fiscal Digital.**

[fiscaldigital.org](https://fiscaldigital.org) · [@FiscalDigitalBR](https://x.com/FiscalDigitalBR)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Status: Producao](https://img.shields.io/badge/Status-Produ%C3%A7%C3%A3o-green.svg)]()
[![Brand: CC BY 4.0](https://img.shields.io/badge/Brand-CC%20BY%204.0-blue.svg)](https://github.com/fiscal-digital/fiscal-digital-web/tree/main/brand)

---

## 🇧🇷 Portugues

Este repo hospeda *adapters* que normalizam fontes publicas brasileiras para o
formato consumido pela engine de fiscalizacao
([`fiscal-digital`](https://github.com/fiscal-digital/fiscal-digital)).

### Status

**Em producao.** Os dois collectors rodam como Lambdas agendadas por EventBridge
e sao deployados por este repo. A migracao a partir de
`fiscal-digital/packages/collector/` esta concluida — aquele diretorio nao
existe mais no monorepo.

### Collectors

| Path | Fonte | Lambda em prod | Agendamento |
|---|---|---|---|
| `collectors/querido-diario/` | [Querido Diario](https://queridodiario.ok.org.br) (OKFN BR) | `fiscal-digital-collector-prod` | 07:07 UTC, seg-sex |
| `collectors/supplier/` | RFB CNPJ + CGU CEIS/CNEP | `fiscal-digital-supplier-collector-prod` | 08:00 UTC, diario |

Cobertura atual: 50 cidades. A sentinela de frescor (`sentinel-freshness.yml`)
roda 09:30 UTC de seg a sex e abre issue por cidade que parar de render diario;
`scripts/diagnose-collection.mjs` classifica a causa raiz de cada parada entre
atraso nosso, fonte que parou de publicar e cidade que a fonte nao indexa.

A documentacao funcional de cada fonte (contrato de saida, principios, proximos
passos) continua em [`sources/`](./sources/) — `collectors/` hospeda o codigo,
`sources/` hospeda o contrato.

### Stack

TypeScript strict · Node.js 24.x · AWS Lambda agendada via EventBridge ·
DynamoDB cache idempotente · SQS rate limiting · Terraform · Jest 30 + ts-jest ·
esbuild bundle.

### Como rodar localmente

```bash
# Setup unico do token GitHub Packages (para baixar @fiscal-digital/engine)
gh auth setup-git

# Bootstrap
npm ci

# Gates do PR
npm run lint
npm run typecheck
npm test
npm run build
```

### Como contribuir

Antes de qualquer mudanca, ler o
[`CLAUDE.md`](./CLAUDE.md) deste repo e o
[`CLAUDE.md` mestre](https://github.com/fiscal-digital/fiscal-digital/blob/main/CLAUDE.md).
Principios inegociaveis (sempre citar a fonte, nao acusar, transparencia do
algoritmo, verificabilidade publica) vivem la.

### Principios

- **Idempotencia:** todo collector e seguro para re-execucao
- **Rate limit obrigatorio:** respeitar limites das APIs externas (60 req/min Querido Diario, etc.)
- **Cache antes de chamada:** consultar DynamoDB antes de bater na fonte
- **Logs estruturados:** JSON com ID de execucao obrigatorio
- **Sempre citar a fonte:** todo dado normalizado preserva URL canonica da fonte original

### Manutencao

#### Regenerar `package-lock.json`

O workflow `regenerate-lock.yml` regenera o lock do zero dentro do CI
(sem depender de token local do Diego) e abre um PR para revisao humana.

**Quando usar:** apos publicar nova versao do `@fiscal-digital/engine` no
GitHub Packages, especialmente quando a versao anterior estava restrita e
a nova foi publicada como `public` — o lock pode referenciar resolucao
incompativel com `npm ci`.

```bash
# Disparar manualmente
gh workflow run regenerate-lock.yml \
  --repo fiscal-digital/fiscal-digital-collectors

# Acompanhar execucao
gh run list --repo fiscal-digital/fiscal-digital-collectors \
  --workflow=regenerate-lock.yml --limit 5
```

Apos o workflow abrir o PR de lock, revisar + mergear normalmente.
O gate `plan.yml` valida que `npm ci` passa com o novo lock antes do merge.

### Licenca

MIT — ver [LICENSE](LICENSE).

---

## 🇺🇸 English

Public data source adapters for the Fiscal Digital pipeline. Normalizes Brazilian
public registries (gazettes, company tax IDs, federal sanctions) for consumption
by the fiscal engine
([`fiscal-digital`](https://github.com/fiscal-digital/fiscal-digital)).

### Status

**In production.** Both collectors run as EventBridge-scheduled Lambdas and are
deployed from this repo. The migration out of
`fiscal-digital/packages/collector/` is complete — that directory no longer
exists in the monorepo.

### Collectors

| Path | Source | Lambda in prod | Schedule |
|---|---|---|---|
| `collectors/querido-diario/` | Querido Diario (OKFN BR) | `fiscal-digital-collector-prod` | 07:07 UTC, Mon-Fri |
| `collectors/supplier/` | RFB CNPJ + CGU CEIS/CNEP | `fiscal-digital-supplier-collector-prod` | 08:00 UTC, daily |

Current coverage: 50 cities. The freshness sentinel (`sentinel-freshness.yml`)
runs at 09:30 UTC Mon-Fri and opens one issue per city that stops publishing;
`scripts/diagnose-collection.mjs` classifies each stall by root cause — our own
lag, a source that stopped publishing, or a city the source never indexed.

Per-source documentation (output contract, principles, next steps) lives in
[`sources/`](./sources/) — `collectors/` hosts the code, `sources/` hosts the
contract.

### Stack

TypeScript strict, AWS Lambda + EventBridge, DynamoDB cache, SQS rate limiting,
Terraform, Jest 30 + ts-jest, esbuild.

License: MIT.

---

*Sobre os ombros de [Serenata de Amor](https://serenata.ai) e [Querido Diario](https://queridodiario.ok.org.br) (OKFN Brasil).*
