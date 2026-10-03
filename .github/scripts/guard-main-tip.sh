#!/usr/bin/env bash
# Guarda contra rollback silencioso (fiscal-digital#214; cópia do script da engine).
#
# "Re-run" de um run antigo do deploy reimplanta o commit DAQUELE run, não o
# topo da main, e termina verde. Em 13/09/2026 isso desfez o #146 em prod por
# 6 minutos sem nenhum sinal. Este script falha se o commit a implantar não
# for o topo atual da main, a menos que o rollback seja declarado.
#
# Usa a API de compare do GitHub: independe da profundidade do clone.
# Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, ALLOW_ROLLBACK (true|false).
set -euo pipefail

main_sha=$(gh api "repos/${GITHUB_REPOSITORY}/commits/main" --jq .sha)
status=$(gh api "repos/${GITHUB_REPOSITORY}/compare/main...${GITHUB_SHA}" --jq .status)

echo "commit a implantar: ${GITHUB_SHA}"
echo "topo atual da main: ${main_sha}"
echo "relação com a main: ${status}"

if [ "$status" = "identical" ]; then
  echo "OK: o commit é o topo da main."
  exit 0
fi

if [ "${ALLOW_ROLLBACK:-false}" = "true" ]; then
  echo "::warning title=Rollback declarado::Implantando ${GITHUB_SHA} (status ${status}); topo da main é ${main_sha}."
  exit 0
fi

echo "::error title=Deploy fora do topo da main (#214)::Este run implantaria ${GITHUB_SHA}, mas o topo da main é ${main_sha} (status: ${status}). Re-run de deploy antigo é rollback silencioso. Para implantar a main, dispare o workflow de novo na main. Para rollback intencional, use workflow_dispatch com allow_rollback=true."
exit 1
