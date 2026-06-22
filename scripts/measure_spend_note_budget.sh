#!/usr/bin/env bash
# Measure Soroban CPU budget for spend_note UltraHonk verify_proof.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/load_proxy.sh
source "$ROOT/scripts/load_proxy.sh"
# shellcheck source=scripts/zk_toolchain.env
source "$ROOT/scripts/zk_toolchain.env"

export PATH="${HOME}/.bb/bin:${HOME}/.nargo/bin:${PATH}"

VK="$ROOT/artifacts/spend_note/vk"
if [[ ! -f "$VK" ]]; then
  echo "Missing VK — run ./scripts/build_vk.sh first" >&2
  exit 1
fi

if [[ ! -f "$ROOT/artifacts/spend_note/proof" ]]; then
  echo "No proof artifact — generating from Prover.toml if present"
  if [[ -f "$ROOT/circuits/spend_note/Prover.toml" ]]; then
    "$ROOT/scripts/prove_from_witness.sh" "$ROOT/circuits/spend_note/Prover.toml" >/dev/null || {
      cd "$ROOT/circuits/spend_note" && nargo execute && cd "$ROOT/circuits/spend_note"
      JSON="./target/spend_note.json"
      GZ="./target/spend_note.gz"
      bb prove -b "$JSON" -w "$GZ" -o "$ROOT/artifacts/spend_note" \
        --scheme ultra_honk --oracle_hash keccak --output_format bytes_and_fields
    }
  else
    echo "Need artifacts/spend_note/proof — run E2E prove or create Prover.toml" >&2
    exit 1
  fi
fi

"$ROOT/scripts/build_ultrahonk_verifier.sh" >/dev/null

VERIFIER_DIR="$ROOT/third_party/ultrahonk_soroban_contract"
cd "$VERIFIER_DIR"

echo "==> spend_note verify (unlimited — raw guest cost)"
RUST_TEST_THREADS=1 cargo test --test spend_note_budget spend_note_verify_budget_unlimited -- --nocapture 2>&1 | rg "Cpu limit:|PASS:|FAIL:" || true

echo ""
echo "==> spend_note verify (testnet limit: 400M insn)"
RUST_TEST_THREADS=1 cargo test --test spend_note_budget spend_note_verify_under_testnet_limits -- --nocapture 2>&1 | rg "Cpu limit:|PASS:|FAIL:" || true

echo ""
echo "==> spend_note verify (mainnet limit: 600M insn)"
RUST_TEST_THREADS=1 cargo test --test spend_note_budget spend_note_verify_under_mainnet_limits -- --nocapture 2>&1 | rg "Cpu limit:|PASS:|FAIL:" || true

echo ""
echo "Network limits: testnet tx_max_instructions=400000000 (stellar network settings)"
echo "Vault shielded_send adds merkle/storage overhead on top of verify CPI."
