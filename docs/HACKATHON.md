# Stellar Hacks ZK — Submission Notes

**Project:** zk-utxo — UTXO-style private payments on Stellar  
**Hackathon:** [Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk/buidl)  
**Category:** Wild — UTXO-style private payment system  
**Sibling:** [`../zk`](../zk) — Tornado-style fixed-denomination pools (separate submission)

## One-liner

Arbitrary-amount shielded XLM using a single global Merkle tree, 4×4 `utxo_actions` ZK bundles, coin selection with change, and dual withdraw paths (on-chain + relayer).

## Live demo

| | |
|--|--|
| Vault (testnet, real ZK) | `CDXNSHTPMRSDJSVHJ4K5BUJPDOT7NI6XH6HSBODRLLG3R2EYVBIATICW` |
| Verifier | `CBY63OSDXCUVWGIKZRS4FQG27IOI5WDMYO2652SU2ELHAPE5Q4JCXMPT` |
| Web wallet | `cd web && npm run dev` (set `web/.env.local`) |

## What to show judges

1. **Deposit** arbitrary XLM → commitment in global tree (no pool denomination)
2. **Send** — coin-select notes, pay recipient, auto change output (encrypted note delivery)
3. **Withdraw** — on-chain (recipient visible) vs **relayer exit** (nullifier only on-chain)
4. **Real ZK** — UltraHonk proofs verified on-chain (not mock verifier)

## Technical highlights

- Circuit: `utxo_actions` — up to 4 inputs × 4 outputs, `relayer_fee` public input
- Commitment v1: `poseidon2(value, secret, nullifier_secret)` — no `pool_id`
- Public inputs: 11 fields × 32B = 352 bytes
- Merkle height 16 (~65k notes, single anonymity set)
- Privacy: deposit events leak only `commitment + leaf_index` (no amount/depositor)

## Reproduce (5 min)

```bash
# Circuits + contracts
cd circuits/utxo_actions && nargo test
cd contracts && cargo test -p vault

# E2E on testnet (real ZK)
export PATH="$HOME/.bb/bin:$HOME/.nargo/bin:$PATH"
ZK_MOCK_PROOF=false STELLAR_SOURCE=alice ./scripts/e2e_testnet.sh --flow withdraw
ZK_MOCK_PROOF=false STELLAR_SOURCE=alice ./scripts/e2e_testnet.sh --flow send
# Full pipeline (deposit → send → bob withdraw)
ZK_MOCK_PROOF=false STELLAR_SOURCE=alice ./scripts/e2e_testnet.sh --flow full

## vs Tornado (`zk`)

| | Tornado (`zk`) | UTXO (`zk-utxo`) |
|--|----------------|------------------|
| Amounts | Fixed 1/10/100 XLM pools | Any amount |
| Anonymity set | Per denomination | Global tree |
| UX | Join / Exit | Deposit / Send / Withdraw |
| Circuit | `pool_actions` | `utxo_actions` |

## Repo structure

```
circuits/utxo_actions/   # Noir 4×4 action circuit
contracts/vault/         # Soroban vault
web/                     # Next.js wallet
scripts/e2e/             # Headless testnet flows
scripts/relayer/         # Gasless exit server
```

## Links

- Design: [docs/superpowers/specs/2026-06-24-utxo-private-payment-design.md](superpowers/specs/2026-06-24-utxo-private-payment-design.md)
- Deploy: [docs/deploy.md](deploy.md)
