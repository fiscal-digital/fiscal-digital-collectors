import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import { createLogger } from '@fiscal-digital/engine'

const logger = createLogger('supplier-collector:secret')

const client = new SSMClient({ region: process.env.AWS_REGION ?? 'us-east-1' })

// Cache em escopo de módulo — vive o tempo do container Lambda (cold-start).
// Tipos:
//   undefined  → ainda não tentou carregar
//   null       → tentou e falhou ou não configurado (cguEnabled=false derivado)
//   string     → API key carregada com sucesso
let cached: string | null | undefined

/**
 * Carrega a API key do Portal da Transparência (CGU) do SSM Parameter Store
 * (SecureString; migrado do Secrets Manager em 2026-11-19 por custo).
 *
 * Política:
 * - Se `CGU_PARAM_NAME` não está setada → retorna null + warn (cguEnabled=false)
 * - Se a chamada falhar (network, permissão) → retorna null + warn (degrade)
 * - 1× por cold-start: subsequentes invocações na mesma execution env reusam cache
 *
 * Formato esperado do valor:
 *   - String simples: o próprio valor é a API key
 *   - JSON com `{ "api_key": "..." }`: parsea e extrai
 */
export async function loadCguApiKey(): Promise<string | null> {
  if (cached !== undefined) return cached

  const name = process.env.CGU_PARAM_NAME
  if (!name) {
    logger.warn('CGU_PARAM_NAME ausente — CGU lookups desabilitados (cguEnabled=false)')
    cached = null
    return null
  }

  try {
    const res = await client.send(new GetParameterCommand({ Name: name, WithDecryption: true }))
    const raw = res.Parameter?.Value
    if (!raw) {
      logger.warn('Parametro CGU vazio — cguEnabled=false', { name })
      cached = null
      return null
    }

    // Aceita tanto string literal quanto JSON { api_key }.
    try {
      const parsed = JSON.parse(raw)
      const key = typeof parsed === 'string' ? parsed : parsed?.api_key
      cached = typeof key === 'string' && key.length > 0 ? key : null
    } catch {
      // Não é JSON — assume string literal
      cached = raw.length > 0 ? raw : null
    }

    if (cached === null) {
      logger.warn('Parametro CGU sem api_key utilizável — cguEnabled=false')
    } else {
      logger.info('CGU API key carregada do SSM (cold-start)')
    }
    return cached
  } catch (err) {
    logger.warn('Falha ao carregar parametro CGU — cguEnabled=false (degrade)', {
      err: (err as Error).message,
    })
    cached = null
    return null
  }
}

/**
 * Reset do cache. Apenas para uso em testes.
 * @internal
 */
export function _resetCacheForTests(): void {
  cached = undefined
}
