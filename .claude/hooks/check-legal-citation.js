#!/usr/bin/env node
// PreToolUse hook: bloqueia citações jurídicas não-verificadas em artefatos públicos.
// Aplica o Princípio Inegociável "Sempre citar a fonte" ao output deste agente.
//
// Cobre:
//   Bash:        gh issue create|edit|comment (--body / --body-file)
//                gh pr   create|edit|comment (--body / --body-file)
//   Edit|Write:  docs/**/*.md, **/messages/*.json,
//                .github/ISSUE_TEMPLATE/**, **/ROADMAP.md, **/README.md
//
// Bypass:
//   - automatico: se todas as citacoes resolvem contra packages/engine/src/legal-corpus/
//   - manual: [legal-verified: <fonte>] no body OU <!-- legal-verified --> em markdown.

const fs = require('fs')
const path = require('path')

let stdin = ''
process.stdin.on('data', (c) => (stdin += c))
process.stdin.on('end', () => {
  let payload
  try { payload = JSON.parse(stdin) } catch { process.exit(0) }

  const tool = payload.tool_name
  const input = payload.tool_input || {}
  let text = ''
  let where = ''

  if (tool === 'Bash') {
    const cmd = input.command || ''
    if (!/\bgh\s+(issue|pr)\s+(create|edit|comment)\b/.test(cmd)) process.exit(0)
    text = extractGhBody(cmd)
    where = `gh ${(cmd.match(/gh\s+(issue|pr)\s+(\w+)/) || [, '', ''])[1]} ${(cmd.match(/gh\s+\w+\s+(\w+)/) || [, ''])[1]}`.trim()
  } else if (tool === 'Write' || tool === 'Edit') {
    const p = (input.file_path || '').replace(/\\/g, '/')
    if (!shouldScan(p)) process.exit(0)
    text = input.content || input.new_string || ''
    where = p
  } else {
    process.exit(0)
  }

  if (!text) process.exit(0)
  if (hasBypass(text)) process.exit(0)

  const found = scan(text)
  if (found.size === 0) process.exit(0)

  // Bypass automatico: se todas as citacoes mapeiam para arquivos do legal-corpus, libera.
  const corpusRoot = findCorpusRoot()
  const corpusReport = corpusRoot ? resolveAgainstCorpus(text, corpusRoot) : null
  if (corpusReport && corpusReport.refs.length > 0 && corpusReport.unresolved.length === 0) {
    process.exit(0)
  }

  const list = [...found].slice(0, 8).join(', ')
  const more = found.size > 8 ? ` (+${found.size - 8})` : ''
  const corpusMsg = buildCorpusMsg(corpusReport, corpusRoot)
  block(
    `Bloqueado em ${where}: detectadas ${found.size} referência(s) jurídica(s): ${list}${more}.\n\n` +
    `${corpusMsg}\n\n` +
    `ATTESTE no chat que cada uma foi LIDA na sessão atual:\n` +
    `  - path:linha do repo (ex: packages/engine/src/fiscais/legal-constants.ts:5), OU\n` +
    `  - arquivo do legal-corpus (ex: legal-corpus/lei-14133-2021/art-75.md), OU\n` +
    `  - URL WebFetch da fonte oficial (planalto.gov.br, stf.jus.br, tse.jus.br), OU\n` +
    `  - texto original da Issue/doc que você está editando (não inferência).\n\n` +
    `Bypass quando já validou:\n` +
    `  - body de gh: incluir [legal-verified: <fonte>]\n` +
    `  - markdown: incluir <!-- legal-verified --> (qualquer linha do arquivo)\n\n` +
    `Princípio Inegociável "Sempre citar a fonte" aplica-se ao SEU output, não só ao engine.`
  )
})

function shouldScan(p) {
  return /(^|\/)docs\/.+\.md$/.test(p)
      || /(^|\/)messages\/[^/]+\.json$/.test(p)
      || /(^|\/)\.github\/ISSUE_TEMPLATE\//.test(p)
      || /(^|\/)ROADMAP\.md$/.test(p)
      || /(^|\/)README\.md$/.test(p)
}

function hasBypass(text) {
  return /\[legal-verified[:\s\]]/i.test(text)
      || /<!--\s*legal-verified/i.test(text)
}

