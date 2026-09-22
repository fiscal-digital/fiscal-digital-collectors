// Mock do engine antes do import: collector.ts resolve GAZETTES_QUEUE_URL via
// requireEnv no load do módulo (mesmo pattern de supplier/persist.test.ts).
jest.mock('@fiscal-digital/engine', () => ({
  ...jest.requireActual('@fiscal-digital/engine'),
  requireEnv: (k: string) => process.env[k] ?? 'https://sqs.test/queue',
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  // Sem espera real: o limitador de 60/min espaçaria cada chamada em 1 s.
  RateLimiter: jest.fn().mockImplementation(() => ({ acquire: jest.fn().mockResolvedValue(undefined) })),
}))

// S3: só o `send` do client é falso; os Commands são os reais (instanceof funciona).
const mockS3Send = jest.fn()
jest.mock('@aws-sdk/client-s3', () => ({
  ...jest.requireActual('@aws-sdk/client-s3'),
  S3Client: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockS3Send(...args) })),
}))

import crypto from 'node:crypto'
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { gazetteKey, USER_AGENT } from '@fiscal-digital/engine'
import type { Gazette } from '@fiscal-digital/engine'
import { LOOKBACK_DAYS, sinceWithLookback, nextWatermark, cityIdFromGazetteKey, buildCollectorMessage, rawTxtKey, cacheRawTxt } from '../collector'

const mockFetch = jest.fn()
global.fetch = mockFetch

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

describe('cityIdFromGazetteKey', () => {
  // Alimenta o counter `AGG#GAZETTE_COUNT#{cityId}` que a API lê em
  // /cities/{cityId}/stats. Precisa casar EXATAMENTE com o universo que o
  // Scan antigo contava (`begins_with(pk, 'GAZETTE#{cityId}#')`), senão o
  // counter e o fallback de Scan passam a divergir em silêncio.
  it('extrai o territory_id de chave do Querido Diario', () => {
    expect(cityIdFromGazetteKey('4305108#2026-03-15#a1b2c3')).toBe('4305108')
    expect(cityIdFromGazetteKey('3550308#2021-01-04#deadbeef')).toBe('3550308')
  })

  it('retorna null para chave URLHASH — nao pertence a cidade nenhuma', () => {
    // Sem isso criariamos um counter fantasma com pk AGG#GAZETTE_COUNT#URLHASH,
    // e as gazettes nao-QD seriam contadas numa "cidade" inexistente.
    expect(cityIdFromGazetteKey('URLHASH#0123456789abcdef0123456789abcdef')).toBeNull()
  })

  it('retorna null quando o primeiro segmento nao e numerico', () => {
    expect(cityIdFromGazetteKey('caxias#2026-03-15#a1b2')).toBeNull()
    expect(cityIdFromGazetteKey('')).toBeNull()
  })
})

describe('buildCollectorMessage', () => {
  const gazette = {
    id: 'g-1', territory_id: '4305108', date: '2026-08-01',
    url: 'https://data.qd.org/4305108/2026-08-01/abc.pdf',
    excerpts: ['dispensa de licitação nº 42'],
  }
  const entities = { cnpjs: [], values: [], dates: [], contractNumbers: [] }

  it('com JSON garantido no S3, envia SO o ponteiro — nunca os dois', () => {
    const msg = buildCollectorMessage(gazette, entities, 'excerpts/4305108/2026-08-01/abc.json')
    expect(msg.excerptsS3Key).toBe('excerpts/4305108/2026-08-01/abc.json')
    // REGRESSÃO: inline junto com ponteiro reintroduziria o limite de 256 KB
    // que a Fase 0 elimina.
    expect(msg).not.toHaveProperty('excerpts')
  })

  it('sem garantia do S3 (null), cai para excerpts inline', () => {
    const msg = buildCollectorMessage(gazette, entities, null)
    expect(msg.excerpts).toEqual(['dispensa de licitação nº 42'])
    expect(msg).not.toHaveProperty('excerptsS3Key')
  })
})

// ── Camada raw (#166): texto integral do diário ─────────────────────────────

const PDF_URL = 'https://data.queridodiario.ok.org.br/4305108/2026-03-15/abc123.pdf'
const TXT_URL = 'https://data.queridodiario.ok.org.br/4305108/2026-03-15/abc123.txt'

