#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> zk-notes demo (scaffold)"
echo "1. Circuit tests"
(cd "$ROOT/circuits/spend_note" && nargo test)

echo "2. Contract tests"
(cd "$ROOT/contracts" && cargo test)

echo "3. Crypto scripts"
"$ROOT/scripts/verify_crypto.sh"

echo "4. Web build"
(cd "$ROOT/web" && npm run build)

echo "5. CLI"
(cd "$ROOT/cli/zk-notes" && cargo run --quiet -- status)

echo ""
echo "Done."
echo "  E2E testnet: ./scripts/e2e_testnet.sh"
echo "  Web wallet: cd web && npm run dev"
echo "  Testnet vault: CAQMBCLAIM6ACM2LHKNUYHQUOQKF73NWXASPV6ZTY3JZET72N3HTGM54"
