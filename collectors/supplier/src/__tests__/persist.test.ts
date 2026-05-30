// Mock @fiscal-digital/engine antes de importar persist
jest.mock('@fiscal-digital/engine', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
  requireEnv: (k: string) => process.env[k] ?? '',
}))

const mockDdbSend = jest.fn()

// Mock do DocumentClient: intercepta `.send(cmd)`.
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: mockDdbSend }),
  },
  // Comandos passam o input direto (introspectável no .mock.calls).
  UpdateCommand: jest.fn().mockImplementation((input: unknown) => ({ input, _ctor: 'UpdateCommand' })),
}))

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}))

import { upsertProfile, type SupplierProfile } from '../persist'

function lastUpdateInput(): any {
  const cmd = mockDdbSend.mock.calls[mockDdbSend.mock.calls.length - 1][0]
  expect(cmd._ctor).toBe('UpdateCommand')
  return cmd.input
}

describe('persist.upsertProfile', () => {
  beforeEach(() => {
    mockDdbSend.mockReset()
    mockDdbSend.mockResolvedValue({})
  })

  it('escreve PROFILE com pk = SUPPLIER#{cnpj14} e sk = PROFILE', async () => {
    const profile: SupplierProfile = {
      razaoSocial: 'EMPRESA TESTE LTDA',
      situacaoCadastral: 'ativa',
      dataAbertura: '2020-01-15',
      socios: ['JOAO DA SILVA'],
      rfbStatus: 'ok',
      rfbCapturedAt: '2026-05-24T00:00:00Z',
      cguEnabled: false,
    }

    const result = await upsertProfile('12.345.678/0001-90', profile)

    expect(result.pk).toBe('SUPPLIER#12345678000190')
    expect(result.sk).toBe('PROFILE')

    const input = lastUpdateInput()
    expect(input.TableName).toBe('fiscal-digital-suppliers-prod')
    expect(input.Key).toEqual({ pk: 'SUPPLIER#12345678000190', sk: 'PROFILE' })
    expect(input.UpdateExpression).toContain('SET ')
    expect(input.UpdateExpression).toContain('#lastLookupAt = :lastLookupAt')
    expect(input.ExpressionAttributeNames['#razaoSocial']).toBe('razaoSocial')
    expect(input.ExpressionAttributeValues[':razaoSocial']).toBe('EMPRESA TESTE LTDA')
  })

  it('omite campos undefined do UpdateExpression (não sobrescreve dados anteriores)', async () => {
    const profile: SupplierProfile = {
      rfbStatus: 'erro',
      cguEnabled: false,
      lastError: 'BrasilAPI 503',
    }

    await upsertProfile('99999999000199', profile)

    const input = lastUpdateInput()
    expect(input.ExpressionAttributeNames['#razaoSocial']).toBeUndefined()
    expect(input.ExpressionAttributeNames['#situacaoCadastral']).toBeUndefined()
    expect(input.ExpressionAttributeNames['#rfbStatus']).toBe('rfbStatus')
    expect(input.ExpressionAttributeNames['#lastError']).toBe('lastError')
    expect(input.ExpressionAttributeNames['#cguEnabled']).toBe('cguEnabled')
  })

  it('sempre seta lastLookupAt = now (idempotência observável)', async () => {
    const before = new Date().toISOString()
    await upsertProfile('11111111000111', { rfbStatus: 'ok', cguEnabled: true })
    const after = new Date().toISOString()

    const input = lastUpdateInput()
    const lastLookupAt = String(input.ExpressionAttributeValues[':lastLookupAt'])
    expect(lastLookupAt >= before).toBe(true)
    expect(lastLookupAt <= after).toBe(true)
  })

  it('sanitiza CNPJ com máscara — pk usa 14 dígitos', async () => {
    const result = await upsertProfile('00.000.000/0000-00', { rfbStatus: 'ok', cguEnabled: false })
    expect(result.pk).toBe('SUPPLIER#00000000000000')
  })

  it('persiste sancoes como array (CEIS + CNEP)', async () => {
    const profile: SupplierProfile = {
      rfbStatus: 'ok',
      cguEnabled: true,
      sancoes: [
        { type: 'CEIS', sanction: 'Inidoneidade', organ: 'CGU' },
        { type: 'CNEP', sanction: 'Multa', startDate: '2023-01-01' },
      ],
      cguCapturedAt: '2026-05-24T00:00:00Z',
    }
    await upsertProfile('22222222000122', profile)

    const input = lastUpdateInput()
    expect(input.ExpressionAttributeValues[':sancoes']).toHaveLength(2)
    expect(input.ExpressionAttributeValues[':sancoes'][0].type).toBe('CEIS')
  })

  it('idempotente — múltiplas chamadas mesma key fazem N UpdateCommands', async () => {
    await upsertProfile('33333333000133', { rfbStatus: 'ok', cguEnabled: false })
    await upsertProfile('33333333000133', { rfbStatus: 'ok', cguEnabled: false })
    expect(mockDdbSend).toHaveBeenCalledTimes(2)
    // Mesmo pk/sk — chamadas SET são naturalmente idempotentes (last-write-wins).
    const first = mockDdbSend.mock.calls[0][0].input
    const second = mockDdbSend.mock.calls[1][0].input
    expect(first.Key).toEqual(second.Key)
  })
})
