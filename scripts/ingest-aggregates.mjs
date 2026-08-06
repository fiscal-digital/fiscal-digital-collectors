#!/usr/bin/env node
// ingest-aggregates.mjs — aquisição única do histórico via pacotes /aggregates
// do Querido Diário, gravando a camada RAW imutável no S3.
//
// POR QUE ISSO EXISTE
//   Cobertura medida em 2026-08-06 (mesmo filtro de keywords da produção):
//   temos 47.865 gazettes de 168.256 disponíveis — 28,4%. Ingerir o restante
//   pela API de busca custaria ~33h no rate limit de 60 req/min e ~120 mil
//   downloads de PDF contra o CDN de uma ONG. O QD publica exatamente o que
//   precisamos em /aggregates/{UF}: um ZIP por estado-ano com o TEXTO INTEGRAL
//   de cada diário (media 39.819 chars vs 1.500 dos excerpts atuais — 26,5×).
//
// O PRINCÍPIO (adquirir 1×, derivar ∞×)
//   Aquisição = tocar a fonte. Cara, lenta, e a fonte pode sumir (15 das
//   nossas cidades já pararam de publicar no QD). Acontece UMA vez por dado.
//   Processamento = filtrar/extrair/analisar. Deriva do S3, re-executável por
//   centavos. Nenhum estágio a jusante pode jamais precisar do QD de novo.
//   Hoje só 691 das 47.865 gazettes têm texto persistido (1,4%) — é por isso
//   que toda melhoria vira re-ingestão. Esta camada fecha esse vazamento.
//
// LAYOUT NO S3 (bucket gazettes-cache)
//   raw/aggregates/{UF}/{UF}_{ANO}.zip      o pacote como veio (STANDARD_IA)
//   raw/txt/{tid}/{data}/{sha16}.txt        texto integral por diário (STANDARD)
//   raw/manifests/{tid}/{ANO}.json          índice: datas, hashes, proveniência
//
//   txt fica em STANDARD de propósito: STANDARD_IA cobra mínimo de 128 KB por
//   objeto — 168k textos pequenos em IA custariam MAIS que em STANDARD.
//   Custo medido da camada completa: ~US$ 0,50/mês. O zip vai para IA porque
//   são ~100 objetos grandes de acesso raro.
//
// IMUTABILIDADE
//   Chave = hash do conteúdo → PUT é idempotente; nada é sobrescrito nem
//   apagado. Rodar de novo é seguro por construção. `--force` só refaz o
//   manifesto, nunca remove objeto.
//
// USO (script LOCAL — a aquisição é única, não precisa de Lambda/cron)
//   node scripts/ingest-aggregates.mjs --uf=RS --years=2025 --dry-run
//   node scripts/ingest-aggregates.mjs --uf=RS --years=2021-2025
//   node scripts/ingest-aggregates.mjs --uf=RS --years=2025 --cities=4305108
//
// Requisitos: credenciais AWS com PutObject no bucket e um `tar` que leia zip
// (bsdtar: nativo no Windows 10+/macOS; em Linux, libarchive-tools). O tar do
// Git Bash é GNU e NÃO serve — o script resolve o binário certo sozinho.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3')
const { CITIES } = require('@fiscal-digital/engine')

const QD_API = 'https://api.queridodiario.ok.org.br'
const USER_AGENT = 'FiscalDigital/0.1.1 (+https://fiscaldigital.org)'
const BUCKET = process.env.GAZETTES_CACHE_BUCKET ?? 'fiscal-digital-gazettes-cache-prod'
export const MANIFEST_SCHEMA_VERSION = 1

// ── Lógica pura (unit-testada em ingest-aggregates.test.mjs) ─────────────────

/** `18/07/2025` → `2025-07-18`; null se não for data BR válida. */
export function toIsoDate(br) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br ?? '')
  if (!m) return null
  const [, d, mo, y] = m
  const iso = `${y}-${mo}-${d}`
  const t = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso
}

/** Desfaz APENAS as 5 entidades XML. Nenhuma outra transformação: é camada RAW. */
export function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Extração linear por indexOf — regex em strings de 30+ MB é pedir problema. */
export function extractTag(chunk, tag) {
  const open = `<${tag}>`
  const a = chunk.indexOf(open)
  if (a === -1) return null
  const b = chunk.indexOf(`</${tag}>`, a + open.length)
  if (b === -1) return null
  return chunk.slice(a + open.length, b)
}

/**
 * Parseia um XML de cidade-ano do pacote agregado.
 * Estrutura: <root><meta>…</meta><diarios><diario>…</diario>…</diarios></root>
 * `skipped` conta diários sem data válida ou sem conteúdo — nunca falha o run.
 */
