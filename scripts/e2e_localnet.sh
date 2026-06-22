#!/usr/bin/env bash
# Real-ZK end-to-end on local Soroban (unlimited instruction budget).
# Use when testnet tx_max_instructions (400M) blocks UltraHonk verify (~401M).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER_NAME="${STELLAR_LOCAL_CONTAINER:-zk-local}"
LOCAL_RPC="${STELLAR_LOCAL_RPC:-http://localhost:8000/soroban/rpc}"
LOCAL_PASSPHRASE='Standalone Network ; February 2017'
SOURCE="${STELLAR_SOURCE:-alice}"

echo "==> Localnet real-ZK E2E (unlimited Soroban budget)"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "Starting stellar quickstart container ($CONTAINER_NAME)…"
  stellar container start -t future --name "$CONTAINER_NAME" --limits unlimited
fi

stellar network add local \
  --rpc-url "$LOCAL_RPC" \
  --network-passphrase "$LOCAL_PASSPHRASE" 2>/dev/null || true
stellar network use local

stellar keys generate --global "$SOURCE" 2>/dev/null || true
stellar keys fund "$SOURCE" --network local 2>/dev/null || true

export STELLAR_NETWORK=local
export STELLAR_RPC_URL="$LOCAL_RPC"
export STELLAR_NETWORK_PASSPHRASE="$LOCAL_PASSPHRASE"
export STELLAR_SOURCE="$SOURCE"
export ZK_MOCK_PROOF=false

echo "==> Deploy vault + UltraHonk verifier on localnet"
DEPLOY_OUT="$("$ROOT/scripts/deploy_testnet.sh" --real-zk)"
echo "$DEPLOY_OUT"

VAULT_ID="$(echo "$DEPLOY_OUT" | sed -n 's/^  VAULT_ID=//p' | tail -1)"
if [[ -z "$VAULT_ID" ]]; then
  echo "Could not parse VAULT_ID from deploy output" >&2
  exit 1
fi

export NEXT_PUBLIC_VAULT_CONTRACT_ID="$VAULT_ID"
export NEXT_PUBLIC_SOROBAN_RPC_URL="$LOCAL_RPC"

echo "==> E2E flow (real proofs)"
"$ROOT/scripts/e2e_testnet.sh" "$@"
