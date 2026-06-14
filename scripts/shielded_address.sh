#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 \"twelve word mnemonic phrase ...\" [network]" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$ROOT/scripts/shielded_address.mjs" "$1" "${2:-testnet}"
