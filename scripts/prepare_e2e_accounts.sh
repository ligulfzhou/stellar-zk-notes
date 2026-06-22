#!/usr/bin/env bash
# Prepare testnet accounts for E2E (alice-bob flow): print addresses and optionally fund via friendbot.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/load_proxy.sh
source "$ROOT/scripts/load_proxy.sh"

FUND=false
names=()
for arg in "$@"; do
  case "$arg" in
    --fund) FUND=true ;;
    -h|--help)
      echo "Usage: $0 [--fund] [alice bob ...]"
      echo "  --fund   Request testnet XLM from friendbot (uses scripts/proxy.env if present)"
      exit 0
      ;;
    *) names+=("$arg") ;;
  esac
done
if [[ ${#names[@]} -eq 0 ]]; then
  names=(alice bob)
fi

fund_account() {
  local name="$1"
  local addr="$2"
  if [[ "$FUND" != true ]]; then
    return 0
  fi
  echo "  Funding $name via friendbot…"
  local resp
  if ! resp="$(curl -sf --max-time 45 "https://friendbot.stellar.org?addr=$addr")"; then
    echo "  ⚠ friendbot failed for $name — use lab link below or set scripts/proxy.env"
    return 1
  fi
  if echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if d.get('successful') else 1)" 2>/dev/null; then
    echo "  ✓ $name funded"
    return 0
  fi
  echo "  ⚠ friendbot returned error for $name"
  return 1
}

for name in "${names[@]}"; do
  if ! stellar keys public-key "$name" >/dev/null 2>&1; then
    echo "Missing key: $name — run: stellar keys generate $name"
    continue
  fi
  addr="$(stellar keys public-key "$name")"
  echo "$name: $addr"
  fund_account "$name" "$addr" || true
  echo "  https://lab.stellar.org/account/create?accountId=$addr"
done
