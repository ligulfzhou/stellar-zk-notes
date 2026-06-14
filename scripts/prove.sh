#!/usr/bin/env bash
# Generate UltraHonk proof for spend_note (requires barretenberg `bb` CLI).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUIT="$ROOT/circuits/spend_note"
ARTIFACTS="$ROOT/artifacts/spend_note"

export PATH="${HOME}/.nargo/bin:${PATH}"

if ! command -v bb >/dev/null 2>&1; then
  echo "Install Barretenberg CLI (bb) from Aztec aztec-packages, then re-run." >&2
  echo "See: https://github.com/AztecProtocol/aztec-packages/tree/master/barretenberg" >&2
  exit 1
fi

mkdir -p "$ARTIFACTS"
cd "$CIRCUIT"

nargo compile
nargo execute

# Adjust flags to match your bb version (keccak oracle hash for Stellar verifiers).
bb prove_ultrahonk -b ./target/spend_note.json -w ./target/spend_note.gz -o "$ARTIFACTS"

echo "Proof artifacts written to $ARTIFACTS"
