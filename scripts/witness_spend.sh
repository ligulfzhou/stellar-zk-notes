#!/usr/bin/env bash
set -euo pipefail
JSON_FILE="${1:?path to witness json required}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUIT_DIR="$ROOT/circuits/spend_note"
export PATH="${HOME}/.nargo/bin:${PATH}"

python3 - <<'PY' "$JSON_FILE" > "$CIRCUIT_DIR/Prover.toml"
import json, sys
d = json.load(open(sys.argv[1]))
def field_arr(name, values):
    quoted = ", ".join(f'"{v}"' for v in values)
    print(f"{name} = [{quoted}]")
def bool_arr(name, values):
    print(f"{name} = [{', '.join(str(v) for v in values)}]")
print(f'value0 = "{d["value0"]}"')
print(f'secret0 = "{d["secret0"]}"')
print(f'nullifier_secret0 = "{d["nullifier_secret0"]}"')
field_arr("merkle_path0", d["merkle_path0"])
bool_arr("path_indices0", ["true" if v else "false" for v in d["path_indices0"]])
print(f'value1 = "{d["value1"]}"')
print(f'secret1 = "{d["secret1"]}"')
print(f'nullifier_secret1 = "{d["nullifier_secret1"]}"')
field_arr("merkle_path1", d["merkle_path1"])
bool_arr("path_indices1", ["true" if v else "false" for v in d["path_indices1"]])
print(f'out0_value = "{d["out0_value"]}"')
print(f'out0_secret = "{d["out0_secret"]}"')
print(f'out0_nullifier_secret = "{d["out0_nullifier_secret"]}"')
print(f'out1_value = "{d["out1_value"]}"')
print(f'out1_secret = "{d["out1_secret"]}"')
print(f'out1_nullifier_secret = "{d["out1_nullifier_secret"]}"')
print(f'merkle_root = "{d["merkle_root"]}"')
print(f'nullifier0 = "{d["nullifier0"]}"')
print(f'nullifier1 = "{d["nullifier1"]}"')
print(f'new_commitment0 = "{d["new_commitment0"]}"')
print(f'new_commitment1 = "{d["new_commitment1"]}"')
print(f'public_amount = "{d["public_amount"]}"')
print(f'mode = "{d["mode"]}"')
PY

cd "$CIRCUIT_DIR"
nargo execute >&2
