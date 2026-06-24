# zk-notes

Tornado-style privacy pools on Stellar — fixed denominations, browser ZK proofs, Passkey wallet, relayer-assisted exit.

**Hackathon:** [Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk/detail)  
**Category:** Privacy pool / mixer on transparent L1 (Soroban)

## What it does

- **Deposit** — enter any whole XLM amount; split into 1 / 10 / 100 XLM fixed pools; only commitment + leaf index on-chain
- **Exit** — browser ZK proof burns note; relayer submits tx and earns on-chain fee (Tornado-style gasless withdraw to any G address)

Privacy = **unlinkability** within the pool (deposit address ≠ exit address). Recipient on exit is public by design.

Spending uses Noir `pool_actions` + UltraHonk verified on Soroban. With `NEXT_PUBLIC_ZK_MOCK_PROOF=false`, proofs run **in your browser** (`@aztec/bb.js`).

## Demo video script (~2 min)

1. **Connect** Freighter on testnet; header shows **Real ZK**.
2. **Unlock passkey** (Touch ID / Face ID) — first time registers device key.
3. **Deposit** 10 XLM → commitment on-chain; secrets stay local.
4. **Exit via relayer** → fresh G address receives XLM; tx source is relayer, not your deposit wallet.
5. Mention: passkey + rescan (no Tornado note backup), anonymity badge, testnet / not audited.

**Web wallet** (`web/.env.local`):

```
NEXT_PUBLIC_VAULT_CONTRACT_ID=<vault>
ZK_MOCK_PROOF=false
NEXT_PUBLIC_ZK_MOCK_PROOF=false
NEXT_PUBLIC_PRIVACY_MODE=strict
NEXT_PUBLIC_RELAYER_URL=http://127.0.0.1:8787
```

Start relayer: `cd scripts/relayer && npm install && RELAYER_SECRET=SD... VAULT_ID=<vault> npm run server`

### Wallet features

- **Passkey root (WebAuthn PRF)** — derive note secrets; no 12-word phrase
- **Recovery passkey** — backup authenticator for cross-device unlock
- **Rescan from chain** — recover your deposits via join events + passkey indices
- **Pool anonymity badge** — weak / medium / strong from live pool size
- **Relayer exit** — `/exit` submits gasless withdraw; relayer earns fee on-chain
- **Stellar Wallets Kit** — Freighter and other Stellar wallets

## Architecture

```
web/          → Next.js wallet (Passkey + IndexedDB notes)
circuits/     → Noir pool_actions (join + exit; transfer path unused in UI)
contracts/    → Soroban vault + UltraHonk verifier (3 denomination pools)
scripts/relayer/ → POST /exit, POST /submit
```

See [threat model](docs/threat-model.md) and [deploy](docs/deploy.md).

## Prerequisites

- [Rust](https://rustup.rs/) 1.85+
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli) 25+
- [Noir / Nargo](https://noir-lang.org/docs/getting_started/quick_start)
- Node.js 20+
- Barretenberg `bb` — `./scripts/install_zk_tools.sh` (for real ZK)

## Quick start

```bash
cd circuits/pool_actions && nargo test
cd contracts && cargo test -p vault

cp web/.env.local.example web/.env.local
cd web && npm install && npm run dev

# E2E: deposit → exit (requires funded accounts + relayer for strict mode)
./scripts/prepare_e2e_accounts.sh --fund alice
STELLAR_SOURCE=admin ./scripts/e2e_testnet.sh --flow phase-c
```

## Status

| Layer | Testnet |
|-------|---------|
| Vault join / exit | ✅ fixed 1/10/100 XLM pools |
| Web wallet | ✅ deposit / exit / rescan |
| Relayer | ✅ `/exit` + `/submit` |
| In-pool payments | ❌ removed (Phase B: contract + circuit exit-only) |

## Known limitations

- Merkle height 16 (~65k commitments per pool)
- Native XLM SAC only
- Exit recipient not bound in-circuit (front-running possible)
- Not audited — testnet demo only
- Join/exit relayer does not hide deposit G on join tx (only exit tx source is relayer)

Report security issues via [SECURITY.md](SECURITY.md).

## License

Apache-2.0
