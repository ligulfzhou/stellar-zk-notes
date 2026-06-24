#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/load_proxy.sh
source "$ROOT/scripts/load_proxy.sh"

# Prefer gateway.fm RPC from web/.env.local (default testnet RPC can timeout on WASM upload).
if [[ -f "$ROOT/web/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/web/.env.local"
  set +a
fi
export STELLAR_RPC_URL="${STELLAR_RPC_URL:-${NEXT_PUBLIC_SOROBAN_RPC_URL:-https://soroban-rpc.testnet.stellar.gateway.fm}}"
export STELLAR_NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"

NETWORK="${STELLAR_NETWORK:-testnet}"
SOURCE="${STELLAR_SOURCE:?Set STELLAR_SOURCE to your funded testnet account name or address}"
ADMIN="${STELLAR_ADMIN:-$SOURCE}"
TOKEN="${STELLAR_TOKEN:-}"
REAL_ZK=false

for arg in "$@"; do
  case "$arg" in
    --real-zk) REAL_ZK=true ;;
    -h|--help)
      cat <<EOF
Usage: STELLAR_SOURCE=<account> ./scripts/deploy_testnet.sh [--real-zk]

  (default)   MockVerifier — accepts any proof (ZK_MOCK_PROOF=true)
  --real-zk   UltraHonk verifier with pool_actions VK (requires bb + VK built)

Before --real-zk:
  ./scripts/install_zk_tools.sh
  ./scripts/build_vk_pool_actions.sh
  ./scripts/build_ultrahonk_verifier.sh

Set STELLAR_RPC_URL and STELLAR_NETWORK_PASSPHRASE when using a custom RPC.
EOF
      exit 0
      ;;
  esac
done

echo "==> Building vault"
cd "$ROOT/contracts"
stellar contract build --package vault

if [[ "$REAL_ZK" == true ]]; then
  VK="$ROOT/artifacts/pool_actions/vk"
  if [[ ! -f "$VK" ]]; then
    echo "VK missing — run ./scripts/build_vk_pool_actions.sh first" >&2
    exit 1
  fi
  "$ROOT/scripts/build_ultrahonk_verifier.sh"
  WASM="$ROOT/third_party/ultrahonk_soroban_contract/target/wasm32v1-none/release/ultrahonk_soroban_contract.wasm"

echo "==> Deploying UltraHonk verifier (real ZK)"
echo "    rpc: $STELLAR_RPC_URL"
VERIFIER_ID=$(stellar contract deploy \
    --wasm "$WASM" \
    --network "$NETWORK" \
    --source "$SOURCE" \
    -- \
    --vk_bytes-file-path "$VK")
  ZK_MODE="real (UltraHonk)"
else
  stellar contract build --package mock-verifier
  echo "==> Deploying MockVerifier (demo — accepts any proof)"
  VERIFIER_ID=$(stellar contract deploy \
    --wasm target/wasm32v1-none/release/mock_verifier.wasm \
    --network "$NETWORK" \
    --source "$SOURCE")
  ZK_MODE="mock"
fi
echo "VERIFIER_ID=$VERIFIER_ID"

if [[ -z "$TOKEN" ]]; then
  echo "==> Resolving native XLM SAC"
  TOKEN=$(stellar contract id asset --asset native --network "$NETWORK")
fi
echo "TOKEN=$TOKEN"

echo "==> Deploying Vault"
VAULT_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/vault.wasm \
  --network "$NETWORK" \
  --source "$SOURCE")
echo "VAULT_ID=$VAULT_ID"

echo "==> Initializing vault"
stellar contract invoke \
  --id "$VAULT_ID" \
  --network "$NETWORK" \
  --source "$ADMIN" \
  -- initialize \
  --admin "$ADMIN" \
  --token "$TOKEN" \
  --verifier "$VERIFIER_ID"

cat <<EOF

Deployed on $NETWORK (ZK mode: $ZK_MODE):
  VERIFIER_ID=$VERIFIER_ID
  TOKEN=$TOKEN
  VAULT_ID=$VAULT_ID

Web wallet — update web/.env.local:
  NEXT_PUBLIC_VAULT_CONTRACT_ID=$VAULT_ID
  ZK_MOCK_PROOF=$([ "$REAL_ZK" == true ] && echo "false" || echo "true")

  cd web && npm run dev

Real ZK spend: install bb, set ZK_MOCK_PROOF=false, proofs via ./scripts/prove_from_witness.sh
EOF
