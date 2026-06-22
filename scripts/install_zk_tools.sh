#!/usr/bin/env bash
# Install Noir (nargo) + Barretenberg (bb) for UltraHonk proofs. Idempotent.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/load_proxy.sh
source "$ROOT/scripts/load_proxy.sh"
# shellcheck source=scripts/zk_toolchain.env
source "$ROOT/scripts/zk_toolchain.env"

NOIR_INSTALL_DIR="${NOIR_INSTALL_DIR:-$HOME/.nargo/bin}"
BB_INSTALL_DIR="${BB_INSTALL_DIR:-$HOME/.bb/bin}"
export PATH="$BB_INSTALL_DIR:$NOIR_INSTALL_DIR:$PATH"

need_noirup() {
  if command -v noirup >/dev/null 2>&1; then
    return 1
  fi
  echo "Installing noirup…"
  curl -L --connect-timeout 30 --max-time 300 \
    https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
  export PATH="$NOIR_INSTALL_DIR:$PATH"
}

nargo_version() {
  if ! command -v nargo >/dev/null 2>&1; then
    echo "missing"
    return
  fi
  nargo --version 2>/dev/null | awk '/^nargo version/{print $4}'
}

ensure_nargo() {
  local current
  current="$(nargo_version)"
  if [[ "$current" == "$ZK_NOIR_VERSION" ]]; then
    echo "nargo already at $ZK_NOIR_VERSION"
    return
  fi

  if [[ "$current" != "missing" ]]; then
    echo "nargo is $current — switching to $ZK_NOIR_VERSION (required for bb $ZK_BB_VERSION)"
  else
    echo "Installing nargo $ZK_NOIR_VERSION…"
  fi

  need_noirup || true
  noirup -v "$ZK_NOIR_VERSION"
  export PATH="$NOIR_INSTALL_DIR:$PATH"

  current="$(nargo_version)"
  if [[ "$current" != "$ZK_NOIR_VERSION" ]]; then
    echo "Failed to install nargo $ZK_NOIR_VERSION (got: $current)" >&2
    exit 1
  fi
}

install_bb() {
  local uname_s uname_m file url
  uname_s=$(uname -s | tr '[:upper:]' '[:lower:]')
  uname_m=$(uname -m)
  case "${uname_s}_${uname_m}" in
    linux_x86_64)  file="barretenberg-amd64-linux.tar.gz" ;;
    darwin_arm64)  file="barretenberg-arm64-darwin.tar.gz" ;;
    darwin_x86_64) file="barretenberg-amd64-darwin.tar.gz" ;;
    *)
      echo "Unsupported platform: ${uname_s}_${uname_m}" >&2
      echo "Install bb $ZK_BB_VERSION manually from https://github.com/AztecProtocol/aztec-packages/releases" >&2
      exit 1
      ;;
  esac

  url="https://github.com/AztecProtocol/aztec-packages/releases/download/${ZK_BB_VERSION}/${file}"
  echo "Downloading bb ${ZK_BB_VERSION} (${file})…"
  mkdir -p "$BB_INSTALL_DIR"
  curl -L --connect-timeout 30 --max-time 300 "$url" -o /tmp/bb.tar.gz
  tar -xzf /tmp/bb.tar.gz -C "$BB_INSTALL_DIR"
  chmod +x "$BB_INSTALL_DIR/bb" 2>/dev/null || true
  if [[ ! -x "$BB_INSTALL_DIR/bb" && -x "$BB_INSTALL_DIR/barretenberg/bb" ]]; then
    ln -sf "$BB_INSTALL_DIR/barretenberg/bb" "$BB_INSTALL_DIR/bb"
  fi
}

ensure_bb() {
  if command -v bb >/dev/null 2>&1; then
    local ver
    ver="$(bb --version 2>/dev/null | head -1 || true)"
    if [[ "$ver" == "$ZK_BB_VERSION" ]]; then
      echo "bb already at $ZK_BB_VERSION"
      return
    fi
    if [[ -n "$ver" ]]; then
      echo "bb is $ver — reinstalling $ZK_BB_VERSION"
    fi
  else
    echo "Installing bb $ZK_BB_VERSION…"
  fi
  install_bb
}

ensure_nargo
ensure_bb

echo ""
echo "ZK toolchain ready:"
echo "  nargo $(nargo_version)"
echo "  bb $(bb --version 2>/dev/null | head -1)"
echo "Add to PATH: export PATH=\"$BB_INSTALL_DIR:$NOIR_INSTALL_DIR:\$PATH\""
