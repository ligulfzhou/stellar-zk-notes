# zk-notes

UTXO-style private payments on Stellar using zero-knowledge proofs.

**Hackathon:** [Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk/detail)  
**Category:** Wild — UTXO-style private payment system

## What it does

- **Deposit** public tokens into a shielded note (on-chain commitment only)
- **Shielded send** privately transfer a note to another user (zk1 address + on-chain ECDH delivery)
- **Withdraw** to a public Stellar address without revealing the deposit link

ZK is load-bearing: spending requires a Noir proof verified on-chain via UltraHonk.

### Wallet features

- **zk1 receive address** — X25519 key derived from recovery phrase; share `zk1:testnet:…` instead of G… for shielded payments
- **On-chain encrypted notes** — send to zk1 stores AES-GCM ciphertext + ephemeral key in `ShieldedSendEvent`
- **Mnemonic derivation** — deposit secrets from BIP39 + HKDF (`derivationIndex` in IndexedDB)
- **Chain rescan** — recover deposits on a new browser via vault events + trial derivation indices
- **PIN-encrypted phrase** — optional local encryption in Notes tab
- **Payment file fallback** — off-chain JSON when recipient only has a G… address

## Architecture

```
web/          → Next.js wallet (Freighter + bb.js proving + IndexedDB notes)
circuits/     → Noir spend_note circuit
contracts/    → Soroban vault + verifier
cli/          → Rust developer CLI
```

See [design spec](docs/superpowers/specs/2026-06-13-utxo-private-payment-design.md) and [implementation plan](docs/superpowers/plans/2026-06-13-zk-notes-implementation.md).

## Differentiation

| | Nethermind Privacy Pool | Moonlight | zk-notes |
|--|------------------------|-----------|----------|
| Model | Account pool + ASP | Address bundling | ZK UTXO notes |
| Circuits | Circom reference | Non-ZK-native | Self-authored Noir |

## Prerequisites

- [Rust](https://rustup.rs/) 1.85+
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli) 25+
- [Noir / Nargo](https://noir-lang.org/docs/getting_started/quick_start) (`noirup`)
- Node.js 20+

## Quick start

```bash
# Circuit tests
cd circuits/spend_note && nargo test

# Contract tests
cd contracts && cargo test

# Web wallet (after npm install)
cd web && npm install && npm run dev
```

## Status

✅ **Testnet demo live** — mock verifier + full web flows

| Component | Status |
|-----------|--------|
| `spend_note` circuit | 3 tests passing |
| Vault contract | Deployed on testnet (see below) |
| Web wallet | Deposit / send (zk1 + G…) / withdraw + Dashboard + IndexedDB vault |
| UltraHonk proofs | Requires `bb` CLI — see `scripts/prove.sh` |
| Demo mode | `ZK_MOCK_PROOF=true` + MockVerifier on testnet |

### Testnet contracts

> **v2 vault** adds `epk` + `encrypted_note` to `shielded_send`. Redeploy with `./scripts/deploy_testnet.sh` and update `NEXT_PUBLIC_VAULT_CONTRACT_ID` if you see invoke errors.

| Contract | ID |
|----------|-----|
| Vault | `CAQMBCLAIM6ACM2LHKNUYHQUOQKF73NWXASPV6ZTY3JZET72N3HTGM54` |
| MockVerifier | `CDEDBW5XT4X2JANQRHIWD4QW2WWEEIAMZ6ZK43UV55KDMW6E76AJ3DSK` |
| Native XLM SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

```bash
cp web/.env.local.example web/.env.local
# NEXT_PUBLIC_VAULT_CONTRACT_ID is pre-filled in web/.env.local after deploy
cd web && npm run dev

# CLI: derive zk1 address from mnemonic
cargo run -p zk-notes -- shielded-address "twelve words ..."
```

## License

Apache-2.0
