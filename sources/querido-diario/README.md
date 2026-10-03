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
- **Horário:** cron às 07:07 UTC e segunda passada às 13:37 UTC, ambos fora do minuto cheio em que todo agendador dispara. A segunda passada recupera as cidades recusadas com 5xx de madrugada; a coleta é idempotente por URL canônica.
- **Cache antes de chamada:** gazette já persistida não é buscada de novo; PDF já em S3 não é baixado de novo.

Histórico: até setembro de 2026 o limitador não serializava sob concorrência e o collector disparava as 50 cidades no mesmo segundo — cerca de 50 vezes a referência. Corrigido em `fiscal-digital#fix/qd-rate-limit-real`.

**Camada raw (texto integral):**

O QD entrega, por diário, até N *excerpts* de 300 caracteres em volta das keywords — é o que alimenta o pipeline hoje. O canário da Fase 1 (`fiscal-digital#179`, issue `#166`) mostrou que os fiscais lendo o **texto integral** com janelas locais encontram várias vezes mais achados publicáveis. Por isso o collector também arquiva o texto integral em `s3://fiscal-digital-gazettes-cache-prod/raw/`, a partir do `txt_url` que a própria API do QD devolve (mesmo path do PDF, extensão `.txt`) — sem baixar e extrair o PDF de novo.

Duas convenções convivem no mesmo prefixo:

| Quem escreve | Chave | Manifesto |
|---|---|---|
| Collector diário (esta Lambda, a partir de setembro de 2026) | `raw/txt/{territory_id}/{date}/{qdhash}.txt` — `qdhash` é o hash da URL canônica (`gazetteKey`), derivável só da gazette | **não** escreve |
| Backfill histórico (`fiscal-digital/scripts/ingest-aggregates.mjs`, Caxias e Porto Alegre 2021–2025) | `raw/txt/{territory_id}/{date}/{sha16 do texto}.txt` | `raw/manifests/{territory_id}/{ano}.json` |

O diário não escreve manifesto de propósito: o cron das 07:07 e um backfill da mesma cidade fariam *read-modify-write* concorrente no mesmo JSON. A Fase 2 (analyzer lendo o texto integral) resolve pela chave derivada primeiro e cai no manifesto só para o histórico.

Metadados do objeto: `sha256`, `source-url` (o `.txt`), `pdf-url`, `territory-id`, `date`, `chars`, `archived-at`. Idempotente (HEAD antes de PUT); a busca do `.txt` passa pelo **mesmo limitador dos PDFs** (mesmo host, mesmo orçamento de 60/min) com o mesmo User-Agent; falha é `warn` e não bloqueia o pipeline. Custo: um GET a mais por diário novo, texto de dezenas a centenas de KB, S3 STANDARD. O log `cidade processada` traz `rawTxtCached`.

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

**Raw layer (full text):** besides the 300-char excerpts, the collector archives each gazette's full text in `s3://fiscal-digital-gazettes-cache-prod/raw/txt/{territory_id}/{date}/{qdhash}.txt`, fetched from the `txt_url` the QD API already returns (same path as the PDF, `.txt` extension) — no second PDF download or extraction. `qdhash` is the hash of the canonical URL (`gazetteKey`), so the key is derivable from the gazette alone. The historical backfill (`ingest-aggregates.mjs`, Caxias do Sul and Porto Alegre 2021–2025) uses a sibling convention under the same prefix (`{sha16 of text}.txt` plus `raw/manifests/{territory_id}/{year}.json`); the daily collector deliberately writes no manifest to avoid concurrent read-modify-write with backfills. Idempotent (HEAD before PUT), same rate limiter and User-Agent as PDF downloads, non-blocking on failure. Motivation: Phase 1 canary of issue #166 (fiscal-digital#179) — fiscais reading full text find several times more publishable findings than on excerpts.

**Next steps:** extract npm package `@fiscal-digital/collectors-qd`; document L2/L3' S3 formats; expose per-city coverage metrics.

---

*Sobre os ombros de [Serenata de Amor](https://serenata.ai) e [Querido Diário](https://queridodiario.ok.org.br) (OKFN Brasil).*