export function parseAggregateXml(xml) {
  const chunks = xml.split('<diario>')
  const header = chunks[0]
  const territoryId = extractTag(header, 'municipio_codigo_ibge')?.trim() ?? null
  const diarios = []
  let skipped = 0

  for (let i = 1; i < chunks.length; i++) {
    const c = chunks[i]
    const date = toIsoDate(extractTag(c, 'data_publicacao')?.trim())
    const conteudo = extractTag(c, 'conteudo')
    if (!date || !conteudo || conteudo.trim().length === 0) {
      skipped++
      continue
    }
    diarios.push({
      date,
      edicao: extractTag(c, 'numero_edicao')?.trim() ?? null,
      poder: extractTag(c, 'poder')?.trim() ?? null,
      isExtra: (extractTag(c, 'edicao_extra')?.trim() ?? '').toLowerCase() === 'sim',
      urlOriginal: unescapeXml(extractTag(c, 'url_arquivo_original')?.trim() ?? ''),
      conteudo: unescapeXml(conteudo),
    })
  }
  return { territoryId, diarios, skipped }
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function txtKey(tid, isoDate, sha) {
  return `raw/txt/${tid}/${isoDate}/${sha.slice(0, 16)}.txt`
}

export function zipS3Key(uf, year) {
  return `raw/aggregates/${uf}/${uf}_${year}.zip`
}

export function manifestS3Key(tid, year) {
  return `raw/manifests/${tid}/${year}.json`
}

/** `rscaxiassul_4305108_2025.xml` → `4305108` (null se não casar o padrão). */
export function cityIdFromXmlName(name) {
  const m = /_(\d{7})_(\d{4})\.xml$/i.exec(name ?? '')
  return m ? m[1] : null
}

/**
 * Cidade-ano já ingerida com o MESMO zip? O `hash_info` vem da listagem
 * /aggregates — se o QD regenerar o pacote, o hash muda e reingerimos.
 */
export function shouldSkipCityYear(manifest, zipHashInfo) {
  return manifest?.schemaVersion === MANIFEST_SCHEMA_VERSION
    && manifest?.sourceZipHash === zipHashInfo
    && Array.isArray(manifest?.entries)
}

/** Anos aceitos: `2025` ou `2021-2025`. */
export function parseYears(arg) {
  const range = /^(\d{4})-(\d{4})$/.exec(arg ?? '')
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])]
    if (b < a) return []
    return Array.from({ length: b - a + 1 }, (_, i) => String(a + i))
  }
  return /^\d{4}$/.test(arg ?? '') ? [arg] : []
}

// ── I/O ─────────────────────────────────────────────────────────────────────

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' })

// GNU tar (Git Bash) não lê zip; o tar nativo do Windows/macOS é bsdtar e lê.
function resolveTar() {
  const winTar = 'C:/Windows/System32/tar.exe'
  if (process.platform === 'win32' && existsSync(winTar)) return winTar
  return 'tar'
}

async function listAggregates(uf) {
  const res = await fetch(`${QD_API}/aggregates/${uf}`, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  })
  if (!res.ok) throw new Error(`QD /aggregates/${uf}: HTTP ${res.status}`)
  return (await res.json()).aggregates ?? []
}

