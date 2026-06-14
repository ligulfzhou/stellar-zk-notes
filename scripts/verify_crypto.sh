#!/usr/bin/env bash
# Cross-check off-chain Poseidon2 helpers used by the web wallet APIs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VALUE="10000000"
SECRET="42"
NULLIFIER_SECRET="99"

echo "==> commitment"
COMMIT=$("$ROOT/scripts/compute_commitment.sh" "$VALUE" "$SECRET" "$NULLIFIER_SECRET")
echo "$COMMIT"

echo "==> nullifier"
NULLIFIER=$("$ROOT/scripts/compute_nullifier.sh" "$NULLIFIER_SECRET" "$COMMIT")
echo "$NULLIFIER"

echo "==> hash_pair (zero, zero)"
HASH=$("$ROOT/scripts/hash_pair.sh" "0" "0")
echo "$HASH"

echo "OK — crypto scripts runnable"
