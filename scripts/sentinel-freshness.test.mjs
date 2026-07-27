// Testes da lógica pura da sentinela (node:test — roda no gate via npm test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseGazettePk, parseBackfillPk, daysBetween, computeFreshness, planActions,
  renderCityIssue, renderAggregate, STALE_DAYS, MAX_CREATES_PER_RUN,
} from './sentinel-freshness.mjs'

const HOJE = '2026-07-27'

test('parseGazettePk extrai cidade e data; rejeita o resto', () => {
  assert.deepEqual(
    parseGazettePk('GAZETTE#4305108#2025-05-27#b5293cdd97542ad21ee586e1adc36f7a'),
    { cityId: '4305108', date: '2025-05-27' },
  )
  assert.equal(parseGazettePk('BACKFILL#4305108'), null)
  assert.equal(parseGazettePk('GAZETTE#semdata'), null)
  assert.equal(parseGazettePk(undefined), null)
})

test('parseBackfillPk', () => {
  assert.equal(parseBackfillPk('BACKFILL#4314902'), '4314902')
  assert.equal(parseBackfillPk('BACKFILL#4314902#x'), null)
})

test('daysBetween atravessa ano', () => {
  assert.equal(daysBetween('2025-12-15', '2026-07-27'), 224)
})

test('computeFreshness: máximo real por cidade, buckets e sem-dados', () => {
  const rows = computeFreshness([
    'GAZETTE#4305108#2025-12-15#aaa', // 224d → critico-180
    'GAZETTE#4305108#2025-10-01#bbb', // ignorada (não é o máximo)
    'GAZETTE#4314902#2026-07-20#ccc', // 7d → ok
    'GAZETTE#3550308#2026-04-01#ddd', // 117d → estagnada-90
    'GAZETTE#2611606#2026-06-10#eee', // 47d → atencao-30
    'BACKFILL#1501402',               // configurada sem gazette → sem-dados
    'BACKFILL#4305108',
  ], HOJE)
  const by = Object.fromEntries(rows.map((r) => [r.cityId, r]))
  assert.equal(by['4305108'].bucket, 'critico-180')
  assert.equal(by['4305108'].lastReal, '2025-12-15')
  assert.equal(by['4314902'].bucket, 'ok')
  assert.equal(by['3550308'].bucket, 'estagnada-90')
  assert.equal(by['2611606'].bucket, 'atencao-30')
  assert.equal(by['1501402'].bucket, 'sem-dados')
  assert.equal(by['1501402'].gapDays, null)
  // universo = união configuradas + observadas, ordenado
  assert.deepEqual(rows.map((r) => r.cityId), ['1501402', '2611606', '3550308', '4305108', '4314902'])
})

test('planActions: primeira execução vira retrato agregado, nunca N issues', () => {
  const rows = computeFreshness(
    Array.from({ length: 12 }, (_, i) => `GAZETTE#${1000 + i}#2025-01-01#h`), HOJE)
  const plan = planActions(rows, [])
  assert.equal(plan.aggregate, true)
  assert.equal(plan.toCreate.length, 0)
})

test('planActions: cap anti-spam e dedup por issue aberta', () => {
  const rows = computeFreshness([
    ...Array.from({ length: 8 }, (_, i) => `GAZETTE#${2000 + i}#2025-01-01#h`),
    'GAZETTE#4314902#2026-07-25#h',
  ], HOJE)
  // “já existe issue” para 2000 → não recria; 7 restantes, cap corta em 5
  const open = [{ number: 10, title: '[sentinela] 2000 sem gazette há 500 dias' }]
  const plan = planActions(rows, open)
  assert.equal(plan.aggregate, false)
  assert.equal(plan.toCreate.length, MAX_CREATES_PER_RUN)
  assert.equal(plan.skippedByCap, 2)
  assert.ok(!plan.toCreate.some((r) => r.cityId === '2000'))
})

test('planActions: recuperação fecha a issue da cidade', () => {
  const rows = computeFreshness(['GAZETTE#4305108#2026-07-26#h'], HOJE) // 1d → ok
  const open = [{ number: 33, title: '[sentinela] 4305108 sem gazette há 224 dias' }]
  const plan = planActions(rows, open)
  assert.deepEqual(plan.toClose.map((r) => [r.cityId, r.issueNumber]), [['4305108', 33]])
})

test('renderizações carregam os números medidos', () => {
  const [r] = computeFreshness(['GAZETTE#4305108#2025-12-15#h'], HOJE)
  const issue = renderCityIssue(r, HOJE)
  assert.match(issue.title, /^\[sentinela\] 4305108 sem gazette há 224 dias$/)
  assert.match(issue.body, /2025-12-15/)

  const agg = renderAggregate(computeFreshness([
    'GAZETTE#1#2025-01-01#h', 'GAZETTE#2#2026-07-26#h', 'BACKFILL#3',
  ], HOJE), HOJE)
  assert.match(agg.title, /2 cidades estagnadas/)
  assert.match(agg.body, /sem-dados/)
})

test('limiar exportado coerente com a doc (90 dias)', () => {
  assert.equal(STALE_DAYS, 90)
})
