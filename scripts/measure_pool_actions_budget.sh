#!/usr/bin/env bash
# Measure Soroban CPU budget for pool_actions UltraHonk verify_proof (Phase C).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/load_proxy.sh
source "$ROOT/scripts/load_proxy.sh"
# shellcheck source=scripts/zk_toolchain.env
source "$ROOT/scripts/zk_toolchain.env"

export PATH="${HOME}/.bb/bin:${HOME}/.nargo/bin:${PATH}"

ARTIFACTS="$ROOT/artifacts/pool_actions"
VK="$ARTIFACTS/vk"

if [[ ! -f "$VK" ]]; then
  echo "Missing VK — run ./scripts/build_vk_pool_actions.sh first" >&2
  exit 1
fi

if [[ ! -f "$ARTIFACTS/proof" ]]; then
  echo "No proof — generating from 1x1 fixture"
  if [[ -f "$ROOT/scripts/fixtures/pool_actions_1x1.json" ]]; then
    "$ROOT/scripts/prove_pool_actions.sh" "$ROOT/scripts/fixtures/pool_actions_1x1.json"
  else
    echo "Missing fixture $ROOT/scripts/fixtures/pool_actions_1x1.json — compile circuit and add fixture" >&2
    exit 1
  fi
fi

"$ROOT/scripts/build_ultrahonk_verifier.sh" >/dev/null

VERIFIER_DIR="$ROOT/third_party/ultrahonk_soroban_contract"
cd "$VERIFIER_DIR"

echo "==> pool_actions verify (unlimited — raw guest cost)"
RUST_TEST_THREADS=1 cargo test --test pool_actions_budget pool_actions_verify_budget_unlimited -- --nocapture 2>&1 | rg "Cpu limit:|PASS:|FAIL:" || true

echo ""
echo "==> pool_actions verify (testnet limit: 400M insn)"
RUST_TEST_THREADS=1 cargo test --test pool_actions_budget pool_actions_verify_under_testnet_limits -- --nocapture 2>&1 | rg "Cpu limit:|PASS:|FAIL:" || true

echo ""
echo "==> pool_actions verify (mainnet limit: 600M insn)"
RUST_TEST_THREADS=1 cargo test --test pool_actions_budget pool_actions_verify_under_mainnet_limits -- --nocapture 2>&1 | rg "Cpu limit:|PASS:|FAIL:" || true

echo ""
echo "Compare with transfer_actions: ./scripts/measure_transfer_actions_budget.sh"
echo "Public inputs: 12 fields x 32B = 384 bytes (vs transfer_actions 320 bytes)"
