import crypto from 'node:crypto'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { queryDiario, extractAll, lookupMemory, saveMemory, pdfCacheS3Key, pdfCacheUrl, gazetteKey, requireEnv, createLogger } from '@fiscal-digital/engine'
import type { CollectorMessage } from '@fiscal-digital/engine'

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'us-east-1' })
const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' })
const raw = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' })
const ddb = DynamoDBDocumentClient.from(raw)

const GAZETTES_TABLE = 'fiscal-digital-gazettes-prod'
const GAZETTES_CACHE_BUCKET = 'fiscal-digital-gazettes-cache-prod'
const QUEUE_URL = requireEnv('GAZETTES_QUEUE_URL')

const logger = createLogger('collector')

// Keywords that signal fiscally relevant acts
const KEYWORDS = [
  'dispensa de licitação',
  'inexigibilidade',
  'contratação direta',
  'aditivo',
  'prorrogação',
  'nomeação',
  'exoneração',
  'licitação',
  'pregão',
  'tomada de preços',
]

interface GazetteLike {
  id: string
  territory_id: string
  date: string
  url: string
  excerpts: string[]
}

// Fase 0 da camada raw: com o JSON de excerpts garantido no S3, a mensagem
// leva so o ponteiro (tamanho constante; texto integral estoura os 256 KB do
// SQS em ~2% dos diarios). Sem a garantia, excerpts inline — o analyzer
// aceita os dois (#174) e falha com retry/DLQ (#176).
export function buildCollectorMessage(
  gazette: GazetteLike,
  entities: CollectorMessage['entities'],
  excerptsS3Key: string | null,
): CollectorMessage {
  return {
    gazetteId: gazette.id,
    territory_id: gazette.territory_id,
    date: gazette.date,
    url: gazette.url,
    ...(excerptsS3Key ? { excerptsS3Key } : { excerpts: gazette.excerpts }),
    entities,
  }
}

export interface CollectorConfig {
  territory_id: string
  since?: string   // override; defaults to last processed date
}

export async function runCollector(config: CollectorConfig): Promise<{ processed: number; sent: number }> {
  const { territory_id } = config
  // Watermark cru lido UMA vez: alimenta o `since` (com lookback) e é preservado
  // no save final quando o run não persiste nada (saveMemory é Put/replace —
  // sem isso, um run vazio apagaria o lastDate real da cidade).
  const prevLastDate = await getWatermarkLastDate(territory_id)
  const since = config.since ??
    (prevLastDate ? sinceWithLookback(prevLastDate) : defaultFirstRunSince())
  const until = new Date().toISOString().split('T')[0]

  logger.info('coletando', { territory_id, since, until })

  let offset = 0
  let processed = 0
  let sent = 0
  let maxPersistedDate: string | null = null
  const pageSize = 50

  while (true) {
    const { data } = await queryDiario.execute({ territory_id, keywords: KEYWORDS, since, until, size: pageSize, offset })
    const { gazettes, total } = data

    if (gazettes.length === 0) break

    for (const gazette of gazettes) {
      processed++
      // Idempotência por URL canônica, NÃO por `gazette.id` do QD.
      // O QD pode retornar a mesma URL com `gazette.id` distintos em queries
      // diferentes — usar o id como chave gerava reprocessamento (LRN-20260503-022).
      const key = gazetteKey(gazette.url)
      if (!key) {
        logger.warn('url inválida — skip', { url: gazette.url, id: gazette.id })
        continue
      }
      if (await isAlreadyQueued(key)) continue

      const text = gazette.excerpts.join('\n')
      const entities = extractAll(text)

      // Archive permanente em S3 — 3 camadas independentes:
      //   L1 (PDF): cachePdf
      //   L2 (texto): cacheTxt — usado para treinamento futuro de modelos
      //   L3' (excerpts JSON): cacheExcerpts — backup imutável do que vai pro DDB
      // Cada camada pode ser regenerada da camada anterior em fallback, mas a
      // persistência redundante elimina round-trips ao QD para reprocessamento.
      const cachedPdfUrl = await cachePdf(gazette.territory_id, gazette.id, gazette.url)
      await cacheTxt(gazette.url, text)
      const excerptsS3Key = await cacheExcerptsJson(gazette.url, gazette.date, gazette.excerpts)

      const msg: CollectorMessage = buildCollectorMessage(gazette, entities, excerptsS3Key)

      await sqs.send(new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify(msg),
        MessageAttributes: {
          gazetteId: { DataType: 'String', StringValue: gazette.id },
        },
      }))

      const queued = await markQueued(key, gazette.url, gazette.date, cachedPdfUrl, gazette.id, gazette.excerpts)
      if (queued) {
        sent++
        // collectors#21: o watermark avança pela data REAL persistida, não pelo run
        if (!maxPersistedDate || gazette.date > maxPersistedDate) maxPersistedDate = gazette.date
      }
      else processed-- // já existia (race) — não conta como processado novo
    }

    offset += pageSize
    if (offset >= total) break
  }

  // collectors#21 — watermark veraz: `lastDate` só avança quando o run
  // persistiu gazette (data real, nunca `until`); `lastAttemptedAt` registra a
  // tentativa para observabilidade. O item é Put/replace, então o lastDate
  // anterior é reescrito explicitamente quando não há avanço.
  const lastDate = nextWatermark(prevLastDate, maxPersistedDate)
  await saveMemory.execute({
    pk: `BACKFILL#${territory_id}`,
    table: GAZETTES_TABLE,
    item: {
      ...(lastDate && { lastDate }),
      lastAttemptedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  })

  return { processed, sent }
}

