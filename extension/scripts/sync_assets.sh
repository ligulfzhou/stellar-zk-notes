#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EXT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_PUBLIC="$ROOT/web/public"
mkdir -p "$EXT/public/circuits" "$EXT/public/wasm"

if [[ -f "$WEB_PUBLIC/circuits/hash_pair.json" ]]; then
  cp "$WEB_PUBLIC/circuits/hash_pair.json" "$EXT/public/circuits/"
else
  echo "warn: missing web/public/circuits/hash_pair.json — run npm install in web/" >&2
fi

if [[ -d "$WEB_PUBLIC/wasm" ]]; then
  cp "$WEB_PUBLIC/wasm/"*.wasm "$EXT/public/wasm/" 2>/dev/null || true
fi

if [[ -d "$ROOT/web/node_modules/@noir-lang/acvm_js/web" ]]; then
  cp "$ROOT/web/node_modules/@noir-lang/acvm_js/web/acvm_js_bg.wasm" "$EXT/public/wasm/" 2>/dev/null || true
  cp "$ROOT/web/node_modules/@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm" "$EXT/public/wasm/" 2>/dev/null || true
fi
