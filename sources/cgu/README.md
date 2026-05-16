# Fiscal Digital — Collector / CGU

---

## 🇧🇷 Português

**Fonte oficial:** CGU (Controladoria-Geral da Uniao). Cadastros de empresas sancionadas: CEIS (Cadastro de Empresas Inidôneas e Suspensas) e CNEP (Cadastro Nacional de Empresas Punidas). Distribuicao via [Portal da Transparencia](https://portaldatransparencia.gov.br) e dados.gov.br.

**Status:** 🟡 Planejado. A skill `check_sanctions.ts` existe no engine e já é chamada pelos Fiscais, mas o adapter de ingestao dos dumps CSV ainda nao foi extraído para este repo.

**Implementação canônica:** [`fiscal-digital/packages/engine/src/skills/check_sanctions.ts`](../../../fiscal-digital/packages/engine/src/skills/check_sanctions.ts).

**Contrato de saída esperado:**

- `cnpj`: 14 dígitos sem formatação
- `razaoSocial`: string
- `cadastro`: `CEIS` | `CNEP`
- `tipoSancao`: string normalizado conforme categorias CGU
- `dataInicio`: ISO8601
- `dataFim`: ISO8601 ou null (sanção vigente sem prazo)
- `orgaoAplicador`: string
- `fonteUrl`: URL do registro oficial no Portal da Transparencia

**Princípios herdados:** idempotência, rate limit, cache antes de chamada e logs estruturados JSON definidos em [../../README.md#princípios](../../README.md#princípios).

**Próximos passos:**

1. Implementar ingestao dos dumps CSV CEIS e CNEP em DynamoDB com refresh mensal (fonte: dados.gov.br)
2. Definir estrategia de delta: full reload vs diff incremental por data de atualizacao
3. Integrar lookup com cache em `check_sanctions.ts`, substituindo eventual consulta ad hoc

---

## 🇺🇸 English

**Official source:** CGU (Brazilian Federal Comptroller General). Sanctioned companies registries (CEIS and CNEP). Distribution via [Portal da Transparencia](https://portaldatransparencia.gov.br) and dados.gov.br.

**Status:** 🟡 Planned. Skill `check_sanctions.ts` exists in the engine. A CSV ingestion adapter has not yet been extracted to this repo.

**Canonical implementation:** [`fiscal-digital/packages/engine/src/skills/check_sanctions.ts`](../../../fiscal-digital/packages/engine/src/skills/check_sanctions.ts).

**Output contract fields:** `cnpj`, `razaoSocial`, `cadastro`, `tipoSancao`, `dataInicio`, `dataFim`, `orgaoAplicador`, `fonteUrl`.

**Next steps:** ingest CEIS/CNEP CSV dumps into DynamoDB (monthly refresh); define delta strategy (full reload vs. incremental diff); integrate cache-backed lookup in `check_sanctions.ts`.

---

*Sobre os ombros de [Serenata de Amor](https://serenata.ai) e [Querido Diário](https://queridodiario.ok.org.br) (OKFN Brasil).*
