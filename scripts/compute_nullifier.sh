#!/usr/bin/env bash
set -euo pipefail
NULLIFIER_SECRET="${1:?nullifier_secret required}"
COMMITMENT="${2:?commitment hex required}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMMITMENT_DEC="$(python3 -c "print(int('${COMMITMENT}', 16))")"
exec "$ROOT/scripts/hash_pair.sh" "$NULLIFIER_SECRET" "$COMMITMENT_DEC"
