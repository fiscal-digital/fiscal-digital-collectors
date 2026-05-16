# Fiscal Digital — Collector / Querido Diário

---

## 🇧🇷 Português

**Fonte oficial:** Querido Diário (OKFN Brasil) — https://queridodiario.ok.org.br

**Status:** ✅ Em produção desde 11 de maio de 2026. Pipeline diário ativo via Lambda agendada (cron 07:00 UTC = 04:00 BRT), coletando diários oficiais de 44 cidades indexadas. Cache de extração populado com aproximadamente 35.000 gazettes (chave EVO-001), reduzindo custo de reanálise futura para uma fração da primeira passada.

**Implementação canônica:** código vive em [`fiscal-digital/packages/collector/`](../../../fiscal-digital/packages/collector/) (Lambda agendada) e [`fiscal-digital/packages/engine/src/skills/query_diario.ts`](../../../fiscal-digital/packages/engine/src/skills/query_diario.ts) (Skill usada pelos Fiscais). Este diretório documenta o contrato e o roteiro de extração futura.

**Contrato de saída esperado:**

- `gazetteId` — chave estável no formato `{territory_id}-{date}-{edition}`
- `territory_id` — código IBGE de 7 dígitos do município
- `date` — ISO8601 (data de publicação do diário)
- `edition` — número da edição
- `pdfUrl` — URL fonte no Querido Diário
- `cachedAt` — timestamp do último cache hit
- `excerptIds` — array de IDs de excerpts extraídos (camada L3')

**Rate limit:** 60 req/min (limite da API Querido Diário — enforced via SQS).

**Princípios herdados:** idempotência, rate limit, cache antes de chamada e logs estruturados JSON definidos em [../../README.md#princípios](../../README.md#princípios).

**Próximos passos:**

1. Mover client da skill `query_diario.ts` para pacote npm privado `@fiscal-digital/collectors-qd` quando o contrato de saída estabilizar
2. Documentar formato L2 (texto bruto) e L3' (excerpts JSON) salvos em S3
3. Expor métricas de cobertura por cidade (P95 latência, taxa de cache hit)

---

## 🇺🇸 English

**Official source:** Querido Diário (OKFN Brasil) — https://queridodiario.ok.org.br

**Status:** ✅ In production since May 11, 2026. Daily Lambda pipeline (cron 07:00 UTC) collecting official gazettes from 44 indexed cities. Extraction cache populated with approximately 35,000 gazettes (key EVO-001).

**Canonical implementation:** [`fiscal-digital/packages/collector/`](../../../fiscal-digital/packages/collector/) (Lambda) and [`fiscal-digital/packages/engine/src/skills/query_diario.ts`](../../../fiscal-digital/packages/engine/src/skills/query_diario.ts) (Skill). Rate limit: 60 req/min via SQS.

**Output contract fields:** `gazetteId`, `territory_id`, `date`, `edition`, `pdfUrl`, `cachedAt`, `excerptIds`.

**Next steps:** extract npm package `@fiscal-digital/collectors-qd`; document L2/L3' S3 formats; expose per-city coverage metrics.

---

*Sobre os ombros de [Serenata de Amor](https://serenata.ai) e [Querido Diário](https://queridodiario.ok.org.br) (OKFN Brasil).*
