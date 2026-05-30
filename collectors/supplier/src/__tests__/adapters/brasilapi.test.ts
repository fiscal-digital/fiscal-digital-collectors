jest.mock('@fiscal-digital/engine', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}))

import { fetchCnpjProfile, situacaoLabel } from '../../adapters/brasilapi'

// NODE_ENV=test desliga throttle (ver adapter).
process.env.NODE_ENV = 'test'

const realFetch = global.fetch

afterAll(() => {
  global.fetch = realFetch
})

function mockResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: status === 404 ? 'Not Found' : status === 200 ? 'OK' : 'Error',
    json: async () => body,
  } as unknown as Response
}

describe('adapter brasilapi', () => {
  describe('situacaoLabel', () => {
    it('mapeia códigos conhecidos', () => {
      expect(situacaoLabel(1)).toBe('nula')
      expect(situacaoLabel(2)).toBe('ativa')
      expect(situacaoLabel(3)).toBe('suspensa')
      expect(situacaoLabel(4)).toBe('inapta')
      expect(situacaoLabel(8)).toBe('baixada')
    })
    it('cai pra "desconhecida" em código novo', () => {
      expect(situacaoLabel(99)).toBe('desconhecida')
    })
  })

  describe('fetchCnpjProfile', () => {
    it('retorna ok quando BrasilAPI responde 200', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        mockResponse(200, {
          cnpj: '12345678000190',
          razao_social: 'ACME LTDA',
          situacao_cadastral: 2,
          data_inicio_atividade: '2020-01-15',
          qsa: [{ nome_socio: 'JOAO' }, { nome_socio: 'MARIA' }],
        }),
      ) as unknown as typeof fetch

      const result = await fetchCnpjProfile('12.345.678/0001-90')
      expect(result.status).toBe('ok')
      expect(result.data?.razao_social).toBe('ACME LTDA')
      expect(result.source).toBe('https://brasilapi.com.br/api/cnpj/v1/12345678000190')
    })

    it('retorna nao_encontrado em 404', async () => {
      global.fetch = jest.fn().mockResolvedValue(mockResponse(404, {})) as unknown as typeof fetch

      const result = await fetchCnpjProfile('99999999000199')
      expect(result.status).toBe('nao_encontrado')
      expect(result.data).toBeUndefined()
    })

    it('retorna erro em 5xx (sem throw)', async () => {
      global.fetch = jest.fn().mockResolvedValue(mockResponse(503, {})) as unknown as typeof fetch

      const result = await fetchCnpjProfile('11111111000111')
      expect(result.status).toBe('erro')
      expect(result.error).toContain('503')
    })

    it('retorna erro em timeout/network (sem throw)', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch

      const result = await fetchCnpjProfile('22222222000122')
      expect(result.status).toBe('erro')
      expect(result.error).toBe('ECONNRESET')
    })

    it('sanitiza CNPJ com máscara na URL', async () => {
      const fetchMock = jest.fn().mockResolvedValue(mockResponse(404, {}))
      global.fetch = fetchMock as unknown as typeof fetch

      await fetchCnpjProfile('12.345.678/0001-90')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://brasilapi.com.br/api/cnpj/v1/12345678000190',
        expect.objectContaining({ headers: expect.any(Object) }),
      )
    })
  })
})
