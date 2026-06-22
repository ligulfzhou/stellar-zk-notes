# Deploy zk-notes (Testnet)

## Prerequisites

- Stellar CLI 25+
- Noir + Barretenberg pinned for UltraHonk: **nargo `1.0.0-beta.9`** + **bb `v0.87.0`** (see `scripts/zk_toolchain.env`)
- Install both: `./scripts/install_zk_tools.sh`
- Freighter wallet funded on testnet

## 1. Build circuits

```bash
cd circuits/spend_note && nargo compile
cd ../note_hash && nargo compile
```

## 2. Deploy verifier

### Demo (no `bb` required)

```bash
export STELLAR_SOURCE=<your-funded-testnet-account>
./scripts/deploy_testnet.sh
```

This deploys `mock-verifier` (accepts any proof) plus `vault`. Set `ZK_MOCK_PROOF=true` in `web/.env.local`.

### Staging (real UltraHonk on testnet)

```bash
./scripts/install_zk_tools.sh      # nargo 1.0.0-beta.9 + bb v0.87.0
rm -rf circuits/spend_note/target  # recompile if you previously used another nargo version
./scripts/build_vk.sh              # spend_note VK → artifacts/spend_note/vk
./scripts/build_ultrahonk_verifier.sh

export STELLAR_SOURCE=<account>
./scripts/deploy_testnet.sh --real-zk
```

Then set `ZK_MOCK_PROOF=false` and `NEXT_PUBLIC_ZK_MOCK_PROOF=false` in `web/.env.local`. Proofs are generated in the browser via `@aztec/bb.js` (keccak oracle); CLI `prove_from_witness.sh` is used by E2E scripts.

### Production (UltraHonk manual)

