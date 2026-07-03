#!/usr/bin/env bash
set -euo pipefail
JSON_FILE="${1:?path to witness json required}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUIT_DIR="$ROOT/circuits/utxo_actions"
export PATH="${HOME}/.nargo/bin:${PATH}"

python3 - <<'PY' "$JSON_FILE" > "$CIRCUIT_DIR/Prover.toml"
import json, sys
d = json.load(open(sys.argv[1]))

def field_arr(name, values):
    quoted = ", ".join(f'"{v}"' for v in values)
    print(f"{name} = [{quoted}]")

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
field_arr("spend_note_randomness", d["spend_note_randomness"])
field_arr("spend_spending_sk", d["spend_spending_sk"])
field_arr("spend_diversifier", d.get("spend_diversifier", ["0","0","0","0"]))
merkle_paths("spend_merkle_path", d["spend_merkle_path"])
merkle_indices("spend_path_indices", d["spend_path_indices"])
field_arr("out_value", d["out_value"])
field_arr("out_note_randomness", d["out_note_randomness"])
field_arr("out_recipient_pk", d["out_recipient_pk"])
print(f'merkle_root = "{d["merkle_root"]}"')
field_arr("nullifier", d["nullifier"])
field_arr("new_commitment", d["new_commitment"])
print(f'public_amount = "{d["public_amount"]}"')
print(f'relayer_fee = "{d.get("relayer_fee", "0")}"')
PY

cd "$CIRCUIT_DIR"
nargo execute >&2
