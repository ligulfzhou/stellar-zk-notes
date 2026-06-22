# zk-notes

UTXO-style private payments on Stellar using zero-knowledge proofs.

**Hackathon:** [Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk/detail)  
**Category:** Wild — UTXO-style private payment system

## What it does

- **Join pool** — fixed-denomination shielded notes (1 / 10 / 100 XLM pools); only commitment appears on-chain
- **Shielded send** — private transfer via zk1 address or pasted X25519 key (ECDH-encrypted note delivery)
- **Exit pool** — ZK proof burns note; relayer pays recipient off-chain (no amount/recipient in vault events)

Spending requires a Noir `pool_actions` proof (up to 4 inputs + 4 outputs) verified on-chain via UltraHonk. With `NEXT_PUBLIC_ZK_MOCK_PROOF=false`, proofs are generated **in your browser** (`@aztec/bb.js`); mock verifier is demo-only.

## Demo video script (~2 min)

1. **Connect** Freighter on testnet; header shows `ZK real`.
2. **Notes** — create passkey, copy `zk1:testnet:…` (no on-chain registration required).
3. **Join** 1 XLM pool → commitment on-chain (secrets stay local).
4. **Send** to a friend's zk1 address — show `ProveProgress`, ~10–60s browser prove.
5. **Exit** — relayer pays your public G… address; observer cannot link join to exit from vault events alone.
6. Mention: denomination pools, anonymity set badge, height-16 tree cap, not audited.

**Web wallet config** (`web/.env.local`):

```
NEXT_PUBLIC_VAULT_CONTRACT_ID=<phase-c-vault>
ZK_MOCK_PROOF=false
NEXT_PUBLIC_ZK_MOCK_PROOF=false
NEXT_PUBLIC_PRIVACY_MODE=strict
NEXT_PUBLIC_RELAYER_URL=http://127.0.0.1:8787
NEXT_PUBLIC_RELAYER_X25519_PUBLIC=<relayer-x25519-hex>
```

### Wallet features

- **zk1 receive address** — X25519 key derived from passkey; primary receive path (no chain registration)
- **Pool anonymity badge** — weak / medium / strong from live `pool_leaf_count`
- **On-chain encrypted notes** — AES-GCM ciphertext (512-byte padded) + ephemeral key in `ShieldedSendEvent`
- **Relayer submission** — `strict` privacy mode posts signed XDR to relayer `/submit` (hides submitter link)
- **Passkey root (WebAuthn PRF)** — no seed phrase; Touch ID / Face ID derives note secrets
- **Recovery passkey** — backup authenticator wraps root seed for cross-device recovery
- **Chain rescan** — recover joins via vault events + derivation index scan
- **Stellar Wallets Kit** — Freighter, xBull, Albedo, Lobstr, WalletConnect, and more

## Architecture

```
web/          → Next.js wallet (Stellar Wallets Kit + passkey + IndexedDB notes)
circuits/     → Noir pool_actions circuit (MAX 4×4, commitment v2)
contracts/    → Soroban vault + verifier (3 denomination pools)
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
cd circuits/pool_actions && nargo test

# Contract tests
cd contracts && cargo test -p vault

# Web wallet
cp web/.env.local.example web/.env.local
cd web && npm install && npm run dev

# Phase C testnet E2E (join → send → exit → privacy audit)
./scripts/prepare_e2e_accounts.sh --fund alice bob
STELLAR_SOURCE=admin ./scripts/e2e_testnet.sh --flow phase-c

# Privacy audit only
npx tsx scripts/e2e/privacy-audit.ts --vault $VAULT_ID
```

## Status

| Layer | Testnet demo | Real ZK (staging) |
|-------|--------------|-------------------|
| Vault + pools | ✅ join / send / exit | ✅ UltraHonk pool_actions verifier |
| Web flows | ✅ join / send / exit + privacy badge | ✅ browser + CLI proving |
| Proofs | MockVerifier (`ZK_MOCK_PROOF=true`) | `@aztec/bb.js` in browser + `bb` CLI |
| CI | ✅ circuits + contracts + web build | + `pool_actions` nargo test |

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
| `NEXT_PUBLIC_PRIVACY_MODE` | `dev` | **`strict`** (relayer submit) |
| `NEXT_PUBLIC_RELAYER_URL` | optional | relayer `http://host:8787` |

## Known limitations (mainnet)

- Up to 4 inputs and 4 outputs per transaction (change outputs supported)
- Merkle tree height 16 (~65k commitments)
- Single token (native XLM SAC)
- No ASP / compliance layer
- Server-side prove API is fallback only — **browser `bb.js`** is the default when `NEXT_PUBLIC_ZK_MOCK_PROOF=false`

Report security issues via [SECURITY.md](SECURITY.md).

## License

Apache-2.0
