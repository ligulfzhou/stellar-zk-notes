#!/usr/bin/env bash
# Build UltraHonk Soroban verifier WASM from third_party checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/load_proxy.sh
source "$ROOT/scripts/load_proxy.sh"
VERIFIER_DIR="$ROOT/third_party/ultrahonk_soroban_contract"

"$ROOT/scripts/setup_ultrahonk.sh"

if [[ ! -f "$VERIFIER_DIR/Cargo.toml" ]]; then
  echo "Verifier source missing at $VERIFIER_DIR" >&2
  exit 1
fi

cd "$VERIFIER_DIR"

# Stellar CLI requires overflow-checks in release profile.
if ! grep -q 'overflow-checks' Cargo.toml; then
  echo "Patching Cargo.toml: enable overflow-checks for release"
  python3 - <<'PY'
from pathlib import Path
p = Path("Cargo.toml")
text = p.read_text()
needle = "[profile.release]\n"
insert = "[profile.release]\noverflow-checks = true\n"
if needle in text and "overflow-checks" not in text:
    text = text.replace(needle, insert, 1)
    p.write_text(text)
PY
fi

rustup target add wasm32v1-none 2>/dev/null || true

echo "==> Building ultrahonk_soroban_contract WASM"
stellar contract build --optimize

WASM="$VERIFIER_DIR/target/wasm32v1-none/release/ultrahonk_soroban_contract.wasm"
if [[ ! -f "$WASM" ]]; then
  echo "WASM not found at expected path: $WASM" >&2
  exit 1
fi

echo "WASM: $WASM ($(wc -c < "$WASM") bytes)"
