# zk-notes

UTXO-style private payments on Stellar using zero-knowledge proofs.

**Hackathon:** [Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk/detail)  
**Category:** Wild — UTXO-style private payment system

## What it does

- **Deposit** public tokens into a shielded note (on-chain commitment only)
- **Shielded send** privately transfer a note to another user (zk1 / registered G… + on-chain ECDH delivery)
- **Withdraw** to a public Stellar address without revealing the deposit link

Spending requires a Noir `transfer_actions` proof (up to 4 inputs + 4 outputs) verified on-chain via UltraHonk. With `NEXT_PUBLIC_ZK_MOCK_PROOF=false`, proofs are generated **in your browser** (`@aztec/bb.js`); mock verifier is demo-only.

## Demo video script (~2 min)

1. **Connect** Freighter on testnet; header shows `ZK real`.
2. **Notes** — create passkey, copy `zk1:testnet:…`, register G… on vault.
3. **Deposit** 0.1 XLM → commitment on-chain (secrets stay local).
4. **Send** to your own zk1 or a friend's registered G… — show `ProveProgress`, ~10–60s browser prove.
5. **Withdraw** to a public G… address — observer cannot link deposit tx to withdraw tx.
6. Mention: UTXO privacy model, height-16 tree cap, not audited.

**Web wallet config** (`web/.env.local`):

```
NEXT_PUBLIC_VAULT_CONTRACT_ID=CDICJZDBJLGFDGRNJRKLQDFFPBZOUSMXO76ETBYLQSOGYVGWKNKLVSQP
ZK_MOCK_PROOF=false
NEXT_PUBLIC_ZK_MOCK_PROOF=false
```

### Wallet features

- **zk1 receive address** — X25519 key derived from passkey
- **On-chain G… registry** — register zk1 receive key once; others can send to your G… address
- **On-chain encrypted notes** — AES-GCM ciphertext + ephemeral key in `ShieldedSendEvent`
- **Passkey root (WebAuthn PRF)** — no seed phrase; Touch ID / Face ID derives note secrets
- **Recovery passkey** — backup authenticator wraps root seed for cross-device recovery
- **Chain rescan** — recover deposits via vault events + derivation index scan
- **Stellar Wallets Kit** — Freighter, xBull, Albedo, Lobstr, WalletConnect, and more

## Architecture

```
web/          → Next.js wallet (Stellar Wallets Kit + passkey + IndexedDB notes)
circuits/     → Noir transfer_actions circuit (MAX 4×4)
contracts/    → Soroban vault + verifier
cli/          → Rust developer CLI
```

See [design spec](docs/superpowers/specs/2026-06-13-utxo-private-payment-design.md), [mainnet readiness plan](docs/superpowers/plans/2026-06-14-mainnet-readiness.md), and [threat model](docs/threat-model.md).

## Prerequisites

- [Rust](https://rustup.rs/) 1.85+
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli) 25+
- [Noir / Nargo](https://noir-lang.org/docs/getting_started/quick_start) (`noirup`)
- Node.js 20+
- Barretenberg `bb` — `./scripts/install_zk_tools.sh` (required for real ZK; optional for mock demo)

## Quick start

```bash
# Circuit tests
cd circuits/transfer_actions && nargo test

# Contract tests (11 tests incl. withdraw + negative paths)
cd contracts && cargo test -p vault

# Web wallet
cp web/.env.local.example web/.env.local
cd web && npm install && npm run dev

# Headless testnet E2E
STELLAR_SOURCE=admin ./scripts/e2e_testnet.sh --flow all

# Dual-account: Alice deposit → send to Bob's G… → Bob withdraw
./scripts/prepare_e2e_accounts.sh --fund alice bob
ZK_MOCK_PROOF=false ./scripts/e2e_testnet.sh --flow alice-bob
```

## Status

| Layer | Testnet demo | Real ZK (staging) |
|-------|--------------|-------------------|
| Vault + registry | ✅ deployed | ✅ UltraHonk verifier (~76M insn) |
| Web flows | ✅ deposit / send / withdraw | ✅ browser + CLI proving |
| Proofs | MockVerifier (`ZK_MOCK_PROOF=true`) | `@aztec/bb.js` in browser + `bb` CLI |
| CI | ✅ circuits + contracts + web build | + real-ZK E2E job (optional) |

### Testnet contracts

**Demo (mock verifier):**

| Contract | ID |
|----------|-----|
| Vault | `CBVWCBO7AZNHDACZDDCYS2ZMZHDMG3URJX7FXMZ6YIPKMBVYHFLDKLGY` |
| MockVerifier | `CBEVEL2RO4K7HCJR7IWA5EJXXH4YKDIH4GVILKRPC4L6SOBXUMKK7IKW` |
| Native XLM SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

**Real ZK (`--real-zk`, keccak UltraHonk):**

| Contract | ID |
|----------|-----|
| Vault | `CDICJZDBJLGFDGRNJRKLQDFFPBZOUSMXO76ETBYLQSOGYVGWKNKLVSQP` |
| UltraHonk Verifier | `CAKHTZW4TFTKDJVYX4EBCBGAQG7KOJTF56OJFBWLHTYGYADPLZ53WWLN` |

```bash
./scripts/deploy_testnet.sh   # demo: mock verifier
# Real ZK staging:
./scripts/install_zk_tools.sh && ./scripts/build_vk.sh && ./scripts/build_ultrahonk_verifier.sh
STELLAR_SOURCE=admin ./scripts/deploy_testnet.sh --real-zk
# See docs/deploy.md
```

### Environment

| Variable | Demo | Real ZK |
|----------|------|---------|
| `ZK_MOCK_PROOF` | `true` | **`false`** |
| `NEXT_PUBLIC_ZK_MOCK_PROOF` | `true` | **`false`** (browser proving) |
| `NEXT_PUBLIC_VAULT_LEGACY_SEND` | `false` | `false` |

## Known limitations (mainnet)

- Up to 4 inputs and 4 outputs per transaction (change outputs supported)
- Merkle tree height 16 (~65k commitments)
- Single token (native XLM SAC)
- No ASP / compliance layer
- Server-side prove API is fallback only — **browser `bb.js`** is the default when `NEXT_PUBLIC_ZK_MOCK_PROOF=false`

Report security issues via [SECURITY.md](SECURITY.md).

## License

Apache-2.0
