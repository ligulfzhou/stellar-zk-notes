# zk-utxo key derivation (unified mnemonic)

One BIP39 mnemonic controls both the Stellar account and shielded notes.

## Overview

```
BIP39 mnemonic (24 words)
        │
        ▼
   bip39 seed (64 bytes)
        ├──────────────────────────────────────┐
        │                                      │
        ▼                                      ▼
 SEP-0005 Ed25519                    HKDF → shielded master (32 B)
 m/44'/148'/0'                       info: "zk-utxo-master-v1"
        │                                      │
        ▼                                      ├─ spending_sk (field)
 Stellar G… / secret                         ├─ x25519 (per diversifier)
                                              └─ ivk (viewing)
```

## Stellar account (transparent layer)

Follows [SEP-0005](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0005.md):

| Path | Purpose |
|------|---------|
| `m/44'/148'/0'` | Primary Stellar account (`G…`) |
| `m/44'/148'/1'` | Optional secondary account |

Implementation: BIP39 seed → `ed25519-hd-key` → `@stellar/stellar-sdk` `Keypair.fromRawEd25519Seed`.

Used for: paying fees, signing Soroban transactions (deposit, shielded_transfer, withdraw).

## Shielded layer (privacy)

Domain-separated from Stellar paths — **never** use the Stellar secret key as `spending_sk`.

```
shielded_master = HKDF-SHA256(bip39_seed, salt=∅, info="zk-utxo-master-v1", len=32)

spending_sk     = bytes_to_field(HKDF(shielded_master, info="zk-utxo/spending-sk"))
spending_pk     = Poseidon2(spending_sk, DOMAIN_SPENDING_PK)    // hash_pair circuit
nullifier_key   = Poseidon2(spending_sk, DOMAIN_NULLIFIER_KEY)

diversifier d:
  recipient_pk = spending_pk                    if d = 0
             = Poseidon2(spending_pk, d)       if d > 0
  x25519 sk    = HKDF(shielded_master, info="receive-sk/{d}")
```

## Shielded receive address (`zkstellar1…`)

Bech32m payload (v1):

| Field | Size |
|-------|------|
| version | 1 B |
| diversifier | 11 B |
| recipient_pk | 32 B (BN254 field) |
| x25519 pubkey | 32 B |

HRP: `zkstellar` (testnet and mainnet use same HRP; network is implied by connected RPC).

## Wallet products

| Component | Role |
|-----------|------|
| **Web app** (`web/`) | Primary wallet — mnemonic, passkey, local signing, ZK proving in browser |
| **wallet-core** (`packages/wallet-core/`) | Shared derivation and `zkstellar` address codec |
| **Browser extension** (`extension/`) | Paused — MV3 + Noir WASM proved unreliable; use web app instead |

## Backup

Users must save the **24-word mnemonic**. Loss of mnemonic = loss of both `G…` balance control and all shielded notes.
