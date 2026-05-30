jest.mock('@fiscal-digital/engine', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}))

import { fetchSanctions } from '../../adapters/cgu-portal-transparencia'

process.env.NODE_ENV = 'test'

const realFetch = global.fetch

afterAll(() => {
  global.fetch = realFetch
})

function ok(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as unknown as Response
}

function notOk(status: number): Response {
  return {
    ok: false,
    status,
    statusText: 'Error',
    json: async () => [],
  } as unknown as Response
}

describe('adapter cgu-portal-transparencia', () => {
  it('combina CEIS + CNEP em sancoes[]', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        ok([{ tipoSancao: 'Inidoneidade', dataInicioSancao: '2024-01-01', orgaoSancionador: 'CGU' }]),
      )
      .mockResolvedValueOnce(ok([{ tipoSancao: 'Multa', dataInicioSancao: '2023-06-01' }])) as unknown as typeof fetch

    const result = await fetchSanctions('12345678000190', 'fake-key')
    expect(result.sancoes).toHaveLength(2)
    expect(result.sancoes[0].type).toBe('CEIS')
    expect(result.sancoes[0].sanction).toBe('Inidoneidade')
    expect(result.sancoes[1].type).toBe('CNEP')
    expect(result.sancoes[1].sanction).toBe('Multa')
  })

  it('retorna [] quando ambas endpoints respondem com array vazio', async () => {
    global.fetch = jest.fn().mockResolvedValue(ok([])) as unknown as typeof fetch
    const result = await fetchSanctions('99999999000199', 'fake-key')
    expect(result.sancoes).toEqual([])
  })

  it('passa chave-api-dados no header', async () => {
    const fetchMock = jest.fn().mockResolvedValue(ok([]))
    global.fetch = fetchMock as unknown as typeof fetch
    await fetchSanctions('11111111000111', 'minha-chave-secreta')

    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers['chave-api-dados']).toBe('minha-chave-secreta')
    expect(headers['Accept']).toBe('application/json')
  })

  it('graceful — se CEIS falha mas CNEP responde, retorna só CNEP', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(notOk(503))
      .mockResolvedValueOnce(ok([{ tipoSancao: 'Multa' }])) as unknown as typeof fetch

    const result = await fetchSanctions('22222222000122', 'fake-key')
    expect(result.sancoes).toHaveLength(1)
    expect(result.sancoes[0].type).toBe('CNEP')
  })

  it('graceful — se ambas falham, retorna []', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch
    const result = await fetchSanctions('33333333000133', 'fake-key')
    expect(result.sancoes).toEqual([])
  })

  it('source URL contém ambos endpoints (CEIS + CNEP)', async () => {
    global.fetch = jest.fn().mockResolvedValue(ok([])) as unknown as typeof fetch
    const result = await fetchSanctions('44444444000144', 'k')
    expect(result.source).toContain('/ceis')
    expect(result.source).toContain('/cnep')
  })
})
