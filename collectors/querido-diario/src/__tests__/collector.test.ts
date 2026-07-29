// Mock do engine antes do import: collector.ts resolve GAZETTES_QUEUE_URL via
// requireEnv no load do módulo (mesmo pattern de supplier/persist.test.ts).
jest.mock('@fiscal-digital/engine', () => ({
  ...jest.requireActual('@fiscal-digital/engine'),
  requireEnv: (k: string) => process.env[k] ?? 'https://sqs.test/queue',
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}))

import { LOOKBACK_DAYS, sinceWithLookback, nextWatermark } from '../collector'

describe('sinceWithLookback', () => {
  it('volta LOOKBACK_DAYS a partir do watermark', () => {
    expect(sinceWithLookback('2026-07-17')).toBe('2026-07-03')
  })

  it('atravessa viradas de mês e ano', () => {
    expect(sinceWithLookback('2026-01-05')).toBe('2025-12-22')
  })

  it('atravessa ano bissexto', () => {
    expect(sinceWithLookback('2028-03-07')).toBe('2028-02-22')
  })

  it('aceita lookback customizado', () => {
    expect(sinceWithLookback('2026-07-17', 0)).toBe('2026-07-17')
    expect(sinceWithLookback('2026-07-17', 30)).toBe('2026-06-17')
  })

  it('default exportado é 14 dias', () => {
    expect(LOOKBACK_DAYS).toBe(14)
  })
})

// collectors#21 — watermark veraz: lastDate = data real persistida, nunca o run.
// Regressão do bug em que lastDate=until incondicional fazia 41/50 cidades
// divergirem do dado real (e o /cities exibiria "atualizada" para cidade parada).
describe('nextWatermark', () => {
  it('run sem persistência: mantém o anterior (não avança para a data do run)', () => {
    expect(nextWatermark('2025-12-15', null)).toBe('2025-12-15')
  })

  it('run sem persistência e sem watermark anterior: continua sem watermark', () => {
    expect(nextWatermark(null, null)).toBeNull()
  })

  it('primeira persistência define o watermark pela data real da gazette', () => {
    expect(nextWatermark(null, '2026-07-25')).toBe('2026-07-25')
  })

  it('avança pela data real persistida', () => {
    expect(nextWatermark('2026-07-20', '2026-07-28')).toBe('2026-07-28')
  })

  it('NUNCA regride: gazette antiga capturada pelo lookback não puxa para trás', () => {
    expect(nextWatermark('2026-07-25', '2026-07-14')).toBe('2026-07-25')
  })
})
