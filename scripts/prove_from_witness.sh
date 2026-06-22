#!/usr/bin/env bash
# witness JSON → nargo execute → bb prove (UltraHonk, keccak oracle).
set -euo pipefail

WITNESS_JSON="${1:?path to witness json required}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUIT="$ROOT/circuits/transfer_actions"
ARTIFACTS="$ROOT/artifacts/transfer_actions"
BB_FLAGS=(--scheme ultra_honk --oracle_hash keccak --output_format bytes_and_fields)

export PATH="${HOME}/.bb/bin:${HOME}/.nargo/bin:${PATH}"

if ! command -v bb >/dev/null 2>&1; then
  echo "Install bb: ./scripts/install_zk_tools.sh" >&2
  exit 1
fi

mkdir -p "$ARTIFACTS"
"$ROOT/scripts/witness_transfer_actions.sh" "$WITNESS_JSON"

cd "$CIRCUIT"
JSON="./target/transfer_actions.json"
GZ="./target/transfer_actions.gz"

if [[ ! -f "$GZ" ]]; then
  echo "Missing witness $GZ — nargo execute failed?" >&2
  exit 1
fi

bb prove -b "$JSON" -w "$GZ" -o "$ARTIFACTS" "${BB_FLAGS[@]}"

PROOF_FILE="$ARTIFACTS/proof"
if [[ ! -f "$PROOF_FILE" ]]; then
  PROOF_FILE=$(find "$ARTIFACTS" -maxdepth 2 -name 'proof' -type f 2>/dev/null | head -1)
fi
if [[ ! -f "$PROOF_FILE" ]]; then
  echo "Could not locate proof under $ARTIFACTS" >&2
  exit 1
fi

python3 - <<PY "$PROOF_FILE"
import sys
data = open(sys.argv[1], "rb").read()
print("0x" + data.hex())
PY