/**
 * Faz download do PDF da gazette e faz upload para S3.
 * Idempotente: se o objeto já existir no S3, retorna a URL sem re-upload.
 * Retorna a URL pública no CDN ou null em caso de falha não-crítica.
 *
 * Convenção: chave S3 espelha o path da URL QD (sem o host) para que
 * o site/API possam derivar a CDN URL diretamente da source URL sem
 * lookup no DDB. Ver `pdfCacheS3Key` em engine/utils/pdf_cache.
 */
async function cachePdf(
  _territoryId: string,
  _gazetteId: string,
  originalUrl: string,
): Promise<string | null> {
  const key = pdfCacheS3Key(originalUrl)
  const cdnUrl = pdfCacheUrl(originalUrl)
  if (!key || !cdnUrl) {
    logger.warn('url QD inválida — skip cache', { originalUrl })
    return null
  }

  // Checar se já existe (idempotência)
  const alreadyCached = await s3ObjectExists(key)
  if (alreadyCached) {
    return cdnUrl
  }

  // Baixar o PDF
  let pdfBuffer: ArrayBuffer
  try {
    const fetchedAt = new Date().toISOString()
    const response = await fetch(originalUrl, {
      headers: { 'User-Agent': 'FiscalDigital/1.0 (+https://fiscaldigital.org)' },
    })

    if (!response.ok) {
      logger.warn('pdf fetch falhou', { originalUrl, status: response.status })
      return null
    }

    const contentType = response.headers.get('content-type') ?? 'application/pdf'
    pdfBuffer = await response.arrayBuffer()
    const bytes = pdfBuffer.byteLength
    const sha256 = crypto.createHash('sha256').update(Buffer.from(pdfBuffer)).digest('hex')

    // Upload para S3
    await s3.send(new PutObjectCommand({
      Bucket: GAZETTES_CACHE_BUCKET,
      Key: key,
      Body: Buffer.from(pdfBuffer),
      ContentType: 'application/pdf',
      // inline garante que browser exibe no iframe em vez de baixar
      ContentDisposition: 'inline',
      CacheControl: 'public, max-age=31536000, immutable',
      Metadata: {
        originalUrl,
        sha256,
        mimeType: contentType,
        bytes: String(bytes),
        fetchedAt,
      },
    }))

    logger.info('pdf cached', { key, bytes })
    return cdnUrl
  } catch (err) {
    // Falha no cache de PDF não deve interromper o fluxo principal
    logger.warn('pdf cache error', { key, err })
    return null
  }
}

