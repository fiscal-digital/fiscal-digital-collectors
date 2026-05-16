# Fiscal Digital — Collector / Receita Federal

---

## 🇧🇷 Português

**Fonte oficial:** Receita Federal do Brasil. Dados de CNPJ (situação cadastral, sócios, data de abertura). Acesso atual indireto via [BrasilAPI](https://brasilapi.com.br).

**Status:** 🚧 Parcial. A skill `validate_cnpj.ts` faz proxy para a BrasilAPI e já está ativa em produção. Um adapter dedicado com cache DynamoDB e fallback para dump CSV ainda não foi extraído para este repo.

**Implementação canônica:** [`fiscal-digital/packages/engine/src/skills/validate_cnpj.ts`](../../../fiscal-digital/packages/engine/src/skills/validate_cnpj.ts).

**Contrato de saída esperado:**

- `cnpj`: 14 dígitos sem formatação
- `razaoSocial`: string
- `situacaoCadastral`: `ATIVA` | `BAIXADA` | `INAPTA` | `NULA` | `SUSPENSA`
- `dataAbertura`: ISO8601
- `cnaePrincipal`: código e descrição
- `socios`: array de `{nome, qualificacao}`
- `fetchedAt`: timestamp do lookup

**Princípios herdados:** idempotência, rate limit, cache antes de chamada e logs estruturados JSON definidos em [../../README.md#princípios](../../README.md#princípios).

**Próximos passos:**

1. Avaliar dump CSV mensal da Receita Federal em dados.gov.br como fonte primária, com BrasilAPI como fallback
2. Implementar cache local DynamoDB (TTL 30 dias) antes do chamado externo, para reduzir latência e dependência de API de terceiros
3. Extrair package `@fiscal-digital/collectors-rfb` quando o adapter direto existir

---

## 🇺🇸 English

**Official source:** Brazilian Federal Revenue (Receita Federal). Company registry data (CNPJ). Current access via [BrasilAPI](https://brasilapi.com.br) proxy.

**Status:** 🚧 Partial. Skill `validate_cnpj.ts` is active in production. A dedicated adapter with DynamoDB cache has not yet been extracted to this repo.

**Canonical implementation:** [`fiscal-digital/packages/engine/src/skills/validate_cnpj.ts`](../../../fiscal-digital/packages/engine/src/skills/validate_cnpj.ts).

**Output contract fields:** `cnpj`, `razaoSocial`, `situacaoCadastral`, `dataAbertura`, `cnaePrincipal`, `socios`, `fetchedAt`.

**Next steps:** evaluate monthly CSV dump as primary source; add DynamoDB cache (TTL 30 days); extract `@fiscal-digital/collectors-rfb` package.

---

*Sobre os ombros de [Serenata de Amor](https://serenata.ai) e [Querido Diário](https://queridodiario.ok.org.br) (OKFN Brasil).*
