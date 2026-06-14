# Deploy zk-notes (Testnet)

## Prerequisites

- Stellar CLI 25+
- Nargo (`noirup`)
- Barretenberg `bb` (for UltraHonk proofs)
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

This deploys `mock-verifier` (accepts any proof) plus `vault`, and prints `VAULT_ID` for `web/.env.local`.

### Production (UltraHonk)

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
cd web && npm run dev
```

### Current testnet deployment

| Contract | ID |
|----------|-----|
| Vault | `CAQMBCLAIM6ACM2LHKNUYHQUOQKF73NWXASPV6ZTY3JZET72N3HTGM54` |
| MockVerifier | `CDEDBW5XT4X2JANQRHIWD4QW2WWEEIAMZ6ZK43UV55KDMW6E76AJ3DSK` |
| Native XLM SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

Set `ZK_MOCK_PROOF=true` in `web/.env.local` for demo spends without `bb`.

## 5. Generate spend proof

```bash
./scripts/prove.sh
```

Submit `shielded_send` or `withdraw` with `public_inputs` from `Vault.build_public_inputs` and proof bytes from artifacts.

### shielded_send (v2)

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

Share the `zk1:testnet:…` string; recipients decrypt with the same recovery phrase.