async function s3ObjectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: GAZETTES_CACHE_BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

/**
 * Salva o texto (excerpts concatenados) como arquivo .txt no S3.
 *
 * Chave: `txt/<pdf-key-sem-extensao>.txt` — espelha a hierarquia do PDF.
 * Idempotente: HEAD antes de PUT.
 *
 * Uso futuro: treino de modelos de extração, embeddings, busca full-text
 * sobre o corpus. Hoje é apenas archive — analyzer continua lendo excerpts
 * direto da SQS message.
 *
 * Falha não-crítica: archive é redundância (DDB tem excerpts). Logamos
 * warning e seguimos.
 */
async function cacheTxt(originalUrl: string, text: string): Promise<void> {
  const pdfKey = pdfCacheS3Key(originalUrl)
  if (!pdfKey || !text || text.length === 0) return
  const key = `txt/${pdfKey.replace(/\.pdf$/i, '')}.txt`

  if (await s3ObjectExists(key)) return

  try {
    await s3.send(new PutObjectCommand({
      Bucket: GAZETTES_CACHE_BUCKET,
      Key: key,
      Body: Buffer.from(text, 'utf-8'),
      ContentType: 'text/plain; charset=utf-8',
      CacheControl: 'public, max-age=31536000, immutable',
      Metadata: {
        originalUrl,
        chars: String(text.length),
        archivedAt: new Date().toISOString(),
      },
    }))
    logger.info('txt cached', { key, chars: text.length })
  } catch (err) {
    logger.warn('txt cache error', { key, err })
  }
}

/**
 * Salva o array de excerpts como JSON no S3 — archive imutável do que foi
 * extraído do QD. Permite reprocessamento sem novas chamadas ao QD.
 *
 * Chave: `excerpts/<pdf-key-sem-extensao>.json`
 * Idempotente: HEAD antes de PUT.
 *
 * Diferença do DDB excerpts: S3 é write-once cold storage (Glacier após 181d
 * via lifecycle), DDB é hot path. Redundância vale o custo: ~80GB cold = R$ 4/mês.
 */
// Retorna a chave S3 quando o JSON esta garantido la (escrito agora ou ja
// existente) — e o que permite enviar a mensagem por ponteiro. null = mandar
// excerpts inline (fallback).
async function cacheExcerptsJson(originalUrl: string, date: string, excerpts: string[]): Promise<string | null> {
  const pdfKey = pdfCacheS3Key(originalUrl)
  if (!pdfKey || !excerpts || excerpts.length === 0) return null
  const key = `excerpts/${pdfKey.replace(/\.pdf$/i, '')}.json`

  if (await s3ObjectExists(key)) return key

  const body = {
    originalUrl,
    date,
    excerpts,
    archivedAt: new Date().toISOString(),
    schemaVersion: 1,
  }

  try {
    await s3.send(new PutObjectCommand({
      Bucket: GAZETTES_CACHE_BUCKET,
      Key: key,
      Body: Buffer.from(JSON.stringify(body), 'utf-8'),
      ContentType: 'application/json; charset=utf-8',
      CacheControl: 'public, max-age=31536000, immutable',
      Metadata: {
        originalUrl,
        count: String(excerpts.length),
      },
    }))
    logger.info('excerpts json cached', { key, count: excerpts.length })
    return key
  } catch (err) {
    logger.warn('excerpts json cache error', { key, err })
    return null
  }
}

