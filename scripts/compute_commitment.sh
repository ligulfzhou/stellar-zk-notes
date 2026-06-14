#!/usr/bin/env bash
# Usage: compute_commitment.sh <value> <secret> <nullifier_secret>
# Prints commitment as 0x-prefixed field hex (BN254).
set -euo pipefail

VALUE="${1:?value required}"
SECRET="${2:?secret required}"
NULLIFIER_SECRET="${3:?nullifier_secret required}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUIT_DIR="$ROOT/circuits/note_hash"
PROVER_FILE="$CIRCUIT_DIR/Prover.toml"

export PATH="${HOME}/.nargo/bin:${PATH}"

cat > "$PROVER_FILE" <<EOF
value = "$VALUE"
secret = "$SECRET"
nullifier_secret = "$NULLIFIER_SECRET"
EOF

cd "$CIRCUIT_DIR"
OUTPUT="$(nargo execute 2>&1)"
echo "$OUTPUT" | awk -F': ' '/Circuit output:/ {print $2; exit}'

rm -f "$PROVER_FILE"
