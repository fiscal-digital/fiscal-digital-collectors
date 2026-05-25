#!/usr/bin/env node
// Wrapper para `tsc -p tsconfig.json --noEmit`.
//
// Quando nao ha collectors implementados ainda (bootstrap PR 2), o include
// glob `collectors/*/src/**/*` casa zero arquivos. TS retorna TS18003 (no
// inputs found) com exit 1. Isso e o estado correto do bootstrap — nao
// deve quebrar o gate.
//
// Quando ao menos um collector existir, delegamos para o tsc real.

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const collectorsRoot = path.join(__dirname, '..', 'collectors')

function hasTsSources() {
  if (!fs.existsSync(collectorsRoot)) return false
  for (const entry of fs.readdirSync(collectorsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const srcDir = path.join(collectorsRoot, entry.name, 'src')
    if (!fs.existsSync(srcDir)) continue
    if (walk(srcDir)) return true
  }
  return false
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (walk(path.join(dir, entry.name))) return true
    } else if (entry.name.endsWith('.ts')) {
      return true
    }
  }
  return false
}

if (!hasTsSources()) {
  console.log('typecheck: nenhum collector com src/*.ts ainda — skipping (bootstrap state).')
  process.exit(0)
}

try {
  execSync('tsc -p tsconfig.json --noEmit', { stdio: 'inherit' })
} catch (e) {
  process.exit(e.status || 1)
}
