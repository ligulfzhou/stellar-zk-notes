#!/usr/bin/env bash
# Source scripts/proxy.env when present (gitignored).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT/scripts/proxy.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/scripts/proxy.env"
fi
