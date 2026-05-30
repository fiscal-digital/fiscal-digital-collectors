// Lambda handler — fiscal-digital-supplier-collector-prod
//
// Parte de MIT-02 / EVO-002: enriquece dados cadastrais de fornecedores
// (RFB via BrasilAPI + sanções CGU CEIS/CNEP) e persiste em
// `fiscal-digital-suppliers-prod` no item PROFILE (sk = "PROFILE").
//
// Modos suportados (via payload):
//
//   1. backfill (one-shot, manual)
//      Payload: { mode: 'backfill', cityId: '4305108', limit?: 500 }
//      Scan da tabela alerts-prod por GSI city → coleta CNPJs únicos →
//      enrich cada um. Usado para preencher histórico de uma cidade.
//
//   2. scheduled (EventBridge cron diário 08:00 UTC)
//      Payload EventBridge: { source: 'aws.events', ... }
//      Re-enriquece PROFILEs > 30 dias antigos (refresh de razão social,
//      situação cadastral, sanções).
//
//   3. enrich-on-demand (SQS-triggered)
//      Record.body = CNPJ literal (14 dígitos ou com máscara)
//      Usado pelo analyzer/Fiscais para enrichment just-in-time quando um
//      CNPJ novo aparece num finding.

import type { Context, EventBridgeEvent, SQSEvent } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { createLogger } from '@fiscal-digital/engine'
import { fetchCnpjProfile, situacaoLabel } from './adapters/brasilapi'
import { fetchSanctions } from './adapters/cgu-portal-transparencia'
import { upsertProfile, type SupplierProfile } from './persist'
import { loadCguApiKey } from './secret'

const logger = createLogger('supplier-collector')

const raw = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' })
const ddb = DynamoDBDocumentClient.from(raw)

const ALERTS_TABLE = process.env.ALERTS_TABLE ?? 'fiscal-digital-alerts-prod'
const SUPPLIERS_TABLE = process.env.SUPPLIERS_TABLE ?? 'fiscal-digital-suppliers-prod'

// Idade máxima de um PROFILE antes do refresh diário re-enriquecer.
const PROFILE_REFRESH_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 dias

type BackfillPayload = { mode: 'backfill'; cityId: string; limit?: number }
type ScheduledPayload = { mode: 'scheduled' }
type EnrichPayload = { mode: 'enrich-on-demand'; cnpj: string }
type ManualPayload = BackfillPayload | ScheduledPayload | EnrichPayload

type HandlerEvent =
  | ManualPayload
  | SQSEvent
  | EventBridgeEvent<string, unknown>

export const handler = async (event: HandlerEvent, _context?: Context): Promise<{
  mode: string
  processed: number
  errors: number
}> => {
  // SQS event: cada record.body é um CNPJ → trata como enrich-on-demand batch.
  if ('Records' in event && Array.isArray(event.Records) && event.Records.length > 0) {
    return await runSqsBatch(event as SQSEvent)
  }

  // EventBridge scheduled invocation.
  if ('source' in event && event.source === 'aws.events') {
    logger.info('scheduled invocation (EventBridge)')
    return await runScheduled()
  }

  // Manual invoke com payload tipado.
  const payload = event as ManualPayload
  switch (payload.mode) {
    case 'backfill':
      return await runBackfill(payload)
    case 'scheduled':
      return await runScheduled()
    case 'enrich-on-demand':
      return await runEnrichOne(payload.cnpj)
    default:
      logger.error('payload inválido', { event })
      throw new Error(`Modo desconhecido — esperado backfill | scheduled | enrich-on-demand`)
  }
}

// ─── Modo 1: backfill por cidade ────────────────────────────────────────────
// Scan alerts-prod filtrando por cityId. Limitação: SCAN é caro; aceitável
// porque backfill é one-shot por cidade (rodado < 1× por mês).

async function runBackfill(payload: BackfillPayload): Promise<{ mode: string; processed: number; errors: number }> {
  const { cityId, limit = 500 } = payload
  logger.info('backfill start', { cityId, limit })

  const cnpjs = new Set<string>()
  let lastKey: Record<string, unknown> | undefined

  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: ALERTS_TABLE,
        FilterExpression: 'cityId = :c AND attribute_exists(cnpj)',
        ExpressionAttributeValues: { ':c': cityId },
        ExclusiveStartKey: lastKey,
        // Limit do scan — itens reais devolvidos podem ser menos pelo filter.
        Limit: 200,
      }),
    )
    for (const item of res.Items ?? []) {
      const cnpj = String(item['cnpj'] ?? '').replace(/\D/g, '')
      if (cnpj.length === 14) cnpjs.add(cnpj)
      if (cnpjs.size >= limit) break
    }
    lastKey = res.LastEvaluatedKey
  } while (lastKey && cnpjs.size < limit)

  logger.info('backfill CNPJs únicos', { cityId, count: cnpjs.size })

  let processed = 0
  let errors = 0
  for (const cnpj of cnpjs) {
    try {
      await enrichOne(cnpj)
      processed++
    } catch (err) {
      errors++
      logger.warn('backfill cnpj falhou', { cnpj, err: (err as Error).message })
    }
  }

  logger.info('backfill done', { cityId, processed, errors })
  return { mode: 'backfill', processed, errors }
}

