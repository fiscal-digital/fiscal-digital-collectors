/**
 * loadCguApiKey — chave da CGU lida do SSM Parameter Store (SecureString).
 * Contrato: valor cru ou JSON { api_key }; qualquer falha degrada para null.
 */

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  GetParameterCommand: jest.fn().mockImplementation((input: unknown) => input),
}))

import { loadCguApiKey, _resetCacheForTests } from '../secret'

const NAME = '/fiscal-digital/prod/cgu'

beforeEach(() => {
  _resetCacheForTests()
  mockSend.mockReset()
  process.env.CGU_PARAM_NAME = NAME
})
afterAll(() => {
  delete process.env.CGU_PARAM_NAME
})

test('sem CGU_PARAM_NAME devolve null sem chamar o SSM', async () => {
  delete process.env.CGU_PARAM_NAME
  await expect(loadCguApiKey()).resolves.toBeNull()
  expect(mockSend).not.toHaveBeenCalled()
})

test('pede o parametro com WithDecryption', async () => {
  mockSend.mockResolvedValue({ Parameter: { Value: 'chave' } })
  await loadCguApiKey()
  expect(mockSend).toHaveBeenCalledWith({ Name: NAME, WithDecryption: true })
})

test('valor cru e JSON { api_key }', async () => {
  mockSend.mockResolvedValue({ Parameter: { Value: 'chave-crua' } })
  await expect(loadCguApiKey()).resolves.toBe('chave-crua')

  _resetCacheForTests()
  mockSend.mockResolvedValue({ Parameter: { Value: '{"api_key":"chave-json"}' } })
  await expect(loadCguApiKey()).resolves.toBe('chave-json')
})

test('parametro vazio, sem api_key ou erro do SDK degradam para null', async () => {
  mockSend.mockResolvedValue({ Parameter: {} })
  await expect(loadCguApiKey()).resolves.toBeNull()

  _resetCacheForTests()
  mockSend.mockResolvedValue({ Parameter: { Value: '{"outra":"x"}' } })
  await expect(loadCguApiKey()).resolves.toBeNull()

  _resetCacheForTests()
  mockSend.mockRejectedValue(new Error('AccessDeniedException'))
  await expect(loadCguApiKey()).resolves.toBeNull()
})

test('carrega uma vez por container', async () => {
  mockSend.mockResolvedValue({ Parameter: { Value: 'chave' } })
  await loadCguApiKey()
  await loadCguApiKey()
  expect(mockSend).toHaveBeenCalledTimes(1)
})
