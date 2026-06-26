# zk-tornado

Tornado-style privacy pools on Stellar — fixed denominations, browser ZK proofs, Passkey wallet, relayer-assisted exit.

**Hackathon:** [Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk/detail)  
**Category:** Privacy pool / mixer on transparent L1 (Soroban)

## What it does

- **Deposit** — enter any whole XLM amount; split into 1 / 10 / 100 XLM fixed pools; only commitment + leaf index on-chain
- **Exit** — browser ZK proof burns note; relayer submits tx and earns on-chain fee (Tornado-style gasless withdraw to any G address)

Privacy = **unlinkability** within the pool (deposit address ≠ exit address). Recipient on exit is public by design.

Spending uses Noir `pool_actions` + UltraHonk verified on Soroban. With `NEXT_PUBLIC_ZK_MOCK_PROOF=false`, proofs run **in your browser** (`@aztec/bb.js`).

## How it works (technical overview)

For judges and reviewers: the demo video shows the **user flow**; this section explains **what runs where**.

### End-to-end flow

```
Deposit (join_pool)                Exit (exit_pool)
─────────────────                  ─────────────────
Freighter signs XLM transfer  →    Browser builds witness + UltraHonk proof
Passkey derives note secrets       Relayer (or self) submits signed tx
commitment = Poseidon2(v, s, ns,    Verifier checks proof; vault burns nullifier
  deposit_secret, pool_id)         Recipient receives pool amount − relayer fee
Only commitment + leaf on-chain    Exit tx source can be relayer ≠ deposit wallet
```

### Note & commitment (off-chain)

Each deposit is a **UTXO-style note** stored in the browser (IndexedDB), never sent to a server:

| Field | Role |
|-------|------|
| `value` | Fixed pool denomination (1 / 10 / 100 XLM in stroops) |
| `secret`, `nullifier_secret` | Spend authority; derived from passkey root |
| `deposit_secret` | Extra entropy for commitment v2 (domain separation) |
| `pool_id` | Which denomination tree (0 / 1 / 2) |
| `leafIndex` | Position in that pool’s Merkle tree |

**Commitment v2** (Noir `note_hash` circuit, Poseidon2):

```
commitment = hash(value, secret, nullifier_secret, deposit_secret, pool_id)
nullifier  = hash(nullifier_secret, commitment)
```

**Passkey (WebAuthn PRF)** derives `(secret, nullifier_secret, deposit_secret)` from a device-bound root — no 12-word backup for your own deposits. **Rescan from chain** matches join events to passkey derivation indices by recomputing commitments locally.

### ZK circuit (`circuits/pool_actions`)

Exit-only in Phase B: spend 1–4 note slots (UI uses 1), **no shielded outputs**.

The proof demonstrates (without revealing which leaf):

1. Spend slot has valid **commitment** and **nullifier** for the chosen `pool_id`
2. Commitment is a **member** of the on-chain Merkle tree (`merkle_root` public input)
3. `public_amount` equals the pool join amount (fixed denomination)
4. `new_commitment[]` are all zero (exit-only, not in-pool transfer)
5. `relayer_fee ≤ public_amount`

**Public inputs** (384 bytes = 12×32 → Soroban verifier): `pool_id`, `merkle_root`, four nullifier slots, four new-commitment slots, `public_amount`, `relayer_fee`.

**Proving stack:** Noir witness in browser → `@aztec/bb.js` UltraHonk (keccak) → `exit_pool` passes proof bytes to verifier contract.

### On-chain (Soroban)

| Contract | Responsibility |
|----------|----------------|
| **Vault** | Three independent Merkle trees (height 16); `join_pool` / `exit_pool`; nullifier set; min pool size (3 on testnet) |
| **Verifier** | UltraHonk `verify_proof(public_inputs, proof)` |
| **Native XLM SAC** | Token transfers on join/exit |

Join events expose **commitment + leaf index** (no depositor address in the privacy-oriented event shape). Exit events expose **nullifier** (no recipient in event — recipient is in tx args).

### Relayer

Optional HTTP service (`scripts/relayer`):

- Client sends pre-built proof + public inputs + recipient
- Relayer signs and submits `exit_pool`, pays Soroban fee, receives on-chain **relayer fee**
- Improves **unlinkability of tx submitter** (deposit wallet ≠ exit tx source); does not hide recipient address

### Where computation runs

| Step | Location |
|------|----------|
| Note secrets, witness, ZK proof | Browser only |
| Merkle commitments for exit | Fetched from vault contract (`get_commitment_at`, parallel) — no full event scan on exit path |
| Rescan / dashboard activity | Soroban RPC event pagination (slower; indexer planned) |
| Proof verification | Soroban verifier contract |
| XLM movement | Native SAC via vault |

### Testnet deployment (Phase B, Real ZK)

| Artifact | ID |
|----------|-----|
| Vault | `CCSA45EVCX3JJDE5OIGJFGWAQPYWD65MMTQZKL66ZILZDMVAUXZXLV4H` |
| Verifier | `CA6RD6K36U3QERNRMX6DBDK6ZP2VRSCXSD7MSMLJ22NDAIQWJKQ57CFR` |
| Native XLM SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

See [architecture](docs/architecture.md) — **full system diagram** (join → pools → exit → ZK), [threat model](docs/threat-model.md), [deploy](docs/deploy.md), [demo script](docs/demo-script-en.md).

## Demo video script (~2 min)

1. **Connect** Freighter on testnet.
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
circuits/     → Noir pool_actions (exit-only; note_hash, hash_pair helpers)
contracts/    → Soroban vault + UltraHonk verifier (3 denomination pools)
scripts/relayer/ → POST /exit, POST /submit
```

**Documentation**

| Doc | Contents |
|-----|----------|
| [architecture.md](docs/architecture.md) | Merkle tree, witness/proof pipeline, public input layout, API, relayer |
| [threat-model.md](docs/threat-model.md) | Trust boundaries, adversaries |
| [deploy.md](docs/deploy.md) | Testnet deploy, Real ZK flags |
| [demo-script-en.md](docs/demo-script-en.md) | 2–3 min hackathon video script |

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
