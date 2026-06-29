# zk-utxo

UTXO-style private payments on Stellar — arbitrary amounts, 4×4 action bundles, dual withdraw paths.

**Hackathon:** [Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk/detail)  
**Category:** Wild — UTXO-style private payment system

**Sibling project:** [`zk`](../zk) — Tornado-style denomination privacy pools (separate submission)

## Status

| Layer | Status |
|-------|--------|
| `utxo_actions` circuit (4×4 + relayer_fee, Sapling-style notes) | ✅ 8 tests pass |
| `note_hash` / `hash_pair` | ✅ |
| Soroban vault (deposit / shielded_transfer / withdraw / exit_via_relayer) | ✅ 8 contract tests |
| Web wallet — Deposit / Send / Withdraw | ✅ |
| Relayer + E2E (mock + real ZK) | ✅ |
| Testnet (UltraHonk) | ✅ see [deploy.md](docs/deploy.md) |

See [design spec](docs/superpowers/specs/2026-06-24-utxo-private-payment-design.md) and [implementation plan](docs/superpowers/plans/2026-06-24-utxo-implementation.md).

## Deploy (testnet)

```bash
STELLAR_SOURCE=admin ./scripts/deploy_testnet.sh          # MockVerifier (demo)
STELLAR_SOURCE=admin ./scripts/deploy_testnet.sh --real-zk # UltraHonk + utxo_actions VK
```

Update `web/.env.local` with the printed `VAULT_ID`.

## E2E (no browser)

```bash
# Requires UTXO vault in web/.env.local
ZK_MOCK_PROOF=true STELLAR_SOURCE=admin ./scripts/e2e_testnet.sh --flow withdraw
ZK_MOCK_PROOF=true STELLAR_SOURCE=alice ./scripts/e2e_testnet.sh --flow send
ZK_MOCK_PROOF=true STELLAR_SOURCE=admin E2E_RELAYER_SOURCE=alice ./scripts/e2e_testnet.sh --flow relayer-exit
ZK_MOCK_PROOF=true STELLAR_SOURCE=alice ./scripts/e2e_testnet.sh --flow full

# Relayer HTTP (start relayer first):
# cd scripts/relayer && RELAYER_SECRET=<alice S> VAULT_ID=<C> npm run server
ZK_MOCK_PROOF=true STELLAR_SOURCE=admin ./scripts/e2e_testnet.sh --flow relayer-http
```

## vs `zk` (Tornado)

| | `zk` | `zk-utxo` |
|--|------|-----------|
| Amounts | Fixed 1/10/100 XLM pools | **Any amount** |
| Circuit | `pool_actions` | **`utxo_actions`** |
| Merkle | 3 denomination trees | **Single global tree** |
| UX | Join / Exit | Deposit / Withdraw |
| Payments | Same-denomination pool | Coin selection + change (4×4) |

## Quick start

```bash
# Circuits
cd circuits/utxo_actions && nargo test

# Contracts
cd contracts && cargo test -p vault

# Web wallet
cd web && npm install && npm run dev
```

Set `NEXT_PUBLIC_VAULT_CONTRACT_ID` in `web/.env.local` after testnet deploy ([deploy guide](docs/deploy.md)).

**Live testnet (real ZK):** vault `CDXNSHTPMRSDJSVHJ4K5BUJPDOT7NI6XH6HSBODRLLG3R2EYVBIATICW`

## License

Apache-2.0
