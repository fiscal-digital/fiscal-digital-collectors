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

  for (const r of results) {
    if (r.status === 'fulfilled') {
      logger.info('cidade processada', { name: r.value.name, processed: r.value.processed, sent: r.value.sent })
    } else {
      logger.error('cidade falhou', { reason: r.reason })
    }
  }
}
