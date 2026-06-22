#!/usr/bin/env bash
# Generate UltraHonk proof for transfer_actions (requires barretenberg `bb` CLI).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/scripts/prove_from_witness.sh" "$@"