// ─── Modo 2: scheduled (refresh PROFILEs antigos) ───────────────────────────

async function runScheduled(): Promise<{ mode: string; processed: number; errors: number }> {
  logger.info('scheduled refresh start')
  const cutoff = new Date(Date.now() - PROFILE_REFRESH_AGE_MS).toISOString()
  const stale: string[] = []
  let lastKey: Record<string, unknown> | undefined

  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: SUPPLIERS_TABLE,
        FilterExpression: 'sk = :sk AND (attribute_not_exists(lastLookupAt) OR lastLookupAt < :cutoff)',
        ExpressionAttributeValues: { ':sk': 'PROFILE', ':cutoff': cutoff },
        ProjectionExpression: 'pk',
        ExclusiveStartKey: lastKey,
      }),
    )
    for (const item of res.Items ?? []) {
      const pk = String(item['pk'] ?? '')
      const cnpj = pk.startsWith('SUPPLIER#') ? pk.slice('SUPPLIER#'.length) : ''
      if (cnpj.length === 14) stale.push(cnpj)
    }
    lastKey = res.LastEvaluatedKey
  } while (lastKey)

  logger.info('scheduled PROFILEs stale encontrados', { count: stale.length })

  let processed = 0
  let errors = 0
  for (const cnpj of stale) {
    try {
      await enrichOne(cnpj)
      processed++
    } catch (err) {
      errors++
      logger.warn('scheduled cnpj falhou', { cnpj, err: (err as Error).message })
    }
  }

  logger.info('scheduled refresh done', { processed, errors })
  return { mode: 'scheduled', processed, errors }
}

// ─── Modo 3: enrich-on-demand (SQS / manual single) ─────────────────────────

async function runEnrichOne(cnpj: string): Promise<{ mode: string; processed: number; errors: number }> {
  try {
    await enrichOne(cnpj)
    return { mode: 'enrich-on-demand', processed: 1, errors: 0 }
  } catch (err) {
    logger.error('enrich-on-demand falhou', { cnpj, err: (err as Error).message })
    return { mode: 'enrich-on-demand', processed: 0, errors: 1 }
  }
}

async function runSqsBatch(event: SQSEvent): Promise<{ mode: string; processed: number; errors: number }> {
  let processed = 0
  let errors = 0
  for (const record of event.Records) {
    const cnpj = (record.body ?? '').trim()
    if (!cnpj) {
      errors++
      logger.warn('SQS record sem CNPJ no body', { messageId: record.messageId })
      continue
    }
    try {
      await enrichOne(cnpj)
      processed++
    } catch (err) {
      errors++
      // Falha aqui devolve a mensagem pra fila (visibility timeout) → DLQ se >5.
      logger.warn('SQS enrich falhou', { messageId: record.messageId, err: (err as Error).message })
      throw err
    }
  }
  return { mode: 'sqs-enrich', processed, errors }
}

// ─── Core: enrichOne (chamado por todos os modos) ───────────────────────────

async function enrichOne(cnpj: string): Promise<void> {
  const clean = cnpj.replace(/\D/g, '')
  if (clean.length !== 14) {
    throw new Error(`CNPJ inválido: ${cnpj}`)
  }

  // 1) RFB via BrasilAPI
  const rfb = await fetchCnpjProfile(clean)
  const now = new Date().toISOString()

  const profile: SupplierProfile = {
    rfbStatus: rfb.status,
    rfbSourceUrl: rfb.source,
    cguEnabled: false, // será sobrescrito abaixo se CGU rodar
  }

  if (rfb.status === 'ok' && rfb.data) {
    profile.razaoSocial = rfb.data.razao_social
    profile.situacaoCadastral = situacaoLabel(rfb.data.situacao_cadastral)
    profile.dataAbertura = rfb.data.data_inicio_atividade
    profile.socios = rfb.data.qsa?.map(s => s.nome_socio) ?? []
    profile.rfbCapturedAt = now
  } else if (rfb.status === 'erro') {
    profile.lastError = rfb.error
  }

  // 2) CGU CEIS/CNEP — só se o secret carregou
  const apiKey = await loadCguApiKey()
  if (apiKey) {
    profile.cguEnabled = true
    try {
      const sancoes = await fetchSanctions(clean, apiKey)
      profile.sancoes = sancoes.sancoes
      profile.cguCapturedAt = now
      profile.cguSourceUrl = sancoes.source
    } catch (err) {
      // CGU degradou? Mantém profile parcial — não falha o pipeline.
      logger.warn('CGU lookup falhou — profile parcial', {
        cnpj: clean,
        err: (err as Error).message,
      })
      profile.lastError = `cgu: ${(err as Error).message}`
    }
  }

  await upsertProfile(clean, profile)
}

// Helper exportado pra possível uso futuro pela API/admin (query direta).
export async function queryProfile(cnpj: string): Promise<Record<string, unknown> | null> {
  const clean = cnpj.replace(/\D/g, '')
  const res = await ddb.send(
    new QueryCommand({
      TableName: SUPPLIERS_TABLE,
      KeyConditionExpression: 'pk = :pk AND sk = :sk',
      ExpressionAttributeValues: { ':pk': `SUPPLIER#${clean}`, ':sk': 'PROFILE' },
    }),
  )
  return res.Items?.[0] ?? null
}