Follow [indextree/ultrahonk_soroban_contract](https://github.com/indextree/ultrahonk_soroban_contract):

```bash
# After bb writes vk bytes for spend_note circuit
stellar contract deploy \
  --wasm path/to/ultrahonk_soroban_contract.wasm \
  --network testnet \
  --source <ACCOUNT> \
  -- --vk_bytes <VK_HEX>
```

Record `VERIFIER_ID`.

## 3. Deploy vault

```bash
cd contracts
stellar contract build --package vault
stellar contract deploy \
  --wasm target/wasm32v1-none/release/vault.wasm \
  --network testnet \
  --source <ACCOUNT>
```

Initialize:

```bash
stellar contract invoke \
  --id <VAULT_ID> \
  --network testnet \
  --source <ADMIN> \
  -- initialize \
  --admin <ADMIN> \
  --token <NATIVE_XLM_SAC> \
  --verifier <VERIFIER_ID>
```

## 4. Configure web wallet

```bash
cp web/.env.local.example web/.env.local
# Set NEXT_PUBLIC_VAULT_CONTRACT_ID=<VAULT_ID>
# Phase C: NEXT_PUBLIC_PRIVACY_MODE=strict, NEXT_PUBLIC_RELAYER_URL, NEXT_PUBLIC_RELAYER_X25519_PUBLIC
cd web && npm run dev
```

## Relayer (Phase C)

Run a relayer on testnet to submit user-signed txs and pay exit recipients:

```bash
export RELAYER_SECRET=<funded-G-secret>
export RELAYER_X25519_SECRET=<32-byte-hex>
export VAULT_ID=<VAULT_CONTRACT_ID>
export SOROBAN_RPC=https://soroban-rpc.testnet.stellar.gateway.fm

# HTTP POST /submit { "xdr": "<signed>" } on :8787 + exit payout poller
npx tsx scripts/relayer/server.ts
```

Wallet `NEXT_PUBLIC_PRIVACY_MODE=strict` routes signed XDR to `NEXT_PUBLIC_RELAYER_URL/submit`.
Use `dev` mode only for local debugging (direct submit exposes wallet G…).

One-shot exit payout (E2E):

```bash
npx tsx scripts/relayer/server.ts --once
```

Privacy audit:

```bash
npx tsx scripts/e2e/privacy-audit.ts --vault $VAULT_ID
```

Phase C E2E:

```bash
ZK_MOCK_PROOF=false ./scripts/e2e_testnet.sh --flow phase-c
```

### Current testnet deployment

**Demo (mock verifier):**

| Contract | ID |
|----------|-----|
| Vault | `CBVWCBO7AZNHDACZDDCYS2ZMZHDMG3URJX7FXMZ6YIPKMBVYHFLDKLGY` |
| MockVerifier | `CBEVEL2RO4K7HCJR7IWA5EJXXH4YKDIH4GVILKRPC4L6SOBXUMKK7IKW` |
| Native XLM SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

**Real ZK (`--real-zk`):**

| Contract | ID |
|----------|-----|
| Vault | `CC7GU73ZMB7GDQTWGLLVSEVVEBA7GP2AY7TGZHUAZ6HBH3T3SYDNZP4S` |
| UltraHonk Verifier | `CBOH4NCUOT62N6ILEYUYQLVMSJ6NQ77ZACHTSY2APJ3CWWAJXLCJVJQB` |

Set `ZK_MOCK_PROOF=false` and `NEXT_PUBLIC_ZK_MOCK_PROOF=false` in `web/.env.local` after `--real-zk` deploy. Proving defaults to browser `@aztec/bb.js` (keccak); server `/api/prove-witness` is fallback only.

## 5. Generate spend proof

```bash
# From Prover.toml (after nargo execute):
./scripts/prove.sh

# From witness JSON (web / e2e):
./scripts/prove_from_witness.sh /path/to/witness.json
```

Submit `shielded_transfer` or `exit_pool` with 384-byte `public_inputs` (pool_id + exit_hash) and proof bytes from `pool_actions` artifacts.

### shielded_transfer (Phase C)

```bash
stellar contract invoke --id <VAULT_ID> --network testnet --source <ACCOUNT> -- \
  shielded_send \
  --nullifier <BYTESN32> \
  --new_commitment <BYTESN32> \
  --merkle_root <BYTESN32> \
  --public_inputs <BYTES> \
  --proof_bytes <BYTES> \
  --epk <BYTESN32> \
  --encrypted_note <BYTES>
```

`epk` is the sender's X25519 ephemeral public key; `encrypted_note` is AES-GCM ciphertext (max 512 bytes). The web wallet encrypts `{value, secret, nullifierSecret, commitment, leafIndex}` for zk1 recipients.

### zk1 addresses

```bash
node scripts/shielded_address.mjs "your twelve words ..." testnet
# or: cargo run -p zk-notes -- shielded-address "..." testnet
```

Share the `zk1:testnet:…` string; recipients decrypt with the same passkey.

### G… shielded registry

Recipients register once so senders can use their Stellar `G…` address:

```bash
stellar contract invoke --id <VAULT_ID> --network testnet --source <ACCOUNT> -- \
  register_shielded_key \
  --owner <G_ADDRESS> \
  --receive_pubkey <X25519_PUBKEY_32_BYTES_HEX>
```

Lookup:

```bash
stellar contract invoke --id <VAULT_ID> --network testnet --source <READER> -- \
  get_shielded_key --owner <G_ADDRESS>
```

## Soroban budget (real UltraHonk)

Verifier uses [NethermindEth/rs-soroban-ultrahonk](https://github.com/NethermindEth/rs-soroban-ultrahonk) (Soroban SDK 26). `verify_proof` costs **~76M** CPU instructions (legacy yugocabrio verifier was ~401M).

```bash
./scripts/measure_spend_note_budget.sh
ZK_MOCK_PROOF=false STELLAR_SOURCE=admin ./scripts/e2e_testnet.sh --flow all
```

**Local validation (unlimited budget):** `./scripts/e2e_localnet.sh --flow all`

## E2E accounts (alice-bob)

```bash
# Generate keys once
stellar keys generate alice
stellar keys generate bob

# Fund via friendbot (uses scripts/proxy.env if friendbot times out)
./scripts/prepare_e2e_accounts.sh --fund alice bob

# Dual-account real ZK
ZK_MOCK_PROOF=false ./scripts/e2e_testnet.sh --flow alice-bob
```

## Mainnet runbook (draft)

### Pre-deploy

1. Pin toolchain: `scripts/zk_toolchain.env` (nargo beta.9, bb v0.87.0).
2. `nargo test` + `cargo test -p vault` + `npm run build` green.
3. `./scripts/measure_spend_note_budget.sh` on target network limits.
4. Review [threat-model.md](threat-model.md) and MVP limitations.

### Deploy

1. Build VK: `./scripts/build_vk.sh`
2. Build verifier WASM: `./scripts/build_ultrahonk_verifier.sh`
3. Deploy verifier with pinned VK bytes (record `VERIFIER_ID`).
4. Deploy vault; `initialize(admin, token, verifier)` — **no mock verifier**.
5. Set `ZK_MOCK_PROOF=false`, `NEXT_PUBLIC_ZK_MOCK_PROOF=false` in production env.

### Post-deploy validation

```bash
ZK_MOCK_PROOF=false STELLAR_SOURCE=<funded> ./scripts/e2e_testnet.sh --flow all
ZK_MOCK_PROOF=false ./scripts/e2e_testnet.sh --flow alice-bob
```

### Incident response

| Symptom | Action |
|---------|--------|
| All spends fail with verifier error | Check VK pin matches `artifacts/spend_note/vk`; redeploy verifier if circuit changed |
| Budget exceeded | Re-run `measure_spend_note_budget.sh`; upgrade verifier crate or reduce vault logic |
| Suspected double-spend | Query `is_spent(nullifier)`; contract should reject replays |
| Client proofs invalid | Confirm `keccak` oracle in bb.js matches on-chain verifier |

### Immutable policy (recommended)

- Do not upgrade vault verifier address without community notice.
- Document contract IDs and VK hash in README after mainnet deploy.

