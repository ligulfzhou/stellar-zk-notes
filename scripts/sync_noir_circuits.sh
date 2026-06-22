#!/usr/bin/env bash
# Copy compiled Noir circuits + WASM blobs into the Next.js public folder.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
PUBLIC="$WEB/public"
CIRCUITS="$PUBLIC/circuits"
WASM="$PUBLIC/wasm"

export PATH="${HOME}/.nargo/bin:${PATH}"

mkdir -p "$CIRCUITS" "$WASM"

cd "$ROOT/circuits/note_hash" && nargo compile
cd "$ROOT/circuits/hash_pair" && nargo compile
cd "$ROOT/circuits/pool_actions" && nargo compile
cd "$ROOT/circuits/exit_hash" && nargo compile

cp "$ROOT/circuits/note_hash/target/note_hash.json" "$CIRCUITS/note_hash.json"
cp "$ROOT/circuits/hash_pair/target/hash_pair.json" "$CIRCUITS/hash_pair.json"
cp "$ROOT/circuits/pool_actions/target/pool_actions.json" "$CIRCUITS/pool_actions.json"
cp "$ROOT/circuits/exit_hash/target/exit_hash.json" "$CIRCUITS/exit_hash.json"
# Legacy alias for older clients
cp "$CIRCUITS/pool_actions.json" "$CIRCUITS/transfer_actions.json"

if [[ -d "$WEB/node_modules/@noir-lang/acvm_js/web" ]]; then
  cp "$WEB/node_modules/@noir-lang/acvm_js/web/acvm_js_bg.wasm" "$WASM/"
  cp "$WEB/node_modules/@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm" "$WASM/"
fi
