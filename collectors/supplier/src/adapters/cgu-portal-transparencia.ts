// Adapter CGU Portal da Transparência (CEIS + CNEP — empresas sancionadas).
//
// Origem: cópia adaptada de `packages/engine/src/skills/check_sanctions.ts`
// do monorepo fiscal-digital. Adaptação:
//   - Sem wrapper `Skill<>`
//   - Sem fallback "no apiKey returns empty" (caller decide se chama)
//   - Rate-limiting interno (~400 req/min — limite Portal da Transparência)
//   - Retorna shape limpo `{ sancoes }` em vez de `SkillResult<>`
//
// Original NÃO removido do engine neste PR (ver brasilapi.ts).

import { createLogger } from '@fiscal-digital/engine'

const logger = createLogger('supplier-collector:cgu')

const CGU_API = 'https://api.portaldatransparencia.gov.br/api-de-dados'

// Rate limit: Portal da Transparência ~400 req/min ≈ 150ms entre calls.
// Como cada lookup faz 2 calls (CEIS + CNEP) paralelos, contamos 1 slot por
// par (não por call individual — Promise.all dispara ambas simultaneamente).
const MIN_INTERVAL_MS = 150
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

export type SancaoType = 'CEIS' | 'CNEP'

export interface Sancao {
  type: SancaoType
  sanction: string
  startDate?: string
  endDate?: string
  organ?: string
}

export interface SancoesResult {
  sancoes: Sancao[]
  /** URLs canônicas consultadas — para auditoria. */
  source: string
}

interface CguRecord {
  tipoSancao: string
  dataInicioSancao?: string
  dataFimSancao?: string
  orgaoSancionador?: string
}

async function collectFrom(
  res: PromiseSettledResult<Response>,
  type: SancaoType,
): Promise<Sancao[]> {
  if (res.status !== 'fulfilled' || !res.value.ok) return []
  try {
    const data = (await res.value.json()) as CguRecord[]
    return data.map(item => ({
      type,
      sanction: item.tipoSancao,
      startDate: item.dataInicioSancao,
      endDate: item.dataFimSancao,
      organ: item.orgaoSancionador,
    }))
  } catch (err) {
    logger.warn('CGU response parse error', { type, err: (err as Error).message })
    return []
  }
}

/**
 * Consulta CEIS + CNEP no Portal da Transparência da CGU.
 *
 * Falha graciosa: se uma das duas endpoints falhar, retorna o que conseguiu.
 * Rate-limited internamente (1 par CEIS+CNEP por slot de 150ms).
 *
 * @param cnpj CNPJ (com ou sem máscara — sanitizado internamente)
 * @param apiKey chave-api-dados emitida pelo Portal da Transparência
 */
export async function fetchSanctions(cnpj: string, apiKey: string): Promise<SancoesResult> {
  const clean = cnpj.replace(/\D/g, '')
  const headers = { Accept: 'application/json', 'chave-api-dados': apiKey }
  const ceisUrl = `${CGU_API}/ceis?cnpjSancionado=${clean}&pagina=1`
  const cnepUrl = `${CGU_API}/cnep?cnpjSancionado=${clean}&pagina=1`

  await throttle()

  const [ceisRes, cnepRes] = await Promise.allSettled([
    fetch(ceisUrl, { headers }),
    fetch(cnepUrl, { headers }),
  ])

  const [ceis, cnep] = await Promise.all([
    collectFrom(ceisRes, 'CEIS'),
    collectFrom(cnepRes, 'CNEP'),
  ])

  return {
    sancoes: [...ceis, ...cnep],
    source: `${ceisUrl},${cnepUrl}`,
  }
}
