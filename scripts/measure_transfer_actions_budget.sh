#!/usr/bin/env bash
# Measure Soroban CPU budget for transfer_actions UltraHonk verify_proof (Phase A).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/load_proxy.sh
source "$ROOT/scripts/load_proxy.sh"
# shellcheck source=scripts/zk_toolchain.env
source "$ROOT/scripts/zk_toolchain.env"

export PATH="${HOME}/.bb/bin:${HOME}/.nargo/bin:${PATH}"

ARTIFACTS="$ROOT/artifacts/transfer_actions"
VK="$ARTIFACTS/vk"

if [[ ! -f "$VK" ]]; then
  echo "Missing VK — run ./scripts/build_vk_transfer_actions.sh first" >&2
  exit 1
fi

if [[ ! -f "$ARTIFACTS/proof" ]]; then
  echo "No proof — generating from 1x1 fixture"
  "$ROOT/scripts/gen_transfer_actions_fixtures.ts" 2>/dev/null || \
    npx --yes tsx "$ROOT/scripts/gen_transfer_actions_fixtures.ts"
  "$ROOT/scripts/prove_transfer_actions.sh" \
    "$ROOT/scripts/fixtures/transfer_actions_1x1.json"
fi

"$ROOT/scripts/build_ultrahonk_verifier.sh" >/dev/null

VERIFIER_DIR="$ROOT/third_party/ultrahonk_soroban_contract"
cd "$VERIFIER_DIR"

echo "==> transfer_actions verify (unlimited — raw guest cost)"
RUST_TEST_THREADS=1 cargo test --test transfer_actions_budget transfer_actions_verify_budget_unlimited -- --nocapture 2>&1 | rg "Cpu limit:|PASS:|FAIL:" || true

echo ""
echo "==> transfer_actions verify (testnet limit: 400M insn)"
RUST_TEST_THREADS=1 cargo test --test transfer_actions_budget transfer_actions_verify_under_testnet_limits -- --nocapture 2>&1 | rg "Cpu limit:|PASS:|FAIL:" || true

echo ""
echo "==> transfer_actions verify (mainnet limit: 600M insn)"
RUST_TEST_THREADS=1 cargo test --test transfer_actions_budget transfer_actions_verify_under_mainnet_limits -- --nocapture 2>&1 | rg "Cpu limit:|PASS:|FAIL:" || true

echo ""
echo "Compare with spend_note: ./scripts/measure_spend_note_budget.sh"
echo "Public inputs: 10 fields x 32B = 320 bytes (vs spend_note 224 bytes)"
