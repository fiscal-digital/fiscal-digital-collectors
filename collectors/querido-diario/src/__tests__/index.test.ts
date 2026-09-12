// Regressão do apagão silencioso de 2026-08/09: com todas as cidades falhando
// (host do QD migrado), o handler retornava OK e nenhum alarme de Errors
// disparou. Todas falharam ⇒ o run precisa terminar em erro.
jest.mock('@fiscal-digital/engine', () => ({
  ...jest.requireActual('@fiscal-digital/engine'),
  requireEnv: (k: string) => process.env[k] ?? 'https://sqs.test/queue',
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}))

import { assertNotAllFailed } from '../index'

describe('assertNotAllFailed', () => {
  it('todas as cidades falharam: lança erro (Lambda conta como Errors)', () => {
    expect(() => assertNotAllFailed(50, 50)).toThrow(/todas as 50 cidades/)
  })

  it('falha parcial é tolerada (uma prefeitura fora do ar não derruba o run)', () => {
    expect(() => assertNotAllFailed(1, 50)).not.toThrow()
    expect(() => assertNotAllFailed(49, 50)).not.toThrow()
  })

  it('nenhuma falha ou nenhuma cidade: não lança', () => {
    expect(() => assertNotAllFailed(0, 50)).not.toThrow()
    expect(() => assertNotAllFailed(0, 0)).not.toThrow()
  })
})