function makeGazette(override: Partial<Gazette> = {}): Gazette {
  return {
    id: '4305108#2026-03-15#1',
    territory_id: '4305108',
    date: '2026-03-15',
    url: PDF_URL,
    excerpts: ['Dispensa de licitação'],
    txt_url: TXT_URL,
    ...override,
  }
}

function s3NotFound(): void {
  mockS3Send.mockImplementation((cmd: unknown) =>
    cmd instanceof HeadObjectCommand ? Promise.reject(new Error('NotFound')) : Promise.resolve({}),
  )
}

function putCalls(): PutObjectCommand[] {
  return mockS3Send.mock.calls.map(c => c[0]).filter((c): c is PutObjectCommand => c instanceof PutObjectCommand)
}

describe('rawTxtKey', () => {
  it('deriva raw/txt/{tid}/{date}/{qdhash}.txt só da gazette — sem manifesto', () => {
    const hash = gazetteKey(PDF_URL)?.split('#').pop()
    expect(hash).toBeTruthy()
    expect(rawTxtKey(makeGazette())).toBe(`raw/txt/4305108/2026-03-15/${hash}.txt`)
  })

  it('url inválida: null', () => {
    expect(rawTxtKey(makeGazette({ url: 'nao-e-url' }))).toBeNull()
  })
})

describe('cacheRawTxt', () => {
  beforeEach(() => {
    mockS3Send.mockReset()
    mockFetch.mockReset()
  })

  it('sem txt_url: não busca nada nem toca no S3', async () => {
    const ok = await cacheRawTxt(makeGazette({ txt_url: undefined }))
    expect(ok).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockS3Send).not.toHaveBeenCalled()
  })

  it('já arquivado (HEAD ok): idempotente — sem fetch, sem PutObject', async () => {
    mockS3Send.mockResolvedValue({})
    const ok = await cacheRawTxt(makeGazette())
    expect(ok).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(putCalls()).toHaveLength(0)
  })

  it('novo: busca txt_url com o User-Agent da engine e grava na chave derivada, com sha256 e origem nos metadados', async () => {
    s3NotFound()
    const text = 'PREFEITURA MUNICIPAL DE CAXIAS DO SUL\nDispensa de licitação nº 12/2026 ...'
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => text })

    const ok = await cacheRawTxt(makeGazette())

    expect(ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toBe(TXT_URL)
    expect(mockFetch.mock.calls[0][1]?.headers?.['User-Agent']).toBe(USER_AGENT)

    const puts = putCalls()
    expect(puts).toHaveLength(1)
    const input = puts[0].input
    expect(input.Key).toBe(rawTxtKey(makeGazette()))
    expect(input.ContentType).toBe('text/plain; charset=utf-8')
    expect(Buffer.from(input.Body as Uint8Array).toString('utf-8')).toBe(text)
    expect(input.Metadata).toMatchObject({
      sha256: crypto.createHash('sha256').update(text, 'utf-8').digest('hex'),
      'source-url': TXT_URL,
      'pdf-url': PDF_URL,
      'territory-id': '4305108',
      date: '2026-03-15',
      chars: String(text.length),
    })
  })

  it('fonte responde erro: não grava e não lança (falha não-crítica)', async () => {
    s3NotFound()
    mockFetch.mockResolvedValue({ ok: false, status: 503, text: async () => '' })
    await expect(cacheRawTxt(makeGazette())).resolves.toBe(false)
    expect(putCalls()).toHaveLength(0)
  })

  it('texto vazio: não grava', async () => {
    s3NotFound()
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '   \n' })
    await expect(cacheRawTxt(makeGazette())).resolves.toBe(false)
    expect(putCalls()).toHaveLength(0)
  })

  it('S3 falha no PUT: não lança (warn e segue)', async () => {
    mockS3Send.mockImplementation((cmd: unknown) =>
      cmd instanceof HeadObjectCommand ? Promise.reject(new Error('NotFound')) : Promise.reject(new Error('AccessDenied')),
    )
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'texto' })
    await expect(cacheRawTxt(makeGazette())).resolves.toBe(false)
  })
})
