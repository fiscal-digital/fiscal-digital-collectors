#!/usr/bin/env node
// sentinel-freshness.mjs — sentinela de frescor de coleta (issue engine#151).
//
// Mede a data REAL da última gazette por cidade (máximo de GAZETTE#, nunca o
// watermark BACKFILL#, que até o fix collectors#21 avança sem persistir nada)
// e mantém issues neste repo:
//
//   - primeira execução (nenhuma issue `[sentinela]` aberta): 1 issue agregada
//     com o retrato completo — não 29 issues de uma vez.
//   - execuções seguintes: abre issue por cidade que cruzar STALE_DAYS (máx.
//     MAX_CREATES_PER_RUN por run, anti-spam), fecha com comentário quando a
//     cidade voltar a ter gazette fresca.
//
// Custo: 1 Scan paginado da gazettes-prod (~94MB ≈ R$0,02/run) via role
// read-only fiscal-digital-sentinel-ro. Zero LLM, zero write em AWS.
//
// Uso local (dry-run, não toca issues):
//   node scripts/sentinel-freshness.mjs --dry-run

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { execFileSync } from 'node:child_process'

const TABLE = process.env.GAZETTES_TABLE ?? 'fiscal-digital-gazettes-prod'
const REGION = process.env.AWS_REGION ?? 'us-east-1'
const REPO = process.env.GITHUB_REPOSITORY ?? 'fiscal-digital/fiscal-digital-collectors'

export const STALE_DAYS = 90
export const RECOVER_DAYS = 30
export const MAX_CREATES_PER_RUN = 5
const TITLE_PREFIX = '[sentinela]'
const LABELS = 'ciclo-confiabilidade,frente-dados'

// ── Lógica pura (unit-testada em sentinel-freshness.test.mjs) ────────────────

/** `GAZETTE#4305108#2025-05-27#<hash>` → { cityId, date } (null se não casar). */
export function parseGazettePk(pk) {
  const m = /^GAZETTE#(\d+)#(\d{4}-\d{2}-\d{2})#/.exec(pk ?? '')
  return m ? { cityId: m[1], date: m[2] } : null
}

/** `BACKFILL#4305108` → cityId (null se não casar). */
export function parseBackfillPk(pk) {
  const m = /^BACKFILL#(\d+)$/.exec(pk ?? '')
  return m ? m[1] : null
}

