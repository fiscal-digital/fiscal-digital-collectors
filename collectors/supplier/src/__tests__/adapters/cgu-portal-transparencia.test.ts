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
        ok([{ sancionado: { codigoFormatado: '12.345.678/0001-90' }, tipoSancao: 'Inidoneidade', dataInicioSancao: '2024-01-01', orgaoSancionador: 'CGU' }]),
      )
      .mockResolvedValueOnce(ok([{ sancionado: { codigoFormatado: '12.345.678/0001-90' }, tipoSancao: 'Multa', dataInicioSancao: '2023-06-01' }])) as unknown as typeof fetch

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
      .mockResolvedValueOnce(ok([{ sancionado: { codigoFormatado: '22.222.222/0001-22' }, tipoSancao: 'Multa' }])) as unknown as typeof fetch

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

  // Regressão fiscal-digital#243: a API ignorava `cnpjSancionado` e devolvia a
  // primeira página do cadastro inteiro. 108 PROFILEs em prod ficaram com 30
  // sanções de terceiros cada.
  it('#243: usa codigoSancionado na URL', async () => {
    const fetchMock = jest.fn().mockResolvedValue(ok([]))
    global.fetch = fetchMock as unknown as typeof fetch
    await fetchSanctions('12.345.678/0001-90', 'k')
    expect(String(fetchMock.mock.calls[0][0])).toContain('/ceis?codigoSancionado=12345678000190&')
    expect(String(fetchMock.mock.calls[1][0])).toContain('/cnep?codigoSancionado=12345678000190&')
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('cnpjSancionado')
  })

  it('#243: registros de OUTRO sancionado são descartados, mesmo que a API os devolva', async () => {
    const pagina = [
      { sancionado: { nome: 'ELZA', codigoFormatado: '974.243.236-87' }, tipoSancao: { descricaoResumida: 'Improbidade' } },
      { sancionado: { nome: 'OUTRA LTDA', codigoFormatado: '72.810.211/0001-09' }, tipoSancao: { descricaoResumida: 'Impedimento' } },
      { tipoSancao: 'Sem sancionado no registro' },
    ]
    global.fetch = jest.fn().mockResolvedValue(ok(pagina)) as unknown as typeof fetch
    const result = await fetchSanctions('56.220.963/0001-55', 'k')
    expect(result.sancoes).toEqual([])
  })

  it('#243: registro do próprio CNPJ com tipoSancao/orgaoSancionador em objeto é normalizado para string', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(ok([{
        sancionado: { nome: 'EMPRESA X', codigoFormatado: '72.810.211/0001-09' },
        tipoSancao: { descricaoResumida: 'Impedimento/proibição de contratar com prazo determinado' },
        orgaoSancionador: { nome: 'PROCURADORIA GERAL DO ESTADO', siglaUf: 'SP' },
        dataInicioSancao: '10/04/2026',
        dataFimSancao: '10/04/2027',
      }]))
      .mockResolvedValueOnce(ok([])) as unknown as typeof fetch
    const result = await fetchSanctions('72810211000109', 'k')
    expect(result.sancoes).toEqual([{
      type: 'CEIS',
      sanction: 'Impedimento/proibição de contratar com prazo determinado',
      organ: 'PROCURADORIA GERAL DO ESTADO',
      startDate: '10/04/2026',
      endDate: '10/04/2027',
    }])
  })
})
