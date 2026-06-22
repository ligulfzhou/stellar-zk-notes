#!/usr/bin/env bash
# Normalize nargo "Circuit output:" line to 0x-prefixed field hex.
set -euo pipefail
RAW="${1:?circuit output required}"
python3 - <<'PY' "$RAW"
import re, sys

# BN254 scalar field (same as Noir Field / Soroban Bn254Fr).
MOD = 21888242871839275222246405745257275088548364400416034343698204186575808495617

s = sys.argv[1].strip()
m = re.fullmatch(r"Field\((-?\d+)\)", s)
if m:
    n = int(m.group(1)) % MOD
    print(hex(n))
elif s.startswith("0x"):
    print(s)
else:
    print(hex(int(s) % MOD))
PY
