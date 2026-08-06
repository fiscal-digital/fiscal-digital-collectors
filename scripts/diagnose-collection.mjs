#!/usr/bin/env node
// diagnose-collection.mjs — por que a coleta parou, cidade a cidade.
//
// O sentinela (sentinel-freshness.mjs) responde ONDE parou e abre uma issue por
// cidade. Chegamos a 26 issues abertas, o que sugeria 26 problemas de
// engenharia. Não era: em 2026-08-06 este diagnóstico mostrou que 24 das 50
// cidades estão bloqueadas NA FONTE, não em código nosso.
//
// A pergunta que o sentinela não faz é "o Querido Diário ainda tem essa
// cidade?". Sem ela, "cidade estagnada" é ambíguo entre três causas com
// tratamentos completamente diferentes:
//
//   NOS_ESTAMOS_ATRASADOS      o QD tem gazette depois do nosso watermark
//                              → é nosso: investigar collector/watermark
//   FONTE_PAROU_DE_PUBLICAR    o QD tem a cidade, mas nada nos últimos 90 dias
//                              → não é nosso: a prefeitura ou o scraper parou
//   A_FONTE_NAO_TEM_A_CIDADE   o QD nunca teve nada dessa cidade
//                              → a cidade não deveria estar ativa em CITIES
//
// Custo: 3 requisições ao QD por cidade (API pública, sem chave) + 1 GetItem.
// Zero LLM. Respeita o rate limit de 60 req/min do QD — ver RATE_LIMIT_MS.
//
// Uso:
//   node scripts/diagnose-collection.mjs
//   node scripts/diagnose-collection.mjs --json     # saída para pipeline
//   node scripts/diagnose-collection.mjs --city=4305108

import { execFileSync } from 'node:child_process'

const QD_API = 'https://api.queridodiario.ok.org.br'
const USER_AGENT = 'FiscalDigital/0.1.1 (+https://fiscaldigital.org)'
const TABLE = process.env.GAZETTES_TABLE ?? 'fiscal-digital-gazettes-prod'
const REGION = process.env.AWS_REGION ?? 'us-east-1'

// O QD permite 60 req/min. Fazemos 3 chamadas por cidade, então 1.100 ms entre
// elas mantém ~54/min com folga. A primeira versão deste script rodava a
// ~100/min e os HTTP 500 resultantes foram lidos como "fonte indisponível" —
// throttling nosso vira diagnóstico errado se não for tratado.
export const RATE_LIMIT_MS = 1100
export const FONTE_VIVA_DIAS = 90
const MAX_RETRY = 3

// ── Lógica pura (unit-testada em diagnose-collection.test.mjs) ───────────────

/**
 * Classifica uma cidade pela causa raiz da estagnação.
 *
 * `qdTotal`      total de gazettes que o QD tem da cidade (todo o histórico)
 * `qdRecentes`   gazettes no QD nos últimos FONTE_VIVA_DIAS
 * `naoColetado`  gazettes no QD depois do nosso watermark (null se sem watermark)
 */
export function classify({ qdTotal, qdRecentes, naoColetado, watermark }) {
  if (qdTotal === null || qdRecentes === null) return 'ERRO_API'
  if (qdTotal === 0) return 'A_FONTE_NAO_TEM_A_CIDADE'
  if (!watermark) return 'NUNCA_COLETAMOS'
  if (qdRecentes === 0) return 'FONTE_PAROU_DE_PUBLICAR'
  if (naoColetado === null) return 'ERRO_API'
  if (naoColetado > 0) return 'NOS_ESTAMOS_ATRASADOS'
  return 'EM_DIA'
}

/** Só estas causas são acionáveis por nós. As outras duas dependem da fonte. */
export function isNosso(causa) {
  return causa === 'NOS_ESTAMOS_ATRASADOS' || causa === 'NUNCA_COLETAMOS'
}