// O QD ingere gazettes com atraso (D+1 típico; semanas quando um scraper
// municipal é consertado e backfilla). `published_since = lastDate` perde para
// sempre qualquer gazette com data anterior ao watermark que chegue depois.
// Voltar LOOKBACK_DAYS reprocessa a janela com custo ~zero: gazettes já
// coletadas são puladas pelo dedup (`isAlreadyQueued`/`markQueued`).
export const LOOKBACK_DAYS = 14

export function sinceWithLookback(lastDate: string, lookbackDays = LOOKBACK_DAYS): string {
  const d = new Date(`${lastDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - lookbackDays)
  return d.toISOString().split('T')[0]
}

/**
 * Novo lastDate do watermark após um run COMPLETO (collectors#21).
 *
 * Semântica: `lastDate` = data real da última gazette PERSISTIDA — nunca a data
 * do run. O bug anterior gravava `until` (hoje) incondicionalmente: 41 das 50
 * cidades divergiam do dado real e 9 tinham watermark sem nenhuma gazette; o
 * site (`/cities` lê este mesmo item) exibiria "atualizada" para cidade parada.
 *
 * Regras:
 *  - run sem persistência → mantém o anterior (não avança, não regride)
 *  - nunca regride: gazette antiga capturada pelo lookback não puxa o watermark
 *    para trás
 * Só é chamada após a paginação completa — timeout/erro no meio aborta antes do
 * save e o próximo run repete a janela (idempotente via dedup).
 */
export function nextWatermark(
  previousLastDate: string | null,
  maxPersistedDate: string | null,
): string | null {
  if (maxPersistedDate === null) return previousLastDate
  if (previousLastDate === null) return maxPersistedDate
  return maxPersistedDate > previousLastDate ? maxPersistedDate : previousLastDate
}

async function getWatermarkLastDate(territory_id: string): Promise<string | null> {
  const { data } = await lookupMemory.execute({ pk: `BACKFILL#${territory_id}`, table: GAZETTES_TABLE })
  return (data?.['lastDate'] as string | undefined) ?? null
}

function defaultFirstRunSince(): string {
  // First run: go back 1 day
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

async function isAlreadyQueued(key: string): Promise<boolean> {
  const { data } = await lookupMemory.execute({ pk: `GAZETTE#${key}`, table: GAZETTES_TABLE })
  return data !== null
}

// Race-safe: usa ConditionExpression `attribute_not_exists(pk)` para evitar
// que duas Lambdas concorrentes escrevam a mesma gazette. Retorna `true` se
// a entry foi criada nesta chamada; `false` se já existia.
async function markQueued(
  key: string,
  url: string,
  date: string,
  cachedPdfUrl: string | null,
  gazetteId: string,
  excerpts: string[] | undefined,
): Promise<boolean> {
  const item: Record<string, unknown> = {
    pk: `GAZETTE#${key}`,
    url,
    date,
    gazetteId, // mantém o id original do QD como atributo (auditoria/debug)
    status: 'queued',
    queuedAt: new Date().toISOString(),
    ...(cachedPdfUrl != null && { cachedPdfUrl }),
    // EVO-001 / UH-22: persistir excerpts evita re-coletar QD ($10/rodada,
    // 14h de execução por rate-limit). Reanalyze lê do DDB (lazy fill no
    // miss). Item médio ~3 KB (10 excerpts × 300 chars), bem abaixo do
    // limite de 400 KB do DynamoDB.
    ...(excerpts && excerpts.length > 0 && { excerpts }),
  }

  try {
    await ddb.send(new PutCommand({
      TableName: GAZETTES_TABLE,
      Item: item,
      ConditionExpression: 'attribute_not_exists(pk)',
    }))
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      return false
    }
    throw err
  }
  // WIN-API-003: incrementa counter agregado para `/stats.totalGazettesProcessed`
  // (substitui scan de 23 MB na API). UpdateItem ADD é atômico em DDB; failure
  // aqui não desfaz o Put — counter pode defasar mas auto-corrige na próxima
  // execução do migration script.
  try {
    await ddb.send(new UpdateCommand({
      TableName: GAZETTES_TABLE,
      Key: { pk: 'AGG#GAZETTE_COUNT' },
      UpdateExpression: 'ADD #t :one SET updatedAt = :ts',
      ExpressionAttributeNames: { '#t': 'total' },
      ExpressionAttributeValues: { ':one': 1, ':ts': new Date().toISOString() },
    }))
  } catch (err) {
    logger.warn('counter increment failed', { err: (err as Error).message })
  }
  await bumpCityCounter(key, date)
  return true
}

/**
 * Extrai o territory_id da chave de gazette.
 *
 * Deriva do MESMO lugar que o `begins_with(pk, 'GAZETTE#{cityId}#')` que a API
 * usava — se derivássemos de `gazette.territory_id`, counter e scan poderiam
 * divergir quando o QD devolve um territory_id diferente do que está na URL.
 *
 * `gazetteKey` tem duas formas: `{territory_id}#{date}#{hash}` para URLs do QD
 * e `URLHASH#{sha256}` para o resto. A segunda não pertence a cidade nenhuma
 * sob esse critério, então retorna `null` — do contrário criaríamos um counter
 * fantasma com pk `AGG#GAZETTE_COUNT#URLHASH`.
 */
export function cityIdFromGazetteKey(key: string): string | null {
  const first = key.split('#')[0]
  return /^\d+$/.test(first) ? first : null
}

/**
 * Mantém o agregado por cidade lido por `/cities/{cityId}/stats`.
 *
 * O endpoint fazia Scan da tabela inteira (47.720 itens / 94 MB) porque `pk` é
 * a chave HASH e `begins_with` sobre ela não vira Query — levava 2,8–3,3 s para
 * devolver 288 bytes. Este counter troca isso por 1 GetItem.
 *
 * São até 3 UpdateItem porque o DynamoDB não tem `min`/`max` em
 * UpdateExpression: o ADD do total precisa ser incondicional (se viesse junto
 * de uma condição de data, um item que não é novo mínimo/máximo perderia a
 * contagem), e cada extremo tem sua própria condição. Best-effort como o
 * counter global: falha aqui não desfaz o Put, e o
 * `scripts/reconcile-gazette-counters.mjs` reconcilia.
 */
async function bumpCityCounter(key: string, date: string): Promise<void> {
  const cityId = cityIdFromGazetteKey(key)
  if (!cityId) return
  const pk = `AGG#GAZETTE_COUNT#${cityId}`
  const now = new Date().toISOString()

  try {
    await ddb.send(new UpdateCommand({
      TableName: GAZETTES_TABLE,
      Key: { pk },
      UpdateExpression: 'ADD #t :one SET updatedAt = :ts',
      ExpressionAttributeNames: { '#t': 'total' },
      ExpressionAttributeValues: { ':one': 1, ':ts': now },
    }))
  } catch (err) {
    logger.warn('city counter increment failed', { cityId, err: (err as Error).message })
    return
  }

  // ConditionalCheckFailed aqui é o caso NORMAL (a data não é novo extremo).
  for (const [attr, cmp] of [['firstDate', '>'], ['lastDate', '<']] as const) {
    try {
      await ddb.send(new UpdateCommand({
        TableName: GAZETTES_TABLE,
        Key: { pk },
        UpdateExpression: `SET #a = :d`,
        ConditionExpression: `attribute_not_exists(#a) OR #a ${cmp} :d`,
        ExpressionAttributeNames: { '#a': attr },
        ExpressionAttributeValues: { ':d': date },
      }))
    } catch (err) {
      if ((err as { name?: string })?.name !== 'ConditionalCheckFailedException') {
        logger.warn('city counter date update failed', { cityId, attr, err: (err as Error).message })
      }
    }
  }
}
