#!/usr/bin/env bash
set -euo pipefail
LEFT="${1:?left field required}"
RIGHT="${2:?right field required}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUIT_DIR="$ROOT/circuits/hash_pair"
export PATH="${HOME}/.nargo/bin:${PATH}"
cat > "$CIRCUIT_DIR/Prover.toml" <<EOF
left = "$LEFT"
right = "$RIGHT"
EOF
cd "$CIRCUIT_DIR"
OUTPUT="$(nargo execute 2>&1)"
rm -f "$CIRCUIT_DIR/Prover.toml"
echo "$OUTPUT" | awk -F': ' '/Circuit output:/ {print $2; exit}'
