#!/usr/bin/env bash
# Build UltraHonk Soroban verifier WASM from contracts workspace.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/load_proxy.sh
source "$ROOT/scripts/load_proxy.sh"

rustup target add wasm32v1-none 2>/dev/null || true

echo "==> Building ultrahonk-verifier WASM"
cd "$ROOT/contracts"
stellar contract build --package ultrahonk-verifier

WASM="$ROOT/contracts/target/wasm32v1-none/release/ultrahonk_verifier.wasm"
if [[ ! -f "$WASM" ]]; then
  echo "WASM not found at expected path: $WASM" >&2
  exit 1
fi

echo "WASM: $WASM ($(wc -c < "$WASM") bytes)"
