#!/usr/bin/env node
// fix-watermarks.mjs — migração ÚNICA dos watermarks BACKFILL# (collectors#21).
//
// O collector gravava lastDate=até-hoje incondicionalmente; este script corrige
// cada cidade para a data REAL máxima de GAZETTE# persistida:
//   - cidade com gazettes → SET lastDate = max real (se diferente)
//   - cidade sem NENHUMA gazette → REMOVE lastDate (o /cities passa a mostrar
//     "sem dados", que é a verdade; o backfill profundo dessas é decisão à parte)
//
// Rodar SOMENTE depois do collector corrigido estar deployado — senão o cron
// seguinte reescreve a mentira. Dry-run por padrão; `--apply` executa.
//
//   node scripts/fix-watermarks.mjs           # mostra o plano
//   node scripts/fix-watermarks.mjs --apply   # aplica os UpdateItem

import { execFileSync } from 'node:child_process'

const TABLE = process.env.GAZETTES_TABLE ?? 'fiscal-digital-gazettes-prod'
const REGION = process.env.AWS_REGION ?? 'us-east-1'

function aws(args, input) {
  return execFileSync('aws', [...args, '--region', REGION],
    { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 })
}

function scanWatermarksAndMax() {
  const out = JSON.parse(aws([
    'dynamodb', 'scan', '--table-name', TABLE,
    '--projection-expression', 'pk,lastDate',
    '--query', 'Items[].{pk:pk.S,lastDate:lastDate.S}', '--output', 'json',
  ]))
  const maxByCity = new Map()
  const watermarks = new Map()
  for (const { pk, lastDate } of out) {
    const g = /^GAZETTE#(\d+)#(\d{4}-\d{2}-\d{2})#/.exec(pk)
    if (g) {
      const cur = maxByCity.get(g[1])
      if (!cur || g[2] > cur) maxByCity.set(g[1], g[2])
      continue
    }
    const b = /^BACKFILL#(\d+)$/.exec(pk)
    if (b) watermarks.set(b[1], lastDate ?? null)
  }
  return { maxByCity, watermarks }
}

const apply = process.argv.includes('--apply')
const { maxByCity, watermarks } = scanWatermarksAndMax()

let sets = 0, removes = 0, oks = 0
const plano = []
for (const [cityId, atual] of [...watermarks.entries()].sort()) {
  const real = maxByCity.get(cityId) ?? null
  if (real === null) {
    if (atual === null) { oks++; continue }
    plano.push({ cityId, atual, acao: 'REMOVE lastDate (zero gazettes)' })
    removes++
    if (apply) {
      aws(['dynamodb', 'update-item', '--table-name', TABLE,
        '--key', JSON.stringify({ pk: { S: `BACKFILL#${cityId}` } }),
        '--update-expression', 'REMOVE lastDate'])
    }
  } else if (real !== atual) {
    plano.push({ cityId, atual, acao: `SET lastDate=${real}` })
    sets++
    if (apply) {
      aws(['dynamodb', 'update-item', '--table-name', TABLE,
        '--key', JSON.stringify({ pk: { S: `BACKFILL#${cityId}` } }),
        '--update-expression', 'SET lastDate = :d',
        '--expression-attribute-values', JSON.stringify({ ':d': { S: real } })])
    }
  } else {
    oks++
  }
}

console.table(plano)
console.log(`${watermarks.size} watermarks · ${sets} SET · ${removes} REMOVE · ${oks} já corretos`)
console.log(apply ? 'APLICADO.' : 'DRY-RUN — nada foi escrito. Use --apply após o deploy do collector corrigido.')
