# Fiscal Digital — Collector / Querido Diário

---

## 🇧🇷 Português

**Fonte oficial:** Querido Diário (OKFN Brasil), https://queridodiario.ok.org.br

**Status:** ✅ Em produção desde 11 de maio de 2026. Pipeline diário ativo via Lambda agendada (cron 07:07 UTC = 04:07 BRT, seg-sex), sobre 50 cidades configuradas. Cache de extração populado com aproximadamente 47.000 gazettes (chave EVO-001), reduzindo custo de reanálise futura para uma fração da primeira passada.

**Implementação canônica:** código vive em [`collectors/querido-diario/`](../../collectors/querido-diario/) (Lambda agendada, neste repo) e [`fiscal-digital/packages/engine/src/skills/query_diario.ts`](../../../fiscal-digital/packages/engine/src/skills/query_diario.ts) (Skill, no engine). Este diretório documenta o contrato.

**Contrato de saída esperado:**

- `gazetteId`: chave estável no formato `{territory_id}-{date}-{edition}`
- `territory_id`: código IBGE de 7 dígitos do município
- `date`: ISO8601 (data de publicação do diário)
- `edition`: número da edição
- `pdfUrl`: URL fonte no Querido Diário
- `cachedAt`: timestamp do último cache hit
- `excerptIds`: array de IDs de excerpts extraídos (camada L3')

**O que o Querido Diário pede e como respeitamos:**

A [documentação da API pública](https://docs.queridodiario.ok.org.br/pt-br/latest/utilizando/api-publica.html) não impõe restrição formal; pede "bom senso para manter taxa de requisição baixa" e dá **60 requisições/minuto** como referência.

- **Taxa:** `RateLimiter` com reserva de vaga, instância única por processo, em dois pontos: a skill `query_diario` (API, `api.queridodiario.org.br`) e os downloads de PDF no collector (`data.queridodiario.ok.org.br`). Cada um com orçamento próprio de 60/min. Não há fila SQS nesse caminho — a SQS do pipeline fica *depois* do collector, entre ele e o analyzer, e não limita chamadas à fonte. Uma versão anterior deste README afirmava o contrário.
- **Retentativa:** uma só, em 429/5xx transitório ou falha de rede, honrando `Retry-After` quando vier (teto de 30 s). Mais que uma vira carga em cima de quem já está fora.
- **Identificação:** User-Agent único `FiscalDigital/<versão> (+https://fiscaldigital.org)` em toda chamada, API e PDF.
- **Horário:** cron às 07:07 UTC, fora do minuto cheio em que todo agendador dispara.
- **Cache antes de chamada:** gazette já persistida não é buscada de novo; PDF já em S3 não é baixado de novo.

Histórico: até setembro de 2026 o limitador não serializava sob concorrência e o collector disparava as 50 cidades no mesmo segundo — cerca de 50 vezes a referência. Corrigido em `fiscal-digital#fix/qd-rate-limit-real`.

**Princípios herdados:** idempotência, rate limit, cache antes de chamada e logs estruturados JSON definidos em [../../README.md#princípios](../../README.md#princípios).

**Próximos passos:**

1. Mover client da skill `query_diario.ts` para pacote npm privado `@fiscal-digital/collectors-qd` quando o contrato de saída estabilizar
2. Documentar formato L2 (texto bruto) e L3' (excerpts JSON) salvos em S3
3. Expor métricas de cobertura por cidade (P95 latência, taxa de cache hit)

---

## 🇺🇸 English

**Official source:** Querido Diário (OKFN Brasil), https://queridodiario.ok.org.br

**Status:** ✅ In production since May 11, 2026. Daily Lambda pipeline (cron 07:07 UTC, Mon-Fri) over 50 configured cities. Extraction cache populated with approximately 47,000 gazettes (key EVO-001).

**Canonical implementation:** [`collectors/querido-diario/`](../../collectors/querido-diario/) (Lambda, this repo) and [`fiscal-digital/packages/engine/src/skills/query_diario.ts`](../../../fiscal-digital/packages/engine/src/skills/query_diario.ts) (Skill, engine).

**What Querido Diário asks and how we comply:** the [public API docs](https://docs.queridodiario.ok.org.br/en/latest/using/public-api.html) impose no formal restriction; they ask for "common sense" to keep the request rate low, with **60 requests/minute** as the reference. We apply a slot-reserving `RateLimiter` (one instance per process) at both call sites — the `query_diario` skill (API) and PDF downloads in the collector (storage host), each with its own 60/min budget; a single retry on transient 429/5xx or network failure, honoring `Retry-After` (30 s cap); one User-Agent `FiscalDigital/<version> (+https://fiscaldigital.org)` everywhere; and a cron off the top of the hour. There is **no SQS** on the path to the source — the pipeline's SQS sits after the collector — despite what an earlier version of this README claimed.

**Output contract fields:** `gazetteId`, `territory_id`, `date`, `edition`, `pdfUrl`, `cachedAt`, `excerptIds`.

**Next steps:** extract npm package `@fiscal-digital/collectors-qd`; document L2/L3' S3 formats; expose per-city coverage metrics.

---

*Sobre os ombros de [Serenata de Amor](https://serenata.ai) e [Querido Diário](https://queridodiario.ok.org.br) (OKFN Brasil).*
