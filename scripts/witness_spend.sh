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
print(f'value = "{d["value"]}"')
print(f'secret = "{d["secret"]}"')
print(f'nullifier_secret = "{d["nullifier_secret"]}"')
field_arr("merkle_path", d["merkle_path"])
bool_arr("path_indices", ["true" if v else "false" for v in d["path_indices"]])
print(f'new_value = "{d["new_value"]}"')
print(f'new_secret = "{d["new_secret"]}"')
print(f'new_nullifier_secret = "{d["new_nullifier_secret"]}"')
print(f'merkle_root = "{d["merkle_root"]}"')
print(f'nullifier = "{d["nullifier"]}"')
print(f'new_commitment = "{d["new_commitment"]}"')
print(f'public_amount = "{d["public_amount"]}"')
print(f'mode = "{d["mode"]}"')
PY

cd "$CIRCUIT_DIR"
nargo execute
