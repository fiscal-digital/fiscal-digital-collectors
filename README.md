<!-- legal-verified: agency names (RFB, CGU) preserved from sources/cgu/README.md and the previous README of this repo (PR #1, merged in main) — not new legal claims. -->
<p align="center">
  <img src="https://raw.githubusercontent.com/fiscal-digital/fiscal-digital-web/main/brand/logo/symbol.svg" width="96" alt="Fiscal Digital" />
</p>

# Fiscal Digital — Collectors

**Adaptadores de coleta de fontes publicas brasileiras para o pipeline do Fiscal Digital.**

[fiscaldigital.org](https://fiscaldigital.org) · [@FiscalDigitalBR](https://x.com/FiscalDigitalBR)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Status: Bootstrap](https://img.shields.io/badge/Status-Bootstrap-blue.svg)]()
[![Brand: CC BY 4.0](https://img.shields.io/badge/Brand-CC%20BY%204.0-blue.svg)](https://github.com/fiscal-digital/fiscal-digital-web/tree/main/brand)

---

## 🇧🇷 Portugues

Este repo hospeda *adapters* que normalizam fontes publicas brasileiras para o
formato consumido pela engine de fiscalizacao
([`fiscal-digital`](https://github.com/fiscal-digital/fiscal-digital)).

### Status

**Bootstrap concluido** (PR 2/7 do conjunto MIT-02/EVO-002). Workspace TypeScript
configurado, gates de CI (lint, typecheck, test, terraform fmt/validate/tflint/checkov)
ativos. Nenhum collector implementado ainda neste repo — Querido Diario sera
migrado em PR 3, supplier-collector (RFB + CGU) nasce em PR 5.

Ate la, a implementacao em producao do collector Querido Diario continua em
[`fiscal-digital/packages/collector/`](https://github.com/fiscal-digital/fiscal-digital/tree/main/packages/collector)
(Lambda agendada via EventBridge, pipeline diario 07:00 UTC).

### Collectors planejados

| Path | Fonte | Status | Origem |
|---|---|---|---|
| `collectors/querido-diario/` | [Querido Diario](https://queridodiario.ok.org.br) (OKFN BR) | Migra no PR 3 | Hoje em `fiscal-digital/packages/collector/` |
| `collectors/supplier/` | RFB CNPJ + CGU CEIS/CNEP | Nasce no PR 5 | Skill `check_sanctions.ts` no engine + novo adapter RFB |

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

**Bootstrap complete** (PR 2/7 of the MIT-02/EVO-002 set). TypeScript workspace
configured, CI gates active (lint, typecheck, test, terraform fmt/validate/tflint/checkov).
No collector implemented in this repo yet — Querido Diario migrates in PR 3,
supplier-collector (RFB + CGU) is born in PR 5.

Until then, the production Querido Diario collector remains in
[`fiscal-digital/packages/collector/`](https://github.com/fiscal-digital/fiscal-digital/tree/main/packages/collector)
(EventBridge-scheduled Lambda, daily 07:00 UTC pipeline).

### Planned collectors

| Path | Source | Status |
|---|---|---|
| `collectors/querido-diario/` | Querido Diario (OKFN BR) | Migrates in PR 3 |
| `collectors/supplier/` | RFB CNPJ + CGU CEIS/CNEP | Born in PR 5 |

Per-source documentation (output contract, principles, next steps) lives in
[`sources/`](./sources/) — `collectors/` hosts the code, `sources/` hosts the
contract.

### Stack

TypeScript strict, AWS Lambda + EventBridge, DynamoDB cache, SQS rate limiting,
Terraform, Jest 30 + ts-jest, esbuild.

License: MIT.

---

*Sobre os ombros de [Serenata de Amor](https://serenata.ai) e [Querido Diario](https://queridodiario.ok.org.br) (OKFN Brasil).*
