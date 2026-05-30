import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { createLogger } from '@fiscal-digital/engine'

const logger = createLogger('supplier-collector:secret')

const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'us-east-1' })

// Cache em escopo de módulo — vive o tempo do container Lambda (cold-start).
// Tipos:
//   undefined  → ainda não tentou carregar
//   null       → tentou e falhou ou não configurado (cguEnabled=false derivado)
//   string     → API key carregada com sucesso
let cached: string | null | undefined

/**
 * Carrega a API key do Portal da Transparência (CGU) do Secrets Manager.
 *
 * Política:
 * - Se `CGU_SECRET_ARN` não está setada → retorna null + warn (cguEnabled=false)
 * - Se a chamada falhar (network, permissão) → retorna null + warn (degrade)
 * - 1× por cold-start: subsequentes invocações na mesma execution env reusam cache
 *
 * Formato esperado do SecretString:
 *   - String simples: o próprio valor é a API key
 *   - JSON com `{ "api_key": "..." }`: parsea e extrai
 */
export async function loadCguApiKey(): Promise<string | null> {
  if (cached !== undefined) return cached

  const arn = process.env.CGU_SECRET_ARN
  if (!arn) {
    logger.warn('CGU_SECRET_ARN ausente — CGU lookups desabilitados (cguEnabled=false)')
    cached = null
    return null
  }

  try {
    const res = await client.send(new GetSecretValueCommand({ SecretId: arn }))
    const raw = res.SecretString
    if (!raw) {
      logger.warn('Secret CGU vazio — cguEnabled=false', { arn })
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
      logger.warn('Secret CGU sem api_key utilizável — cguEnabled=false')
    } else {
      logger.info('CGU API key carregada do Secrets Manager (cold-start)')
    }
    return cached
  } catch (err) {
    logger.warn('Falha ao carregar CGU secret — cguEnabled=false (degrade)', {
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