export function daysBetween(fromISO, toISO) {
  return Math.floor((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86_400_000)
}

/**
 * Consolida o scan em um retrato por cidade.
 * Universo = cidades com linha BACKFILL# (o conjunto configurado); a data real
 * vem do máximo de GAZETTE#. Cidade configurada sem NENHUMA gazette → gapDays
 * null e bucket 'sem-dados' (hoje são 9 assim).
 */
export function computeFreshness(pks, todayISO) {
  const maxByCity = new Map()
  const configured = new Set()
  for (const pk of pks) {
    const g = parseGazettePk(pk)
    if (g) {
      const cur = maxByCity.get(g.cityId)
      if (!cur || g.date > cur) maxByCity.set(g.cityId, g.date)
      continue
    }
    const b = parseBackfillPk(pk)
    if (b) configured.add(b)
  }
  // Cidades com gazette mas sem BACKFILL# também entram (dado real > config).
  for (const cityId of maxByCity.keys()) configured.add(cityId)

  const rows = []
  for (const cityId of [...configured].sort()) {
    const lastReal = maxByCity.get(cityId) ?? null
    const gapDays = lastReal ? daysBetween(lastReal, todayISO) : null
    const bucket =
      lastReal === null ? 'sem-dados'
      : gapDays > 180 ? 'critico-180'
      : gapDays > STALE_DAYS ? 'estagnada-90'
      : gapDays > RECOVER_DAYS ? 'atencao-30'
      : 'ok'
    rows.push({ cityId, lastReal, gapDays, bucket })
  }
  return rows
}

const isStale = (r) => r.bucket !== 'ok' && r.bucket !== 'atencao-30'

/**
 * Decide criações/fechamentos a partir do retrato + issues abertas.
 * `openIssues`: [{ number, title }] das issues abertas com o prefixo.
 */
export function planActions(rows, openIssues, maxCreates = MAX_CREATES_PER_RUN) {
  const openByCity = new Map()
  for (const iss of openIssues) {
    const m = new RegExp(`^\\${TITLE_PREFIX} (\\d+) `).exec(iss.title)
    if (m) openByCity.set(m[1], iss.number)
  }

  // Primeira execução: nada aberto → 1 retrato agregado, zero issues por cidade.
  if (openIssues.length === 0 && rows.some(isStale)) {
    return { aggregate: true, toCreate: [], toClose: [], skippedByCap: 0 }
  }

  const staleWithoutIssue = rows.filter((r) => isStale(r) && !openByCity.has(r.cityId))
  const toCreate = staleWithoutIssue.slice(0, maxCreates)
  const toClose = rows
    .filter((r) => !isStale(r) && openByCity.has(r.cityId))
    .map((r) => ({ ...r, issueNumber: openByCity.get(r.cityId) }))
  return { aggregate: false, toCreate, toClose, skippedByCap: staleWithoutIssue.length - toCreate.length }
}

export function renderCityIssue(r, todayISO) {
  const gap = r.gapDays === null ? 'nenhuma gazette registrada' : `${r.gapDays} dias sem gazette`
  return {
    title: `${TITLE_PREFIX} ${r.cityId} ${r.lastReal === null ? 'sem nenhuma gazette' : `sem gazette há ${r.gapDays} dias`}`,
    body: [
      `Detectado pela sentinela de frescor em ${todayISO}.`,
      '',
      `| Cidade (IBGE) | Última gazette real | Gap |`,
      `|---|---|---|`,
      `| ${r.cityId} | ${r.lastReal ?? '—'} | ${gap} |`,
      '',
      'A data vem do máximo real de `GAZETTE#` na gazettes-prod — não do watermark.',
      'Investigar: o Querido Diário parou de publicar esta cidade, ou o collector falha nela?',
      '',
      '_Fecho automaticamente quando a cidade voltar a ter gazette com menos de '
        + `${RECOVER_DAYS} dias._`,
    ].join('\n'),
  }
}

export function renderAggregate(rows, todayISO) {
  const stale = rows.filter(isStale)
  const linhas = rows
    .filter((r) => r.bucket !== 'ok')
    .sort((a, b) => (b.gapDays ?? 99999) - (a.gapDays ?? 99999))
    .map((r) => `| ${r.cityId} | ${r.lastReal ?? '—'} | ${r.gapDays ?? '—'} | ${r.bucket} |`)
  return {
    title: `${TITLE_PREFIX} retrato inicial de frescor — ${stale.length} cidades estagnadas`,
    body: [
      `Primeira execução da sentinela (${todayISO}). Retrato completo em vez de ${stale.length} issues.`,
      '',
      `Total configurado: ${rows.length} cidades · ok: ${rows.filter((r) => r.bucket === 'ok').length}`,
      '',
      '| Cidade (IBGE) | Última gazette real | Gap (dias) | Situação |',
      '|---|---|---|---|',
      ...linhas,
      '',
      'A partir do próximo run, estagnação NOVA (>90d) vira issue própria '
        + `(máx. ${MAX_CREATES_PER_RUN}/run) e recuperação fecha a issue da cidade.`,
    ].join('\n'),
  }
}

// ── I/O (fino de propósito) ──────────────────────────────────────────────────

async function scanPks() {
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))
  const pks = []
  let ExclusiveStartKey
  do {
    const r = await doc.send(new ScanCommand({
      TableName: TABLE,
      ProjectionExpression: 'pk',
      ExclusiveStartKey,
    }))
    for (const it of r.Items ?? []) pks.push(it.pk)
    ExclusiveStartKey = r.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return pks
}

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input })
}

function listOpenSentinelIssues() {
  const out = gh(['issue', 'list', '--repo', REPO, '--state', 'open',
    '--search', `in:title "${TITLE_PREFIX}"`, '--json', 'number,title', '--limit', '100'])
  return JSON.parse(out)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const today = new Date().toISOString().slice(0, 10)

  const pks = await scanPks()
  const rows = computeFreshness(pks, today)
  const open = dryRun ? [] : listOpenSentinelIssues()
  const plan = planActions(rows, open)

  console.log(`[sentinela] ${today} — ${rows.length} cidades · `
    + `estagnadas: ${rows.filter(isStale).length} · issues abertas: ${open.length}`)

  if (dryRun) {
    console.table(rows.filter((r) => r.bucket !== 'ok'))
    console.log('plan:', JSON.stringify({ ...plan, toCreate: plan.toCreate.map((r) => r.cityId) }))
    return
  }

  if (plan.aggregate) {
    const { title, body } = renderAggregate(rows, today)
    gh(['issue', 'create', '--repo', REPO, '--title', title, '--label', LABELS, '--body-file', '-'], body)
    console.log('retrato inicial criado')
    return
  }
  for (const r of plan.toCreate) {
    const { title, body } = renderCityIssue(r, today)
    gh(['issue', 'create', '--repo', REPO, '--title', title, '--label', LABELS, '--body-file', '-'], body)
    console.log(`issue criada: ${r.cityId} (${r.bucket})`)
  }
  for (const r of plan.toClose) {
    gh(['issue', 'close', String(r.issueNumber), '--repo', REPO, '--comment',
      `Cidade ${r.cityId} recuperou: gazette real de ${r.lastReal} (${r.gapDays}d). Fechado pela sentinela.`])
    console.log(`issue fechada: ${r.cityId} → #${r.issueNumber}`)
  }
  if (plan.skippedByCap > 0) {
    console.log(`anti-spam: ${plan.skippedByCap} cidades estagnadas ficaram para o próximo run`)
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
if (isMain) {
  main().catch((err) => { console.error(err.stack || err.message); process.exit(1) })
}
