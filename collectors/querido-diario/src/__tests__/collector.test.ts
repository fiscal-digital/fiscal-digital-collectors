// Mock do engine antes do import: collector.ts resolve GAZETTES_QUEUE_URL via
// requireEnv no load do módulo (mesmo pattern de supplier/persist.test.ts).
jest.mock('@fiscal-digital/engine', () => ({
  ...jest.requireActual('@fiscal-digital/engine'),
  requireEnv: (k: string) => process.env[k] ?? 'https://sqs.test/queue',
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}))

import { LOOKBACK_DAYS, sinceWithLookback } from '../collector'

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
