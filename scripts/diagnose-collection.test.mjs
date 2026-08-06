// Testes da lógica pura do diagnóstico (node:test — roda no plan.yml).
//
// O que está protegido aqui é a CLASSIFICAÇÃO. Ela decide se uma cidade
// estagnada vira trabalho de engenharia ou não; classificar errado manda a
// gente investigar collector quando o problema é a fonte ter secado — foi
// exatamente o que quase aconteceu com as 26 issues do sentinela.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, isNosso, proximoDia, diasEntre, resumir } from './diagnose-collection.mjs'

const base = { qdTotal: 5000, qdRecentes: 60, naoColetado: 0, watermark: '2026-08-01' }

test('EM_DIA: fonte viva e nada pendente', () => {
  assert.equal(classify(base), 'EM_DIA')
})

test('NOS_ESTAMOS_ATRASADOS: o QD tem gazette depois do nosso watermark', () => {
  assert.equal(classify({ ...base, naoColetado: 40 }), 'NOS_ESTAMOS_ATRASADOS')
  assert.equal(isNosso('NOS_ESTAMOS_ATRASADOS'), true)
})

test('FONTE_PAROU_DE_PUBLICAR: QD tem histórico mas nada recente', () => {
  // Caxias do Sul em 2026-08-06: 5.861 gazettes no QD, zero em 2026 inteiro.
  const caxias = { qdTotal: 5861, qdRecentes: 0, naoColetado: 0, watermark: '2025-12-15' }
  assert.equal(classify(caxias), 'FONTE_PAROU_DE_PUBLICAR')
  // NÃO é acionável por nós — o collector não tem o que buscar.
  assert.equal(isNosso(classify(caxias)), false)
})

test('A_FONTE_NAO_TEM_A_CIDADE vence FONTE_PAROU quando o total é zero', () => {
  // Fortaleza: o QD nunca indexou. Não adianta investigar coleta; a cidade
  // não deveria estar ativa em CITIES.
  const c = { qdTotal: 0, qdRecentes: 0, naoColetado: null, watermark: null }
  assert.equal(classify(c), 'A_FONTE_NAO_TEM_A_CIDADE')
  assert.equal(isNosso(classify(c)), false)
})

test('NUNCA_COLETAMOS: fonte tem dado, nós nunca gravamos watermark', () => {
  const c = { qdTotal: 1594, qdRecentes: 45, naoColetado: null, watermark: null }
  assert.equal(classify(c), 'NUNCA_COLETAMOS')
  // Esse SIM é nosso: a fonte tem o dado e nós não temos nada.
  assert.equal(isNosso(classify(c)), true)
})

test('REGRESSÃO: falha de API não pode virar diagnóstico de fonte morta', () => {
  // A v1 deste script estourava o rate limit do QD e lia os HTTP 500 como
  // "fonte indisponível" — 41 de 50 cidades classificadas erradas. null tem
  // que ser ERRO_API, nunca uma causa substantiva.
  assert.equal(classify({ ...base, qdTotal: null }), 'ERRO_API')
  assert.equal(classify({ ...base, qdRecentes: null }), 'ERRO_API')
  assert.equal(classify({ ...base, naoColetado: null }), 'ERRO_API')
  assert.equal(isNosso('ERRO_API'), false)
})

test('cidade sem watermark nunca é classificada como fonte parada', () => {
  // Sem watermark não há como afirmar que estamos atrasados nem que a fonte
  // parou em relação a nós — a pergunta certa é outra.
  const c = { qdTotal: 100, qdRecentes: 0, naoColetado: null, watermark: null }
  assert.equal(classify(c), 'NUNCA_COLETAMOS')
})

test('proximoDia respeita virada de mês e ano (published_since é inclusivo)', () => {
  assert.equal(proximoDia('2026-08-01'), '2026-08-02')
  assert.equal(proximoDia('2026-01-31'), '2026-02-01')
  assert.equal(proximoDia('2025-12-31'), '2026-01-01')
  assert.equal(proximoDia('2024-02-28'), '2024-02-29') // bissexto
})

test('diasEntre mede a estagnação', () => {
  assert.equal(diasEntre('2025-12-15', '2026-08-06'), 234)
  assert.equal(diasEntre('2026-08-06', '2026-08-06'), 0)
})

test('resumir agrupa por causa', () => {
  const r = resumir([
    { causa: 'EM_DIA' }, { causa: 'EM_DIA' }, { causa: 'FONTE_PAROU_DE_PUBLICAR' },
  ])
  assert.equal(r.EM_DIA.length, 2)
  assert.equal(r.FONTE_PAROU_DE_PUBLICAR.length, 1)
})
