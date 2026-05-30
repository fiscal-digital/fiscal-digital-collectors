// Adapter BrasilAPI (consulta CNPJ na Receita Federal).
//
// Origem: cópia adaptada de `packages/engine/src/skills/validate_cnpj.ts`
// do monorepo fiscal-digital. Adaptação:
//   - Remove o wrapper `Skill<>` (não precisamos da abstração de Skill aqui)
//   - Adiciona rate-limiting interno (~3 req/s — limite BrasilAPI free tier)
//   - Retorna shape limpo `{ status, data? }` em vez de `SkillResult<>`
//
// O arquivo original NÃO é removido do engine neste PR — outros consumidores
// (FiscalFornecedores no analyzer) ainda dependem dele. Migração total fica
// pra PR pós Ciclo 4.

import { createLogger } from '@fiscal-digital/engine'

const logger = createLogger('supplier-collector:brasilapi')

const BRASIL_API = 'https://brasilapi.com.br/api/cnpj/v1'

// Rate limit: BrasilAPI free tier ~3 req/s — usamos 350ms por segurança.
// NODE_ENV=test pula o throttle (testes não precisam esperar).
const MIN_INTERVAL_MS = 350
let lastCallAt = 0

async function throttle(): Promise<void> {
  if (process.env.NODE_ENV === 'test') return
  const now = Date.now()
  const elapsed = now - lastCallAt
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_INTERVAL_MS - elapsed))
  }
  lastCallAt = Date.now()
}

export interface BrasilApiCnpjSocio {
  nome_socio: string
}

export interface BrasilApiCnpjResponse {
  cnpj: string
  razao_social: string
  situacao_cadastral: number
  data_inicio_atividade: string
  qsa?: BrasilApiCnpjSocio[]
}

export type CnpjFetchStatus = 'ok' | 'nao_encontrado' | 'erro'

export interface CnpjFetchResult {
  status: CnpjFetchStatus
  data?: BrasilApiCnpjResponse
  /** URL canônica consultada — vai pro `rfbSourceUrl` no profile. */
  source: string
  /** Mensagem de erro quando status === 'erro'. */
  error?: string
}

const SITUACAO_LABELS: Record<number, string> = {
  1: 'nula',
  2: 'ativa',
  3: 'suspensa',
  4: 'inapta',
  8: 'baixada',
}

export function situacaoLabel(code: number): string {
  return SITUACAO_LABELS[code] ?? 'desconhecida'
}

/**
 * Consulta a BrasilAPI para obter o profile cadastral do CNPJ na RFB.
 *
 * - 404 → `{ status: 'nao_encontrado' }` (CNPJ não existe na base)
 * - 5xx / timeout / network → `{ status: 'erro', error }` (não falha o pipeline)
 * - 200 → `{ status: 'ok', data }`
 *
 * Rate-limited internamente para respeitar ~3 req/s.
 */
export async function fetchCnpjProfile(cnpj: string): Promise<CnpjFetchResult> {
  const clean = cnpj.replace(/\D/g, '')
  const source = `${BRASIL_API}/${clean}`

  await throttle()

  try {
    const res = await fetch(source, { headers: { Accept: 'application/json' } })

    if (res.status === 404) {
      return { status: 'nao_encontrado', source }
    }

    if (!res.ok) {
      const error = `BrasilAPI ${res.status}: ${res.statusText}`
      logger.warn('BrasilAPI non-ok', { cnpj: clean, status: res.status })
      return { status: 'erro', source, error }
    }

    const body = (await res.json()) as BrasilApiCnpjResponse
    return { status: 'ok', source, data: body }
  } catch (err) {
    const msg = (err as Error).message
    logger.warn('BrasilAPI fetch error', { cnpj: clean, err: msg })
    return { status: 'erro', source, error: msg }
  }
}
