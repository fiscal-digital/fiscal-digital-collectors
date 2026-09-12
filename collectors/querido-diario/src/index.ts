import type { EventBridgeEvent } from 'aws-lambda'
import { activeCities, createLogger } from '@fiscal-digital/engine'
import { runCollector } from './collector'

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
    logger.info('backfill done', { processed: result.processed, sent: result.sent })
    return
  }

  // Daily run: all cities in parallel
  const results = await Promise.allSettled(
    CIDADES.map(c => runCollector({ territory_id: c.territory_id }).then(r => ({ ...r, name: c.name }))),
  )

  let falhas = 0
  for (const r of results) {
    if (r.status === 'fulfilled') {
      logger.info('cidade processada', { name: r.value.name, processed: r.value.processed, sent: r.value.sent })
    } else {
      falhas++
      logger.error('cidade falhou', { reason: r.reason })
    }
  }

  assertNotAllFailed(falhas, results.length)
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
