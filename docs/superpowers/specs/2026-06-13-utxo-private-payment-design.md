# zk-notes: UTXO-Style Private Payment on Stellar

**Date:** 2026-06-13  
**Hackathon:** [Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk/detail)  
**Category:** Wild — UTXO-style private payment system  
**Timeline:** 2026-06-15 → 2026-06-29 (14 days)

---

## Goal

Build a self-authored, ZK-native UTXO note system on Stellar where users can deposit public funds, transfer privately between notes, and withdraw to public addresses. Deliver as a consumer-grade web wallet with browser-side proof generation.

**Not in scope:** Forking Nethermind `stellar-private-payments` or Moonlight SDK. Verifier contracts are used as infrastructure dependencies only.

---

## Problem Statement

Stellar payments are fully transparent. Payroll, supplier payments, and P2P transfers expose amounts and counterparty relationships on-chain. This project explores an alternative to account-based privacy pools: a **note-based UTXO model** where only commitments and nullifiers appear on-chain.

---

## Differentiation

| Dimension | Nethermind Privacy Pool | Moonlight | zk-notes (this project) |
|-----------|------------------------|-----------|-------------------------|
| Model | Account-based pool + ASP | Address splitting / bundling | ZK UTXO notes |
| Circuits | Circom (reference PoC) | Non-ZK-native | Self-authored Noir |
| Compliance | ASP membership/non-membership | N/A | Out of MVP scope |
| Client | Browser app on PoC | TypeScript SDK | Rust contracts + full web wallet |
| Narrative | Protocol reference | Engineering privacy | Wild: alternative privacy model |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Web Wallet (Next.js)                     │
│  Freighter · Note vault (IndexedDB) · bb.js WASM prover     │
└──────────────────────────┬──────────────────────────────────┘
                           │ RPC / contract calls
┌──────────────────────────▼──────────────────────────────────┐
│                   Soroban Vault Contract                     │
│  Merkle tree (commitments) · Nullifier set · Token custody  │
└──────────────────────────┬──────────────────────────────────┘
                           │ verify_proof()
┌──────────────────────────▼──────────────────────────────────┐
│              UltraHonk Verifier (community dep)              │
└─────────────────────────────────────────────────────────────┘

Off-chain: Noir `spend_note` circuit → Barretenberg → proof bytes
```

### Note Model

```
Note {
  value: u64            // stroops
  secret: Field
  nullifier_secret: Field
  owner_pubkey: Bytes   // for addressing shielded sends
}

