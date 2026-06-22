#!/usr/bin/env bash
# Compile pool_actions circuit and write UltraHonk VK (keccak oracle).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/zk_toolchain.env
source "$ROOT/scripts/zk_toolchain.env"

CIRCUIT="$ROOT/circuits/pool_actions"
ARTIFACTS="$ROOT/artifacts/pool_actions"
BB_FLAGS=(--scheme ultra_honk --oracle_hash keccak --output_format bytes_and_fields)

export PATH="${HOME}/.bb/bin:${HOME}/.nargo/bin:${PATH}"

if ! command -v bb >/dev/null 2>&1; then
  echo "Install bb: ./scripts/install_zk_tools.sh" >&2
  exit 1
fi

nargo_ver="$(nargo --version 2>/dev/null | awk '/^nargo version/{print $4}' || echo missing)"
if [[ "$nargo_ver" != "$ZK_NOIR_VERSION" ]]; then
  echo "Wrong nargo version: $nargo_ver (need $ZK_NOIR_VERSION)" >&2
  exit 1
fi

mkdir -p "$ARTIFACTS"
cd "$CIRCUIT"

echo "==> nargo compile pool_actions (nargo $ZK_NOIR_VERSION)"
nargo compile

JSON="./target/pool_actions.json"
if [[ ! -f "$JSON" ]]; then
  echo "Missing $JSON after compile" >&2
  exit 1
fi

echo "==> bb write_vk"
bb write_vk -b "$JSON" -o "$ARTIFACTS" "${BB_FLAGS[@]}"

if [[ -f "$ARTIFACTS/vk/vk" ]]; then
  mv "$ARTIFACTS/vk/vk" "$ARTIFACTS/vk"
  rmdir "$ARTIFACTS/vk" 2>/dev/null || true
fi

echo "VK written: $ARTIFACTS/vk ($(wc -c < "$ARTIFACTS/vk") bytes)"
