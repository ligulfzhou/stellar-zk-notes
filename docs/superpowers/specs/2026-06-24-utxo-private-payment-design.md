# zk-utxo: UTXO-Style Private Payment on Stellar

**Date:** 2026-06-24  
**Status:** Approved  
**Hackathon:** [Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk/detail)  
**Category:** Wild — UTXO-style private payment system  
**Sibling project:** [`zk`](../zk) — Tornado-style denomination privacy pools (separate submission)

---

## Goal

Build a **full-featured** ZK-native UTXO note system on Stellar: arbitrary-amount notes, multi-input/output shielded transfers with change, on-chain withdraw, and relayer-assisted privacy for deposit/transfer/exit. Deliver as a production-grade web wallet with browser-side proof generation.

**Not in scope for v1:** ASP/compliance, multi-token, recursive proof aggregation, mainnet deployment without audit.

---

## Problem Statement

Stellar payments are fully transparent. This project implements a **note-based UTXO model** where commitments and nullifiers appear on-chain, while note values and transfer graphs stay hidden inside ZK proofs. Unlike fixed-denomination mixers, users can hold notes of any amount, merge inputs, pay multiple recipients in one transaction, and receive change — matching real payment workflows.

---

## Differentiation vs `zk` (Tornado) and Others

| Dimension | `zk` (Tornado) | `zk-utxo` (this project) | Nethermind | Moonlight |
|-----------|----------------|--------------------------|------------|-----------|
| Model | Fixed-denomination pools | **Arbitrary UTXO notes** | Account pool + ASP | Address splitting |
| Circuit | `pool_actions` (exit-only in pool) | **`utxo_actions` (4×4 general)** | Circom | Non-ZK |
| Payments | Same-pool, fixed amounts | **Multi-in, multi-out, change** | Reference PoC | SDK |
| Withdraw | Relayer exit primary | **On-chain + relayer (equal)** | ASP-gated | N/A |
| Anonymity set | Per denomination pool | **Single global tree** | Pool | N/A |
| Narrative | Privacy mixer | **Private payment system** | Protocol ref | Engineering privacy |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Web Wallet (Next.js)                          │
│  Passkey PRF · Coin selection · zk1 addresses · bb.js prover   │
│  IndexedDB note vault · Strict mode → relayer submit             │
└────────────────────────────┬────────────────────────────────────┘
                             │ Soroban RPC / relayer HTTP
┌────────────────────────────▼────────────────────────────────────┐
│                   Soroban Vault Contract                         │
│  Single Merkle tree (height 16) · Nullifier set · Token custody │
│  deposit · shielded_transfer · withdraw · exit_via_relayer      │
└────────────────────────────┬────────────────────────────────────┘
                             │ verify_proof()
┌────────────────────────────▼────────────────────────────────────┐
│              UltraHonk Verifier (community dep)                  │
│              Circuit: utxo_actions                                 │
└─────────────────────────────────────────────────────────────────┘

Off-chain: Noir utxo_actions → Barretenberg → proof bytes
Relayer:   deposit / shielded_transfer / exit submission (strict mode)
```

---

## Note Model (v1)

```
Note {
  value: u64              // stroops
  secret: Field
  nullifier_secret: Field
  owner_x25519: Bytes32   // zk1 receive key (client-side only)
}

