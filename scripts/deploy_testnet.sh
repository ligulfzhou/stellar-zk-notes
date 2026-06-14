#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NETWORK="${STELLAR_NETWORK:-testnet}"
SOURCE="${STELLAR_SOURCE:?Set STELLAR_SOURCE to your funded testnet account name or address}"
ADMIN="${STELLAR_ADMIN:-$SOURCE}"
TOKEN="${STELLAR_TOKEN:-}"

echo "==> Building contracts"
cd "$ROOT/contracts"
stellar contract build --package mock-verifier
stellar contract build --package vault

echo "==> Deploying MockVerifier (demo — accepts any proof)"
VERIFIER_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/mock_verifier.wasm \
  --network "$NETWORK" \
  --source "$SOURCE")
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

Deployed on $NETWORK:
  VERIFIER_ID=$VERIFIER_ID
  TOKEN=$TOKEN
  VAULT_ID=$VAULT_ID

Web wallet:
  cp web/.env.local.example web/.env.local
  # NEXT_PUBLIC_VAULT_CONTRACT_ID=$VAULT_ID
  cd web && npm run dev

For real ZK proofs, replace VERIFIER_ID with UltraHonk verifier (see docs/deploy.md).
EOF