commitment = poseidon2(value, secret, nullifier_secret)
nullifier  = poseidon2(nullifier_secret, commitment)
```

Notes are stored client-side only. Loss of secrets = loss of funds (MVP: export/backup JSON).

---

## On-Chain Operations (MVP)

### 1. Deposit

- User approves token transfer to Vault
- User submits `commitment` (computed client-side)
- Contract inserts commitment into Merkle tree, emits event

**Public:** depositor address, commitment, token type  
**Hidden:** note value (until spent in ZK)

### 2. Shielded Send (1-in-1-out)

- Spender proves ownership of input note in Merkle tree
- Spender reveals `nullifier` (prevents double-spend)
- Spender creates one new `commitment` for recipient
- No change output in MVP (sender must spend exact note value)

**Public:** nullifier, new commitment, merkle root  
**Hidden:** value, sender identity, recipient identity

### 3. Withdraw

- Same `spend_note` circuit with public withdrawal amount
- Contract transfers tokens to explicit Stellar address
- Nullifier recorded

**Public:** nullifier, recipient, amount  
**Hidden:** link to prior deposit sender

---

## Circuits (Noir — self-authored)

### `spend_note` (single circuit for send + withdraw)

**Private inputs:**
- `value`, `secret`, `nullifier_secret`
- Merkle path + indices (tree height = 16, up to 65536 notes)

**Public inputs:**
- `merkle_root`
- `nullifier`
- `new_commitment` (zero field element for pure withdraw-without-new-note variant, or separate `withdraw` entrypoint)
- `public_amount` (0 for shielded send, >0 for withdraw)

**Constraints:**
1. Recompute commitment from secrets
2. Verify Merkle inclusion against `merkle_root`
3. Recompute nullifier correctly
4. Balance: `value == public_amount + new_note_value` (MVP: `new_note_value = 0` for withdraw, `public_amount = 0` for send)
5. If new note: recompute `new_commitment` from provided new secrets (passed as additional private inputs for send)

**MVP simplification:** Two modes via public flag `mode` (0 = shielded send, 1 = withdraw).

### Hash consistency

Use Poseidon2 in Noir circuit matching Stellar host `env.crypto().poseidon2()` for any on-chain hash checks. Merkle tree hashing uses same Poseidon2 in contract.

---

## Smart Contracts (Soroban — self-authored)

### `vault`

| Function | Description |
|----------|-------------|
| `deposit(token, amount, commitment)` | Pull tokens, append commitment to Merkle tree |
| `shielded_send(proof, nullifier, new_commitment, root)` | Verify proof, check nullifier unused, insert new commitment |
| `withdraw(proof, nullifier, recipient, amount, root)` | Verify proof, release tokens, record nullifier |
| `is_spent(nullifier) -> bool` | View |
| `get_root() -> BytesN<32>` | Current Merkle root |

**Storage:**
- Incremental Merkle tree (height 16)
- `Mapping<nullifier, bool>`
- Token balances per token address

### `verifier`

Use community UltraHonk verifier as git submodule or pinned WASM build. Vault stores verification key hash at deploy time.

---

## Web Wallet (Full UX — Option C)

### Stack

- **Framework:** Next.js 15 (App Router)
- **Styling:** Tailwind CSS
- **State:** Zustand
- **Wallet:** `@stellar/freighter-api`
- **Proving:** `@aztec/bb.js` (browser WASM)
- **Chain:** `@stellar/stellar-sdk` + Soroban RPC
- **Note storage:** IndexedDB via `idb-keyval` or Dexie

### Pages / Flows

| Screen | Purpose |
|--------|---------|
| **Onboarding** | Connect Freighter, explain privacy model, optional import notes |
| **Dashboard** | Shielded balance (sum unspent notes), public XLM/USDC, recent activity |
| **Deposit** | Enter amount → generate note secrets → submit commitment + token transfer |
| **Send** | Enter recipient shielded address (pubkey) + amount → generate proof in browser → submit |
| **Withdraw** | Select note → enter destination Stellar address → prove + withdraw |
| **Notes** | List notes (value, status spent/unspent), export backup JSON |
| **Activity** | Parse contract events: deposits, nullifiers, withdrawals |

### UX Requirements (Hackathon Demo)

- Loading states during proof generation (10–60s expected)
- Clear error messages for spent nullifier / invalid proof
- One-click demo mode with pre-funded testnet account (documented in README)
- Mobile-responsive layout (judges may view on phone)

### Parallel Rust CLI

Keep `cli/zk-notes` for developer debugging and `demo.sh` fallback. Web wallet is primary submission surface.

---

## Project Structure

```
zk/
├── circuits/spend_note/       # Noir circuit + tests
├── contracts/
│   ├── vault/                 # Main Soroban contract
│   └── verifier/              # UltraHonk verifier (submodule)
├── cli/zk-notes/              # Rust dev CLI
├── web/                       # Next.js wallet
├── scripts/demo.sh
└── docs/architecture.md
```

---

## 14-Day Schedule (Web-First Parallel)

| Days | Circuits | Contracts | Web |
|------|----------|-----------|-----|
| 1–2 | `spend_note` scaffold + Poseidon2 test | Vault storage design | Next.js scaffold + Freighter connect |
| 3–4 | Merkle inclusion constraints | `deposit` + Merkle insert | Dashboard shell |
| 5–6 | Nullifier + balance constraints | `shielded_send` stub | IndexedDB note store |
| 7–8 | bb.js proof pipeline (CLI first) | Integrate verifier | bb.js browser proving POC |
| 9–10 | Circuit audit / fix | Testnet deploy | Deposit + Withdraw flows |
| 11–12 | — | Integration tests | Shielded Send flow |
| 13 | README + architecture diagram | — | Polish UI + demo mode |
| 14 | Demo video + DoraHacks submit | — | — |

**Risk buffer:** If browser proving too slow by Day 11, record demo with pre-generated proof but UI must still show generate button working.

---

## Submission Checklist

- [ ] Public GitHub repo with README (architecture, limitations, vs Nethermind/Moonlight table)
- [ ] 2–3 min demo video: deposit → shielded send → withdraw
- [ ] Testnet contract IDs in README
- [ ] Open-source Noir circuits + Soroban contracts
- [ ] Honest list of MVP limitations (no change output, no ASP, height-16 tree cap)

---

## MVP Limitations (document honestly)

1. Fixed 1-in-1-out, no change notes
2. Merkle tree height 16 (max ~65536 commitments before rebuild)
3. No ASP / compliance layer
4. Single token (testnet USDC or native XLM)
5. Note backup is manual JSON export
6. Not audited — testnet only

---

## Success Criteria

1. End-to-end flow works on Stellar testnet via web UI
2. ZK proof is load-bearing for spend/withdraw
3. On-chain observer cannot link deposit address to withdraw address via amounts
4. Demo video clearly explains UTXO privacy model
5. Project is clearly self-authored (not Nethermind fork)

---

## Open Decisions

- **Token:** Testnet USDC vs XLM (decide Day 1 based on faucet availability)
- **Verifier repo:** Pin `yugocabrio/rs-soroban-ultrahonk` or `indextree/ultrahonk_soroban_contract` after spike on Day 1
