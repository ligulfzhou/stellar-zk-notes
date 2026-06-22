#!/usr/bin/env bash
# Fetch indextree UltraHonk Soroban verifier (submodule or shallow clone).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/load_proxy.sh
source "$ROOT/scripts/load_proxy.sh"
DEST="$ROOT/third_party/ultrahonk_soroban_contract"
REPO="https://github.com/indextree/ultrahonk_soroban_contract.git"
CLONE_TIMEOUT_SEC="${ULTRAHONK_CLONE_TIMEOUT_SEC:-120}"

if [[ -f "$DEST/Cargo.toml" ]]; then
  echo "UltraHonk verifier already present at $DEST"
  exit 0
fi

mkdir -p "$ROOT/third_party"

clone_repo() {
  echo "Cloning $REPO → $DEST (timeout ${CLONE_TIMEOUT_SEC}s)…"
  echo "If this hangs, check GitHub access or set a proxy, then retry."
  export GIT_TERMINAL_PROMPT=0
  if command -v timeout >/dev/null 2>&1; then
    timeout "$CLONE_TIMEOUT_SEC" git clone --depth 1 --progress "$REPO" "$DEST"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$CLONE_TIMEOUT_SEC" git clone --depth 1 --progress "$REPO" "$DEST"
  else
    git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime="$CLONE_TIMEOUT_SEC" \
      clone --depth 1 --progress "$REPO" "$DEST"
  fi
}

if [[ -d "$ROOT/.git" ]] && git -C "$ROOT" submodule status third_party/ultrahonk_soroban_contract &>/dev/null; then
  echo "Initializing git submodule…"
  export GIT_TERMINAL_PROMPT=0
  if command -v timeout >/dev/null 2>&1; then
    timeout "$CLONE_TIMEOUT_SEC" git -C "$ROOT" submodule update --init --depth 1 third_party/ultrahonk_soroban_contract
  else
    git -C "$ROOT" submodule update --init --depth 1 third_party/ultrahonk_soroban_contract
  fi
elif [[ -d "$DEST/.git" ]]; then
  echo "Removing incomplete clone at $DEST"
  rm -rf "$DEST"
  clone_repo
else
  clone_repo
fi

if [[ ! -f "$DEST/Cargo.toml" ]]; then
  echo "Failed to fetch UltraHonk verifier." >&2
  echo "Manual fix:" >&2
  echo "  git clone --depth 1 $REPO $DEST" >&2
  echo "  # or: git submodule update --init third_party/ultrahonk_soroban_contract" >&2
  exit 1
fi

echo "UltraHonk verifier ready at $DEST"
