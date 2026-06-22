#!/usr/bin/env bash
set -euo pipefail
JSON_FILE="${1:?path to witness json required}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUIT_DIR="$ROOT/circuits/transfer_actions"
export PATH="${HOME}/.nargo/bin:${PATH}"

python3 - <<'PY' "$JSON_FILE" > "$CIRCUIT_DIR/Prover.toml"
import json, sys
d = json.load(open(sys.argv[1]))

def field_arr(name, values):
    quoted = ", ".join(f'"{v}"' for v in values)
    print(f"{name} = [{quoted}]")

def bool_arr(name, values):
    print(f"{name} = [{', '.join(str(v) for v in values)}]")

def merkle_paths(name, paths):
    rows = []
    for row in paths:
        rows.append("[" + ", ".join(f'"{v}"' for v in row) + "]")
    print(f"{name} = [{', '.join(rows)}]")

def merkle_indices(name, indices):
    rows = []
    for row in indices:
        rows.append("[" + ", ".join("true" if v else "false" for v in row) + "]")
    print(f"{name} = [{', '.join(rows)}]")

field_arr("spend_value", d["spend_value"])
field_arr("spend_secret", d["spend_secret"])
field_arr("spend_nullifier_secret", d["spend_nullifier_secret"])
merkle_paths("spend_merkle_path", d["spend_merkle_path"])
merkle_indices("spend_path_indices", d["spend_path_indices"])
field_arr("out_value", d["out_value"])
field_arr("out_secret", d["out_secret"])
field_arr("out_nullifier_secret", d["out_nullifier_secret"])
print(f'merkle_root = "{d["merkle_root"]}"')
field_arr("nullifier", d["nullifier"])
field_arr("new_commitment", d["new_commitment"])
print(f'public_amount = "{d["public_amount"]}"')
PY

cd "$CIRCUIT_DIR"
nargo execute >&2
