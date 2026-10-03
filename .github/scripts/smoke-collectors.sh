#!/usr/bin/env bash
# Smoke pós-deploy dos collectors. Não invoca as Lambdas: invocar o collector
# dispara uma coleta real contra o Querido Diário. Confere o que o deploy
# acabou de mudar — código ativo, alias prod e agendamentos — sem efeito
# colateral.
set -euo pipefail
FAIL=0
fail() { echo "::error::$1"; FAIL=1; }

for fn in fiscal-digital-collector-prod fiscal-digital-supplier-collector-prod; do
  read -r state status <<<"$(aws lambda get-function-configuration --function-name "$fn" --query '[State,LastUpdateStatus]' --output text)"
  [ "$state" = "Active" ] && [ "$status" = "Successful" ] || fail "$fn: State=$state LastUpdateStatus=$status"
  latest=$(aws lambda list-versions-by-function --function-name "$fn" --query 'Versions[-1].Version' --output text)
  alias=$(aws lambda get-alias --function-name "$fn" --name prod --query FunctionVersion --output text 2>/dev/null || echo none)
  [ "$alias" = "$latest" ] || fail "$fn: alias prod=$alias, última versão publicada=$latest"
  echo "$fn: $state/$status, alias prod=v$alias"
done

for rule in fiscal-digital-daily-collector-prod fiscal-digital-retry-collector-prod fiscal-digital-supplier-refresh-prod; do
  st=$(aws events describe-rule --name "$rule" --query State --output text 2>/dev/null || echo AUSENTE)
  [ "$st" = "ENABLED" ] || fail "regra $rule: $st"
  n=$(aws events list-targets-by-rule --rule "$rule" --query 'length(Targets)' --output text 2>/dev/null || echo 0)
  [ "$n" -ge 1 ] || fail "regra $rule sem target"
  echo "regra $rule: $st, targets=$n"
done

[ $FAIL -eq 0 ] && echo "Smoke PASS" || exit 1
