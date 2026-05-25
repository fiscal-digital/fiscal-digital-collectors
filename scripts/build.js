#!/usr/bin/env node
// Wrapper para `npm run build --workspaces --if-present`.
//
// Quando `collectors/*` esta vazio (bootstrap PR 2), o npm v11 sai com
// "No workspaces found!" (exit 1). Isso e o estado correto do bootstrap —
// nao deve quebrar o gate.
//
// Quando ao menos um collector existir, delegamos para o npm real.

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const collectorsRoot = path.join(__dirname, '..', 'collectors')

function hasWorkspaces() {
  if (!fs.existsSync(collectorsRoot)) return false
  for (const entry of fs.readdirSync(collectorsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const pkg = path.join(collectorsRoot, entry.name, 'package.json')
    if (fs.existsSync(pkg)) return true
  }
  return false
}

if (!hasWorkspaces()) {
  console.log('build: nenhum workspace em collectors/ ainda — skipping (bootstrap state).')
  process.exit(0)
}

try {
  execSync('npm run build --workspaces --if-present', { stdio: 'inherit' })
} catch (e) {
  process.exit(e.status || 1)
}
