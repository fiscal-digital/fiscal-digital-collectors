import type { EventBridgeEvent } from 'aws-lambda'
import { activeCities, createLogger } from '@fiscal-digital/engine'
import { runCollector, type CollectorRunResult } from './collector'

interface BackfillPayload {
  territory_id?: string
  since?: string
  backfill?: boolean
}

const CIDADES = activeCities().map(c => ({ territory_id: c.cityId, name: c.name }))

const logger = createLogger('collector')

export const handler = async (
  event: EventBridgeEvent<'Scheduled Event', BackfillPayload>,
): Promise<void> => {
  const detail = event.detail ?? {}

  // Manual backfill: single city with explicit since date
  if (detail.backfill && detail.territory_id) {
    logger.info('backfill', { territory_id: detail.territory_id, since: detail.since })
    const result = await runCollector({ territory_id: detail.territory_id, since: detail.since })
    logger.info('backfill done', { processed: result.processed, sent: result.sent, rawTxtCached: result.rawTxtCached })
    return
  }

  // Daily run: all cities in parallel. Roda duas vezes por dia útil (07:07 e
  // 13:37 UTC); a segunda pega o que o QD recusou na primeira — a coleta é
  // idempotente por URL canônica (isAlreadyQueued), então repetir é seguro.
  const results = await Promise.allSettled(
    CIDADES.map(c => runCollector({ territory_id: c.territory_id })),
  )

  const resumo = summarizeRun(CIDADES, results)
  for (const c of resumo.cidades) {
    logger.info('cidade processada', { ...c })
  }
  for (const f of resumo.falhas) {
    logger.error('cidade falhou', { territory_id: f.territory_id, name: f.name, motivo: f.motivo })
  }
  logger.info('resumo da coleta', {
    total: results.length,
    ok: resumo.cidades.length,
    falhas: resumo.falhas.length,
    sent: resumo.sent,
    rawTxtCached: resumo.rawTxtCached,
    cidadesComFalha: resumo.falhas.map(f => f.territory_id),
  })

  assertNotAllFailed(resumo.falhas.length, results.length)
}

interface Cidade { territory_id: string; name: string }

export interface ResumoColeta {
  cidades: Array<Cidade & CollectorRunResult>
  falhas: Array<Cidade & { motivo: string }>
  sent: number
  rawTxtCached: number
}

/**
 * Casa cada resultado com a SUA cidade. Antes, o log "cidade falhou" só tinha
 * o erro ("Querido Diário API 503"): em dias com 30–90 falhas não havia como
 * saber quais cidades ficaram para trás sem cruzar watermarks à mão.
 * `Promise.allSettled` preserva a ordem da entrada — índice i é a cidade i.
 */
export function summarizeRun(
  cidades: Cidade[],
  results: PromiseSettledResult<CollectorRunResult>[],
): ResumoColeta {
  const resumo: ResumoColeta = { cidades: [], falhas: [], sent: 0, rawTxtCached: 0 }
  results.forEach((r, i) => {
    const cidade = cidades[i]
    if (r.status === 'fulfilled') {
      resumo.cidades.push({ ...cidade, ...r.value })
      resumo.sent += r.value.sent
      resumo.rawTxtCached += r.value.rawTxtCached
    } else {
      const motivo = r.reason instanceof Error ? r.reason.message : String(r.reason)
      resumo.falhas.push({ ...cidade, motivo })
    }
  })
  return resumo
}

/**
 * Falha por cidade é tolerada (uma prefeitura fora do ar não pode derrubar as
 * outras 49), mas 50/50 falhando é a fonte ou nós — nunca "sucesso". Entre
 * 2026-08-24 e 2026-09-11 a API do Querido Diário mudou de host, todas as
 * cidades falharam todo dia e a Lambda terminava OK: o alarme de Errors
 * (threshold 1) nunca disparou e a coleta ficou 3 semanas parada em silêncio.
 * Lançar aqui faz o run contar como erro no CloudWatch no mesmo dia.
 */
export function assertNotAllFailed(falhas: number, total: number): void {
  if (total > 0 && falhas === total) {
    throw new Error(`coleta falhou em todas as ${total} cidades — fonte indisponível ou host/config errados`)
  }
}