commitment = poseidon2(value, secret, nullifier_secret)   // note_hash circuit
nullifier  = poseidon2(nullifier_secret, commitment)
```

- Notes stored **client-side only** (passkey-derived secrets + IndexedDB).
- Receive address: `zk1:testnet:<x25519-hex>` — no on-chain `register_shielded_key`.
- Loss of passkey without recovery = loss of funds.

**Not used:** `commitment_v2`, `pool_id`, `deposit_secret` (those belong to `zk` Tornado pools).

---

## Circuit: `utxo_actions`

**Base:** `zk/circuits/transfer_actions` (4-in-4-out, v1 commitment, balance conservation).  
**Add:** `relayer_fee` public input (from `pool_actions` pattern).  
**Remove:** `pool_id`, `deposit_secret`, fixed-denomination constraints.

### Constraints

- `MAX_SPENDS = 4`, `MAX_OUTPUTS = 4`, `TREE_HEIGHT = 16`
- Per spend slot: if `nullifier != 0`, verify commitment + Merkle inclusion
- Per output slot: if `new_commitment != 0`, verify commitment recomputation
- `sum(spend_values) == sum(output_values) + public_amount`
- If `public_amount > 0`: all `new_commitment[i] == 0` (withdraw/exit modes)
- `relayer_fee <= public_amount` when `public_amount > 0`
- If `public_amount == 0`: `relayer_fee == 0` (shielded transfer)

### Public inputs (11 fields × 32B = 352 bytes)

```
merkle_root
nullifier[4]
new_commitment[4]
public_amount
relayer_fee
```

### Modes (via public inputs, single circuit)

| Mode | public_amount | relayer_fee | outputs | Contract entry |
|------|---------------|-------------|---------|----------------|
| Shielded transfer | 0 | 0 | 1–4 commitments | `shielded_transfer` |
| On-chain withdraw | note value | 0 | all zero | `withdraw` |
| Relayer exit | note value | fee ≤ amount | all zero | `exit_via_relayer` |

### Supporting circuits

| Circuit | Purpose |
|---------|---------|
| `note_hash` | Client-side commitment (3-field Poseidon2) |
| `hash_pair` | Merkle pair hash (must match contract) |

---

## Smart Contract: `vault`

Single global Merkle tree. **No pools.**

### Functions

| Function | Auth | Description |
|----------|------|-------------|
| `initialize(admin, token, verifier)` | admin | One-time setup |
| `deposit(from, amount, commitment)` | `from` | `token.transfer(from → vault, amount)`; insert commitment; emit `DepositEvent` |
| `shielded_transfer(nullifiers[4], commitments[4], root, proof, epk[4], encrypted_note[4])` | caller or relayer | Verify proof (`public_amount=0`); mark nullifiers; insert outputs; emit `ShieldedSendEvent` per active output |
| `withdraw(recipient, nullifiers[4], root, proof)` | caller | Verify proof; `token.transfer(vault → recipient, public_amount)`; emit `WithdrawEvent` |
| `exit_via_relayer(recipient, relayer, nullifiers[4], root, proof)` | relayer | Verify proof; pay `recipient` = `public_amount - relayer_fee`, `relayer` = `relayer_fee`; emit `ExitEvent` (nullifier only) |
| `get_root()` | view | Current Merkle root |
| `leaf_count()` | view | Commitment count |
| `is_spent(nullifier)` | view | Double-spend check |

### Events

| Event | Fields | Privacy |
|-------|--------|---------|
| `DepositEvent` | `commitment, leaf_index` | Amount visible in Stellar `token.transfer` (unavoidable) |
| `ShieldedSendEvent` | `nullifier, new_commitment, leaf_index, epk, encrypted_note` | Value and parties hidden |
| `WithdrawEvent` | `nullifier, recipient, amount` | Public (on-chain withdraw path) |
| `ExitEvent` | `nullifier` | No recipient/amount in contract events |

### Storage

- Incremental Merkle tree (height 16)
- `Mapping<nullifier, bool>` (persistent)
- Token address, verifier address, admin

---

## Privacy Properties

| ID | Property | Mechanism |
|----|----------|-----------|
| P1 | Deposit unlinkability | `DepositEvent` has no depositor; optional relayer deposit |
| P2 | Deposit amount hiding | **Not achievable** on Stellar public `token.transfer` — document honestly |
| P3 | Withdraw unlinkability | ZK spend + global anonymity set |
| P4 | Withdraw recipient hiding | Relayer exit path |
| P5 | Withdraw amount hiding | Relayer exit path (amount in proof PI, not events) |
| P6 | Identity unlinkability | No on-chain shielded key registration; zk1 offline |
| P7 | Anonymity set | Single global tree (all amounts) |
| P8 | Submitter hiding | Strict mode: relayer submits deposit/transfer/exit |

---

## Web Wallet

### Stack

- Next.js 15 (App Router), Tailwind, Zustand
- Stellar Wallets Kit + Freighter
- `@aztec/bb.js` browser WASM proving
- IndexedDB note vault
- WebAuthn PRF passkey

### Screens / Flows

| Screen | Features |
|--------|----------|
| **Dashboard** | Shielded balance, public XLM, activity feed, privacy mode badge |
| **Deposit** | Arbitrary XLM; optional note splitting; optional relayer submit |
| **Send** | Coin selection (auto + manual); multi-recipient (≤4 outputs); change; zk1 + ECDH delivery; strict relayer submit |
| **Withdraw** | Toggle: on-chain vs relayer exit; fee config; `ProveProgress` |
| **Notes** | List unspent/spent; export/import vault; passkey unlock; chain rescan |

### Coin selection

- **Auto:** largest-first greedy to minimize input count
- **Manual:** user selects notes to merge
- **Change:** auto-compute change output when `sum(inputs) > target`
- **Multi-pay:** distribute to up to 4 recipients in one `shielded_transfer`

### Privacy modes

| Mode | Behavior |
|------|----------|
| `dev` | User wallet signs all txs directly |
| `strict` | Relayer submits deposit, `shielded_transfer`, and `exit_via_relayer` |

### Environment

```
NEXT_PUBLIC_VAULT_CONTRACT_ID=
NEXT_PUBLIC_ZK_MOCK_PROOF=false
NEXT_PUBLIC_PRIVACY_MODE=strict
NEXT_PUBLIC_RELAYER_URL=http://127.0.0.1:8787
NEXT_PUBLIC_RELAYER_X25519_PUBLIC=
NEXT_PUBLIC_SOROBAN_RPC_URL=
```

---

## Relayer

Port from `zk/scripts/relayer/` with UTXO adaptations:

| Endpoint | On-chain call | Purpose |
|----------|---------------|---------|
| `POST /deposit` | `deposit` | Hide depositor from vault perspective (P1) |
| `POST /submit` | `shielded_transfer` | Hide wallet as tx submitter (P8) |
| `POST /exit` | `exit_via_relayer` | Hide recipient/amount in events (P4/P5) |

Relayer learns recipient + amount for exit payouts (documented in threat model). Users can run their own relayer.

---

## Project Structure

```
zk-utxo/
├── circuits/
│   ├── utxo_actions/       # Primary spend circuit
│   ├── note_hash/
│   └── hash_pair/
├── contracts/
│   ├── contracts/vault/
│   └── contracts/mock-verifier/
├── web/                    # Next.js wallet
├── cli/zk-utxo-notes/      # Rust dev CLI
├── scripts/
│   ├── relayer/
│   ├── e2e/
│   ├── build_vk.sh
│   └── deploy_testnet.sh
├── docs/
│   ├── threat-model.md
│   └── superpowers/
└── README.md
```

---

## Reuse from `zk`

| Copy / adapt | Rewrite for UTXO |
|--------------|------------------|
| `circuits/transfer_actions` → `utxo_actions` (+ relayer_fee) | Vault contract (no pools) |
| `circuits/note_hash`, `hash_pair` | Verifier public input layout |
| `contracts/merkle.rs`, storage patterns | UI: Deposit/Send/Withdraw (not Join/Exit) |
| UltraHonk build/deploy scripts | Remove pool-config, join-decompose, commitment-v2 |
| Web: passkey, note-store, bb.js, ECDH, merkle witness | Coin selection module |
| Relayer framework | E2E flows |
| Privacy audit script | |

---

## Testing & Verification

| Layer | Command |
|-------|---------|
| Circuits | `cd circuits/utxo_actions && nargo test` |
| Contracts | `cd contracts && cargo test -p vault` |
| Budget | `./scripts/measure_utxo_actions_budget.sh` |
| E2E | `./scripts/e2e_testnet.sh --flow full` |
| Privacy | `npx tsx scripts/e2e/privacy-audit.ts` |
| Web | `cd web && npm run build` |

### E2E flow (full)

1. Deposit arbitrary amount (create note)
2. Shielded send with change to second zk1 address
3. Multi-input merge + pay
4. On-chain withdraw
5. Relayer exit
6. Privacy audit pass

---

## Known Limitations (document in README)

1. Deposit Stellar `token.transfer` amount is public
2. Merkle height 16 (~65k commitments)
3. Max 4 inputs and 4 outputs per transaction
4. Single token (native XLM SAC) in v1
5. Relayer trusted for payout honesty in exit path
6. Not audited — testnet only
7. Browser proving ~10–60s per transaction

---

## Success Criteria

1. End-to-end UTXO flows on Stellar testnet via web UI
2. `utxo_actions` proof is load-bearing for all spends
3. Coin selection + multi-recipient + change work correctly
4. Both withdraw paths functional and documented
5. Strict relayer mode covers deposit, transfer, exit
6. Privacy audit script passes
7. Clear README differentiation from `zk` Tornado project
8. Demo video: deposit → multi-send with change → withdraw + relayer exit

---

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Primary circuit | `utxo_actions` (4×4 + relayer_fee) |
| Commitment scheme | v1 (3-field Poseidon2) |
| Merkle tree | Single global, height 16 |
| Withdraw paths | On-chain + relayer (equal priority) |
| Relayer scope | deposit + transfer + exit in strict mode |
| Token | Native XLM SAC (testnet) |
| Quality bar | Full-featured, not minimal demo |
