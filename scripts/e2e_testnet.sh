#!/usr/bin/env bash
# End-to-end testnet integration test (deposit / send / withdraw).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/web"

# Load web/.env.local for vault id + rpc
if [[ -f "$ROOT/web/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/web/.env.local"
  set +a
fi

export STELLAR_NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
export STELLAR_RPC_URL="${STELLAR_RPC_URL:-${NEXT_PUBLIC_SOROBAN_RPC_URL:-https://soroban-rpc.testnet.stellar.gateway.fm}}"
export NODE_PATH="$ROOT/web/node_modules${NODE_PATH:+:$NODE_PATH}"

echo "Running zk-notes e2e on testnet…"
npx --yes tsx "$ROOT/scripts/e2e/run.ts" "$@"
