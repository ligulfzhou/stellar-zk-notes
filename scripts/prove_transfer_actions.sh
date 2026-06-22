#!/usr/bin/env bash
# Generate UltraHonk proof for transfer_actions (Phase A budget artifact).
set -euo pipefail

WITNESS_JSON="${1:-$(cd "$(dirname "$0")/.." && pwd)/scripts/fixtures/transfer_actions_4in2out.json}"
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
  echo "Missing witness $GZ" >&2
  exit 1
fi

bb prove -b "$JSON" -w "$GZ" -o "$ARTIFACTS" "${BB_FLAGS[@]}"
echo "Artifacts: $ARTIFACTS (proof, public_inputs)"