/** Dia seguinte em ISO. `published_since` do QD é inclusivo. */
export function proximoDia(iso) {
  const t = new Date(`${iso}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}

export function diasEntre(de, ate) {
  return Math.round((new Date(ate) - new Date(de)) / 86400000)
}

export function resumir(linhas) {
  const porCausa = {}
  for (const l of linhas) (porCausa[l.causa] ??= []).push(l)
  return porCausa
}

// ── I/O ─────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function qdCount(territoryId, since, tentativa = 0) {
  const p = new URLSearchParams({ territory_ids: territoryId, size: '1' })
  if (since) p.set('published_since', since)
  const res = await fetch(`${QD_API}/gazettes?${p}`, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  })
  if (!res.ok) {
    if (tentativa < MAX_RETRY) {
      await sleep(3000 * (tentativa + 1))
      return qdCount(territoryId, since, tentativa + 1)
    }
    return null
  }
  const body = await res.json()
  return body.total_gazettes ?? 0
}

// AWS CLI em vez de SDK: mesmo motivo do sentinela (LRN — `npm install` do
// @fiscal-digital/engine dá E401 em GitHub Packages no runner).
function readWatermark(cityId) {
  const out = execFileSync('aws', [
    'dynamodb', 'get-item',
    '--table-name', TABLE,
    '--region', REGION,
    '--key', JSON.stringify({ pk: { S: `BACKFILL#${cityId}` } }),
    '--projection-expression', 'lastDate',
    '--output', 'json',
  ], { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 })
  const parsed = JSON.parse(out || '{}')
  return parsed.Item?.lastDate?.S ?? null
}

function listCities() {
  const out = execFileSync('node', [
    '-e',
    "const{CITIES}=require('@fiscal-digital/engine');" +
    'const l=Array.isArray(CITIES)?CITIES:Object.values(CITIES);' +
    'console.log(JSON.stringify(l.filter(c=>c.active!==false)))',
  ], { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 })
  return JSON.parse(out)
}

async function main() {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const soCidade = args.find((a) => a.startsWith('--city='))?.slice('--city='.length)
  const hoje = new Date().toISOString().slice(0, 10)
  const desde = new Date(Date.now() - FONTE_VIVA_DIAS * 86400000).toISOString().slice(0, 10)

  const cidades = listCities().filter((c) => !soCidade || c.cityId === soCidade)
  const linhas = []

  for (const c of cidades) {
    const watermark = readWatermark(c.cityId)
    const qdTotal = await qdCount(c.cityId)
    await sleep(RATE_LIMIT_MS)
    const qdRecentes = await qdCount(c.cityId, desde)
    await sleep(RATE_LIMIT_MS)
    let naoColetado = null
    if (watermark) {
      naoColetado = await qdCount(c.cityId, proximoDia(watermark))
      await sleep(RATE_LIMIT_MS)
    }
    const linha = { ...c, watermark, qdTotal, qdRecentes, naoColetado }
    linha.causa = classify(linha)
    linha.paradoHa = watermark ? diasEntre(watermark, hoje) : null
    linhas.push(linha)
    if (!asJson) process.stderr.write('.')
  }
  if (!asJson) process.stderr.write('\n')

  if (asJson) {
    console.log(JSON.stringify({ geradoEm: hoje, cidades: linhas }, null, 2))
    return
  }

  const porCausa = resumir(linhas)
  const ordem = [
    'NOS_ESTAMOS_ATRASADOS', 'NUNCA_COLETAMOS',
    'FONTE_PAROU_DE_PUBLICAR', 'A_FONTE_NAO_TEM_A_CIDADE',
    'EM_DIA', 'ERRO_API',
  ]
  console.log(`\nDIAGNOSTICO DE COLETA — ${hoje} — ${cidades.length} cidades ativas`)
  for (const causa of ordem) {
    const lista = porCausa[causa]
    if (!lista?.length) continue
    console.log(`\n### ${causa}  (${lista.length})${isNosso(causa) ? '  <- acionavel por nos' : ''}`)
    console.log('  cidade                   UF  QD_total  QD_90d  watermark    parado  nao_coletado')
    for (const l of lista.sort((a, b) => (b.naoColetado ?? 0) - (a.naoColetado ?? 0))) {
      console.log(
        '  ' + l.name.padEnd(24) + l.uf.padEnd(4) +
        String(l.qdTotal).padStart(8) + String(l.qdRecentes).padStart(8) +
        String(l.watermark ?? '-').padStart(13) +
        String(l.paradoHa != null ? l.paradoHa + 'd' : '-').padStart(8) +
        String(l.naoColetado ?? '-').padStart(14),
      )
    }
  }
  const nossos = linhas.filter((l) => isNosso(l.causa)).length
  console.log(
    `\nRESUMO: ${ordem.filter((k) => porCausa[k]).map((k) => `${k}=${porCausa[k].length}`).join('  ')}`,
  )
  console.log(`${nossos} de ${linhas.length} cidades sao acionaveis por nos; o resto depende da fonte.`)
}

if (process.argv[1]?.endsWith('diagnose-collection.mjs')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
