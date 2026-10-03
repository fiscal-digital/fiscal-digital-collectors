// Regressão do apagão silencioso de 2026-08/09: com todas as cidades falhando
// (host do QD migrado), o handler retornava OK e nenhum alarme de Errors
// disparou. Todas falharam ⇒ o run precisa terminar em erro.
jest.mock('@fiscal-digital/engine', () => ({
  ...jest.requireActual('@fiscal-digital/engine'),
  requireEnv: (k: string) => process.env[k] ?? 'https://sqs.test/queue',
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}))

import { assertNotAllFailed, summarizeRun } from '../index'

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

// Regressão: o log "cidade falhou" não dizia QUAL cidade. Em 01/10/2026 foram
// 92 linhas de falha sem nenhum territory_id.
describe('summarizeRun', () => {
  const cidades = [
    { territory_id: '4305108', name: 'Caxias do Sul' },
    { territory_id: '4314902', name: 'Porto Alegre' },
    { territory_id: '3550308', name: 'São Paulo' },
  ]
  const ok = (sent: number, raw: number) =>
    ({ status: 'fulfilled', value: { processed: sent, sent, rawTxtCached: raw } }) as const

  it('cada falha carrega territory_id, nome e motivo da cidade certa', () => {
    const r = summarizeRun(cidades, [
      ok(2, 2),
      { status: 'rejected', reason: new Error('Querido Diário API 503: Service Unavailable') },
      ok(0, 0),
    ])
    expect(r.falhas).toEqual([
      { territory_id: '4314902', name: 'Porto Alegre', motivo: 'Querido Diário API 503: Service Unavailable' },
    ])
    expect(r.cidades.map(c => c.territory_id)).toEqual(['4305108', '3550308'])
  })

  it('soma sent e rawTxtCached só das cidades que deram certo', () => {
    const r = summarizeRun(cidades, [ok(3, 1), ok(4, 4), { status: 'rejected', reason: 'timeout' }])
    expect(r.sent).toBe(7)
    expect(r.rawTxtCached).toBe(5)
    expect(r.falhas[0]).toEqual({ territory_id: '3550308', name: 'São Paulo', motivo: 'timeout' })
  })
})