function extractGhBody(cmd) {
  const bodyFile = cmd.match(/--body-file\s+["']?([^"'\s]+)/)
  if (bodyFile) {
    try { return fs.readFileSync(bodyFile[1], 'utf8') } catch { return '' }
  }
  const heredoc = cmd.match(/<<\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1/)
  if (heredoc) return heredoc[2]
  const body = cmd.match(/--body\s+(['"])([\s\S]*?)\1/)
  return body ? body[2] : ''
}

function scan(text) {
  const patterns = [
    /Lei\s+(?:Complementar\s+)?n?º?\s*\d[\d.]*\/\d{4}/gi,
    /Decreto(?:[- ]Lei)?(?:\s+Federal)?\s+n?º?\s*\d[\d.]*\/\d{4}/gi,
    /Art\.?\s*\d+[º°]?/gi,
    /§\s*\d+[º°]?/g,
    /inciso\s+[IVX]+/gi,
    /Súmula(?:\s+Vinculante)?\s+\d+/gi,
    /\b(STF|STJ|TSE|TCU|TCE-[A-Z]{2}|CGU|RFB)\b/g,
    /\bCF(?:\/88)?\s+Art/gi,
  ]
  const found = new Set()
  for (const p of patterns) {
    const m = text.match(p)
    if (m) m.forEach((x) => found.add(x.trim()))
  }
  return found
}

function block(reason) {
  console.log(JSON.stringify({ decision: 'block', reason }))
  process.exit(0)
}

// ---------- legal-corpus integration ----------

function findCorpusRoot() {
  // Procura packages/engine/src/legal-corpus subindo a arvore + irmaos.
  const candidates = []
  let cur = process.cwd()
  for (let i = 0; i < 8; i++) {
    candidates.push(cur)
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  // Repos vizinhos comuns no setup local (fiscal-digital-web → fiscal-digital)
  const cwdParent = path.dirname(process.cwd())
  candidates.push(path.join(cwdParent, 'fiscal-digital'))
  for (const c of candidates) {
    const probe = path.join(c, 'packages', 'engine', 'src', 'legal-corpus')
    try { if (fs.statSync(probe).isDirectory()) return probe } catch {}
  }
  return null
}

const CORPUS_PATTERNS = [
  // IMPORTANTE: separador `/` obrigatorio. Senao backtrack permite "Lei 14.133" → g1=14.1 g2=33.
  { re: /\bLei\s+(?:Complementar\s+)?n?º?\s*(\d[\d.]*)\/(\d{2,4})\b/gi,
    toDir: (m) => `lei-${m[1].replace(/\./g, '')}-${normYear(m[2])}` },
  { re: /\bDecreto(?:\s+Federal)?\s+n?º?\s*(\d[\d.]*)\/(\d{2,4})\b/gi,
    toDir: (m) => `decreto-${m[1].replace(/\./g, '')}-${normYear(m[2])}` },
  { re: /\bS[úu]mula\s+Vinculante\s+(\d+)/gi,
    toDir: (m) => `stf-sv-${m[1]}` },
  { re: /\b(?:CF(?:\/88)?|Constitui[çc][ãa]o\s+Federal)\b/gi,
    toDir: () => 'cf-1988' },
]

function normYear(y) {
  if (y.length === 4) return y
  const n = parseInt(y, 10)
  return (n >= 50 ? 1900 + n : 2000 + n).toString()
}

function resolveAgainstCorpus(text, root) {
  const refs = []
  for (const pat of CORPUS_PATTERNS) {
    const re = new RegExp(pat.re.source, pat.re.flags)
    let m
    while ((m = re.exec(text)) !== null) {
      const dir = pat.toDir(m)
      const window = text.slice(m.index, m.index + 200)
      const artMatch = window.match(/\bArt\.?\s*(\d+)/i)
      const file = artMatch ? `art-${artMatch[1]}.md` : 'full.md'
      const target = path.join(root, dir, file)
      const fallback = path.join(root, dir, 'full.md')
      let resolved = null
      try { if (fs.statSync(target).isFile()) resolved = `${dir}/${file}` } catch {}
      if (!resolved) {
        try { if (fs.statSync(fallback).isFile()) resolved = `${dir}/full.md` } catch {}
      }
      refs.push({ raw: (m[0] + (artMatch ? ' ' + artMatch[0] : '')).trim(), resolved })
    }
  }
  // dedup
  const seen = new Set()
  const unique = []
  for (const r of refs) {
    const k = `${r.resolved || ''}|${r.raw}`
    if (seen.has(k)) continue
    seen.add(k)
    unique.push(r)
  }
  return { refs: unique, unresolved: unique.filter((r) => !r.resolved) }
}

function buildCorpusMsg(report, root) {
  if (!root) return 'legal-corpus nao encontrado. Rode `node packages/engine/src/legal-corpus/sync.mjs` para popular.'
  if (!report || report.refs.length === 0) {
    return `legal-corpus em ${path.relative(process.cwd(), root)}: padroes detectados nao mapeiam para nenhuma norma do corpus (provavelmente Art./§/inciso sem Lei explicita).`
  }
  const lines = [`legal-corpus em ${path.relative(process.cwd(), root)}:`]
  for (const r of report.refs.slice(0, 6)) {
    lines.push(`  ${r.resolved ? '✓' : '✗'} ${r.raw}${r.resolved ? ` → ${r.resolved}` : ' (FORA da base)'}`)
  }
  if (report.refs.length > 6) lines.push(`  ... (+${report.refs.length - 6})`)
  if (report.unresolved.length > 0) {
    lines.push(`\nFaltam ${report.unresolved.length} norma(s) na base. Opcoes:`)
    lines.push(`  - rodar 'node packages/engine/src/legal-corpus/sync.mjs <id>' apos adicionar ao manifest`)
    lines.push(`  - atestar manualmente com [legal-verified: <fonte>]`)
  }
  return lines.join('\n')
}