async function downloadZip(filePath, dest) {
  // A API devolve `file_path` sem esquema e sem a barra depois do host.
  const url = `https://${filePath.replace(/^https?:\/\//, '').replace(/^data\.queridodiario\.ok\.org\.br/, 'data.queridodiario.ok.org.br/')}`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

async function s3Exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

async function s3GetJson(key) {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    return JSON.parse(await out.Body.transformToString('utf-8'))
  } catch {
    return null
  }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const force = args.includes('--force')
  const ufArg = args.find((a) => a.startsWith('--uf='))?.slice(5)?.toUpperCase()
  const years = parseYears(args.find((a) => a.startsWith('--years='))?.slice(8))
  const citiesArg = args.find((a) => a.startsWith('--cities='))?.slice(9)?.split(',')

  if (!ufArg || years.length === 0) {
    console.error('uso: node scripts/ingest-aggregates.mjs --uf=RS --years=2021-2025 [--cities=...] [--dry-run] [--force]')
    process.exit(2)
  }

  const ativas = (Array.isArray(CITIES) ? CITIES : Object.values(CITIES))
    .filter((c) => c.active !== false && c.uf === ufArg)
    .filter((c) => !citiesArg || citiesArg.includes(c.cityId))
  const nossas = new Map(ativas.map((c) => [c.cityId, c.name]))
  if (nossas.size === 0) {
    console.error(`nenhuma cidade ativa em CITIES para UF=${ufArg}`)
    process.exit(2)
  }
  console.log(`UF=${ufArg} anos=${years.join(',')} cidades=[${[...nossas.values()].join(', ')}]${dryRun ? '  [DRY RUN]' : ''}`)

  const disponiveis = await listAggregates(ufArg)
  const tar = resolveTar()
  const resumo = []

  for (const year of years) {
    const pacote = disponiveis.find((a) => String(a.year) === year && a.territory_id === null)
    if (!pacote) {
      console.log(`\n${ufArg} ${year}: sem pacote no QD — pulando`)
      continue
    }

    const tmp = mkdtempSync(join(tmpdir(), `qd-agg-${ufArg}-${year}-`))
    const zipLocal = join(tmp, `${ufArg}_${year}.zip`)
    try {
      console.log(`\n${ufArg} ${year}: baixando (${pacote.file_size_mb} MB)…`)
      await downloadZip(pacote.file_path, zipLocal)
      execFileSync(tar, ['-xf', zipLocal, '-C', tmp])

      for (const nomeXml of readdirSync(tmp).filter((f) => f.endsWith('.xml'))) {
        const tid = cityIdFromXmlName(nomeXml)
        if (!tid || !nossas.has(tid)) continue

        const manifestKey = manifestS3Key(tid, year)
        if (!force && shouldSkipCityYear(await s3GetJson(manifestKey), pacote.hash_info)) {
          console.log(`  ${nossas.get(tid)} ${year}: manifesto atual — pulando`)
          resumo.push({ cidade: nossas.get(tid), year, novos: 0, existentes: 'skip', bytes: 0 })
          continue
        }

        const { territoryId, diarios, skipped } = parseAggregateXml(readFileSync(join(tmp, nomeXml), 'utf-8'))
        if (territoryId && territoryId !== tid) {
          console.warn(`  AVISO ${nomeXml}: codigo_ibge=${territoryId} difere do nome do arquivo (${tid}) — usando o do nome`)
        }

        let novos = 0
        let existentes = 0
        let bytes = 0
        const entries = []
        for (const d of diarios) {
          const sha = sha256(d.conteudo)
          const key = txtKey(tid, d.date, sha)
          entries.push({
            date: d.date, sha256: sha, bytes: Buffer.byteLength(d.conteudo, 'utf8'),
            s3Key: key, edicao: d.edicao, poder: d.poder, isExtra: d.isExtra, urlOriginal: d.urlOriginal,
          })
          if (!dryRun) {
            if (await s3Exists(key)) {
              existentes++
            } else {
              await s3.send(new PutObjectCommand({
                Bucket: BUCKET, Key: key, Body: d.conteudo,
                ContentType: 'text/plain; charset=utf-8',
                Metadata: { source: 'qd-aggregates', zip: `${ufArg}_${year}.zip`, date: d.date },
              }))
              novos++
              bytes += Buffer.byteLength(d.conteudo, 'utf8')
            }
          }
        }

        if (!dryRun) {
          await s3.send(new PutObjectCommand({
            Bucket: BUCKET, Key: manifestKey,
            Body: JSON.stringify({
              schemaVersion: MANIFEST_SCHEMA_VERSION,
              uf: ufArg, year, territoryId: tid,
              sourceZip: zipS3Key(ufArg, year), sourceZipHash: pacote.hash_info,
              generatedAt: new Date().toISOString(),
              totals: { diarios: entries.length, semData: skipped },
              entries,
            }),
            ContentType: 'application/json; charset=utf-8',
          }))
        }
        console.log(`  ${nossas.get(tid)} ${year}: ${entries.length} diários (${novos} novos, ${existentes} já no S3, ${skipped} sem data)${dryRun ? ' [dry]' : ''}`)
        resumo.push({ cidade: nossas.get(tid), year, diarios: entries.length, novos, existentes, mb: (bytes / 1048576).toFixed(1) })
      }

      // O zip vai por último: só arquiva quando as cidades foram processadas.
      const zk = zipS3Key(ufArg, year)
      if (!dryRun && !(await s3Exists(zk))) {
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET, Key: zk, Body: readFileSync(zipLocal),
          ContentType: 'application/zip', StorageClass: 'STANDARD_IA',
          Metadata: { hash_info: String(pacote.hash_info), source_updated: String(pacote.last_updated) },
        }))
        console.log(`  zip arquivado em s3://${BUCKET}/${zk} (STANDARD_IA)`)
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  console.log('\nRESUMO')
  for (const r of resumo) {
    console.log(`  ${String(r.cidade).padEnd(20)} ${r.year}  diarios=${r.diarios ?? '-'}  novos=${r.novos}  mb=${r.mb ?? '-'}`)
  }
}

if (process.argv[1]?.endsWith('ingest-aggregates.mjs')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
