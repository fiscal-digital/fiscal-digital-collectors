import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { createLogger, requireEnv } from '@fiscal-digital/engine'
import type { Sancao } from './adapters/cgu-portal-transparencia'

const logger = createLogger('supplier-collector:persist')

const raw = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' })
const ddb = DynamoDBDocumentClient.from(raw)

/**
 * Schema do item PROFILE no `fiscal-digital-suppliers-prod`:
 *
 *   pk = SUPPLIER#{cnpj14}
 *   sk = PROFILE                  ← chave fixa para o profile (1 por CNPJ)
 *
 * Coexiste com os items CONTRACT (sk = `{contractedAt}#{contractId}`)
 * escritos pelo analyzer (PR #71). Mesma tabela, mesmo hash, diferenciados
 * apenas pelo `sk`.
 *
 * Status RFB:
 *   - 'ok'              → profile completo (BrasilAPI respondeu 200)
 *   - 'nao_encontrado'  → CNPJ não existe na base da RFB (BrasilAPI 404)
 *   - 'erro'            → falha transitória (5xx, timeout, network)
 */
export interface SupplierProfile {
  razaoSocial?: string
  situacaoCadastral?: string
  dataAbertura?: string
  socios?: string[]
  sancoes?: Sancao[]
  rfbStatus: 'ok' | 'nao_encontrado' | 'erro'
  rfbSourceUrl?: string
  /** ISO8601 do momento em que RFB foi consultada com sucesso. */
  rfbCapturedAt?: string
  /** ISO8601 do momento em que CGU foi consultada (ok ou skipped). */
  cguCapturedAt?: string
  /** false quando CGU_SECRET_ARN ausente ou secret indisponível. */
  cguEnabled: boolean
  cguSourceUrl?: string
  /** Mensagem de erro do último lookup que falhou (opcional, ajuda RCA). */
  lastError?: string
}

const SUPPLIERS_TABLE = process.env.SUPPLIERS_TABLE ?? 'fiscal-digital-suppliers-prod'

interface UpsertResult {
  pk: string
  sk: string
  updatedFields: string[]
}

/**
 * Upsert idempotente do PROFILE de um fornecedor.
 *
 * Usa `UpdateCommand` com SET — campos undefined no profile NÃO são removidos
 * do item existente, preservando histórico parcial (ex: se RFB falhou hoje mas
 * tinha sucesso anterior, mantemos a razão social anterior).
 *
 * Sempre seta `lastLookupAt = now()` para sinalizar que o refresh rodou.
 */
export async function upsertProfile(cnpj: string, profile: SupplierProfile): Promise<UpsertResult> {
  const cnpj14 = cnpj.replace(/\D/g, '')
  const pk = `SUPPLIER#${cnpj14}`
  const sk = 'PROFILE'
  const now = new Date().toISOString()

  // Constrói UpdateExpression dinamicamente — só campos definidos no profile
  // entram no SET. Isso evita sobrescrever razaoSocial com undefined quando
  // RFB falha mas CGU sucesso.
  const setClauses: string[] = ['#lastLookupAt = :lastLookupAt']
  const names: Record<string, string> = { '#lastLookupAt': 'lastLookupAt' }
  const values: Record<string, unknown> = { ':lastLookupAt': now }

  function setIfDefined(field: keyof SupplierProfile, value: unknown): void {
    if (value === undefined) return
    const placeholder = `#${field}`
    const valKey = `:${field}`
    setClauses.push(`${placeholder} = ${valKey}`)
    names[placeholder] = field
    values[valKey] = value
  }

  // rfbStatus e cguEnabled sempre presentes (não-undefined).
  setIfDefined('rfbStatus', profile.rfbStatus)
  setIfDefined('cguEnabled', profile.cguEnabled)
  // Opcionais
  setIfDefined('razaoSocial', profile.razaoSocial)
  setIfDefined('situacaoCadastral', profile.situacaoCadastral)
  setIfDefined('dataAbertura', profile.dataAbertura)
  setIfDefined('socios', profile.socios)
  setIfDefined('sancoes', profile.sancoes)
  setIfDefined('rfbSourceUrl', profile.rfbSourceUrl)
  setIfDefined('rfbCapturedAt', profile.rfbCapturedAt)
  setIfDefined('cguCapturedAt', profile.cguCapturedAt)
  setIfDefined('cguSourceUrl', profile.cguSourceUrl)
  setIfDefined('lastError', profile.lastError)

  await ddb.send(
    new UpdateCommand({
      TableName: SUPPLIERS_TABLE,
      Key: { pk, sk },
      UpdateExpression: `SET ${setClauses.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  )

  const updatedFields = Object.values(names).filter(f => f !== 'lastLookupAt')
  logger.info('profile upsert', { cnpj14, fields: updatedFields.length })
  return { pk, sk, updatedFields }
}

/**
 * Helper que valida env vars obrigatórias na cold-start do handler.
 * Fail-fast: lança se faltar (segue LRN-20260503-021 do CLAUDE.md raiz).
 */
export function assertSuppliersTable(): string {
  // Aceita default mas exige que esteja explicito em prod via terraform.
  return process.env.SUPPLIERS_TABLE ?? requireEnv('SUPPLIERS_TABLE')
}
