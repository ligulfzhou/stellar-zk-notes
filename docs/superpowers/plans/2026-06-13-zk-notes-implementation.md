# zk-notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Wild-tier UTXO private payment system on Stellar testnet with a full web wallet and browser-side Noir proving.

**Architecture:** Noir `spend_note` circuit proves note ownership and nullifier correctness; Soroban `vault` contract maintains a commitment Merkle tree and nullifier set; UltraHonk verifier contract validates proofs; Next.js wallet handles notes, proving (bb.js), and Freighter signing.

**Tech Stack:** Noir 1.0.0-beta, Soroban (Rust), UltraHonk verifier, Next.js 15, Tailwind, Zustand, Freighter, bb.js, IndexedDB.

**Spec:** `docs/superpowers/specs/2026-06-13-utxo-private-payment-design.md`

---

## File Map

| Path | Responsibility |
|------|----------------|
| `circuits/spend_note/` | Noir spend circuit + tests |
| `contracts/contracts/vault/` | Merkle tree, nullifiers, deposit/spend/withdraw |
| `contracts/contracts/verifier/` | UltraHonk verifier (submodule, Day 7) |
| `web/` | Next.js wallet UI |
| `cli/zk-notes/` | Rust dev/debug CLI |
| `scripts/demo.sh` | End-to-end demo script |

---

## Phase 1: Foundation (Days 1–2)

### Task 1: Repo scaffold

- [x] Root README, .gitignore, design spec
- [x] Noir project `circuits/spend_note`
- [x] Soroban workspace `contracts/`
- [ ] Next.js `web/`
- [ ] Rust CLI `cli/zk-notes`

### Task 2: Note cryptography (shared logic)

**Files:**
- Create: `web/src/lib/note.ts`
- Create: `cli/zk-notes/src/note.rs`

- [ ] Define `Note` struct and commitment/nullifier helpers
- [ ] Unit tests for deterministic hash outputs

### Task 3: `spend_note` circuit scaffold

**Files:**
- Modify: `circuits/spend_note/src/main.nr`
- Modify: `circuits/spend_note/Nargo.toml`

- [ ] Add Poseidon2 dependency
- [ ] Implement commitment + nullifier checks
- [ ] Add Merkle inclusion stub (height 16)
- [ ] Run `nargo test` / `nargo check`

### Task 4: Vault contract scaffold

**Files:**
- Modify: `contracts/contracts/vault/src/lib.rs`
- Create: `contracts/contracts/vault/src/merkle.rs`
- Create: `contracts/contracts/vault/src/storage.rs`

- [ ] Replace hello-world with `Vault` contract
- [ ] Implement incremental Merkle tree insert
- [ ] Implement `deposit(token, amount, commitment)`
- [ ] Run `cargo test` in contracts workspace

### Task 5: Web wallet shell

**Files:**
- Create: `web/` via create-next-app
- Create: `web/src/app/page.tsx`, layout, globals

- [ ] Freighter connect button
- [ ] Dashboard layout (balance cards, nav)
- [ ] Zustand store skeleton

---

## Phase 2: Proving Pipeline (Days 3–8)

### Task 6: Complete `spend_note` circuit

- [ ] Merkle path verification (height 16)
- [ ] Mode 0: shielded send (new commitment)
- [ ] Mode 1: withdraw (public amount conservation)
- [ ] `nargo execute` + witness tests

### Task 7: Integrate UltraHonk verifier

- [ ] Add verifier submodule
- [ ] Deploy verifier to local/testnet
- [ ] Vault calls `verify_proof`

### Task 8: `shielded_send` + `withdraw` contract methods

- [ ] Nullifier double-spend check
- [ ] Token transfer on withdraw
- [ ] Contract events

### Task 9: Browser proving POC

- [ ] `bb.js` proof generation in `web/src/lib/prover.ts`
- [ ] Load circuit bytecode / vk artifacts
- [ ] Progress UI for proving

---

## Phase 3: Web Flows (Days 9–12)

### Task 10: IndexedDB note vault

- [ ] Store/import/export notes JSON
- [ ] Mark notes spent/unspent

### Task 11: Deposit flow

- [ ] Generate note client-side
- [ ] Submit deposit tx via Freighter

### Task 12: Shielded send flow

- [ ] Generate proof in browser
- [ ] Submit shielded_send tx

### Task 13: Withdraw flow

- [ ] Select note, prove, withdraw to public address

### Task 14: Activity feed

- [ ] Parse contract events into timeline

---

## Phase 4: Ship (Days 13–14)

### Task 15: Polish + docs

- [ ] `docs/architecture.md` + comparison table
- [ ] Testnet contract IDs in README
- [ ] `scripts/demo.sh`

### Task 16: Hackathon submission

- [ ] 2–3 min demo video
- [ ] DoraHacks BUIDL submit

---

## Verification Commands

```bash
# Circuit
cd circuits/spend_note && nargo test

# Contracts
cd contracts && cargo test

# Web
cd web && npm run build

# CLI
cd cli/zk-notes && cargo test
```
