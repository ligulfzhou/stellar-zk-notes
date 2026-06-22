# Phase C — Strong Privacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a hard-cutover Phase C vault with denomination pools, private join/exit events, commitment v2, and relayer support — achieving P1–P8 from [spec](../specs/2026-06-22-phase-c-privacy-design.md).

**Architecture:** Extend `transfer_actions` → `pool_actions` circuit (commitment v2 + `pool_id` domain separation). Vault stores **3 Merkle trees** (1/10/100 XLM). Replace `deposit`/`withdraw` with `join_pool`/`exit_pool`. Relayer service submits txs; exit payout via ECDH-encrypted blob. **No backward compatibility** with Phase B vault or notes.

**Tech Stack:** Noir 1.0 beta, bb 0.87, UltraHonk Soroban verifier, Soroban SDK, Next.js web wallet, Node relayer (`scripts/relayer/`).

**Spec reference:** [2026-06-22-phase-c-privacy-design.md](../specs/2026-06-22-phase-c-privacy-design.md) §14 decisions locked.

---

## File map (create / modify)

| Area | Create | Modify |
|------|--------|--------|
| Circuit | `circuits/pool_actions/` | — |
| Artifacts | `artifacts/pool_actions/` | `scripts/build_vk_pool_actions.sh`, `scripts/prove_pool_actions.sh`, `scripts/measure_pool_actions_budget.sh` |
| Contract | — | `contracts/contracts/vault/src/lib.rs`, `storage.rs`, `verifier.rs`, `test.rs` |
| Relayer | `scripts/relayer/server.ts`, `scripts/relayer/config.ts` | `package.json` (root or relayer subfolder) |
| Web crypto | `web/src/lib/commitment-v2.ts`, `web/src/lib/exit-crypto.ts`, `web/src/lib/pool-config.ts` | `action-witness.ts`, `stellar.ts`, `noir-runtime.ts` |
| Web UI | `web/src/components/JoinPanel.tsx`, `ExitPanel.tsx`, `PrivacyBadge.tsx` | Replace `DepositPanel`/`WithdrawPanel` flows; `SendPanel`, `NotesPanel`, `DashboardPanel`, `WalletApp.tsx` |
| Events | — | `web/src/lib/vault-events.ts`, `vault-events-serde.ts`, `incoming-scanner.ts`, `rescan-vault.ts` |
| E2E | `scripts/e2e/privacy-audit.ts` | `scripts/e2e/run.ts`, `stellar.ts`, `stellar-cli.ts` |
| Docs | — | `README.md`, `docs/threat-model.md`, `docs/deploy.md`, `web/.env.local.example` |

**Remove from default UX (keep code behind `LEGACY_PHASE_B=false` or delete):** public `deposit`, `withdraw`, on-chain `register_shielded_key` button.

---

## Constants (single source of truth)

Implement in `web/src/lib/pool-config.ts` and mirror in `contracts/contracts/vault/src/pool.rs`:

```typescript
export const POOLS = [
  { id: 0, label: "1 XLM", stroops: 10_000_000n },
  { id: 1, label: "10 XLM", stroops: 100_000_000n },
  { id: 2, label: "100 XLM", stroops: 1_000_000_000n },
] as const;

export const MIN_POOL_SIZE_TESTNET = 3;
export const ENCRYPTED_NOTE_SIZE = 512;
export const ENCRYPTED_EXIT_MAX = 256;
```

Contract:

```rust
pub const POOL_COUNT: u32 = 3;
pub const MIN_POOL_SIZE: u32 = 3; // testnet; document 100 for mainnet claims
pub const JOIN_AMOUNTS: [i128; 3] = [10_000_000, 100_000_000, 1_000_000_000];
```

---

## Milestone C1 — `pool_actions` circuit + multi-pool storage (P7)

**Delivers:** New circuit, VK, budget proof; vault can store 3 pool trees; `min_pool_size` gate.

### Task C1.1: Scaffold `pool_actions` circuit

**Files:**
- Create: `circuits/pool_actions/Nargo.toml`, `circuits/pool_actions/src/main.nr`

- [ ] **Step 1:** Copy `circuits/transfer_actions/` as baseline; rename package to `pool_actions`.

- [ ] **Step 2:** Update commitment + nullifier (5-arg Poseidon):

```noir
fn compute_commitment_v2(
    value: Field,
    secret: Field,
    nullifier_secret: Field,
    deposit_secret: Field,
    pool_id: Field,
) -> Field {
    Poseidon2::hash([value, secret, nullifier_secret, deposit_secret, pool_id], 5)
}
```

- [ ] **Step 3:** Add public inputs: `pool_id: pub Field`, `exit_hash: pub Field` (32-byte field encoding). Keep `merkle_root`, `nullifier[4]`, `new_commitment[4]`, `public_amount`.

- [ ] **Step 4:** In `verify_spend_slot`, when `nullifier != 0`, assert `spend_value[i]` equals pool constant for `pool_id` (witness `expected_join_amount` or derive from public `pool_id` via lookup table in circuit).

- [ ] **Step 5:** Port tests from `transfer_actions`: 1×1 send, 4-in-2-out, withdraw (`public_amount > 0`, `exit_hash != 0`, all `new_commitment == 0`).

Run:

```bash
cd circuits/pool_actions && nargo test
```

Expected: all tests PASS.

- [ ] **Step 6:** Build VK + measure budget:

```bash
./scripts/build_vk_pool_actions.sh
./scripts/measure_pool_actions_budget.sh
```

Expected: verify CPU ≤ 80M insn (buffer over Phase B ~76M).

---

### Task C1.2: Multi-pool Merkle storage in vault

**Files:**
- Create: `contracts/contracts/vault/src/pool.rs`
- Modify: `contracts/contracts/vault/src/storage.rs`, `contracts/contracts/vault/src/lib.rs`, `contracts/contracts/vault/src/verifier.rs`

- [ ] **Step 1:** Extend `DataKey`:

```rust
PoolTree(u32),           // pool_id → MerkleTree
PoolLeafCommitment(u32, u32), // (pool_id, leaf_index)
MinPoolSize,
```

Remove single `MerkleTree` / `LeafCommitment` usage from Phase B paths (hard cutover).

- [ ] **Step 2:** `initialize` sets `MinPoolSize = 3`, empty tree per pool `0..2`.

- [ ] **Step 3:** Add views:

```rust
pub fn get_pool_root(env: Env, pool_id: u32) -> BytesN<32>
pub fn pool_leaf_count(env: Env, pool_id: u32) -> u32
```

- [ ] **Step 4:** Update `verifier.rs`:

```rust
pub const PUBLIC_INPUTS_LEN: u32 = 352; // 11 x 32 bytes
// Layout: pool_id | merkle_root | nullifier[4] | new_commitment[4] | public_amount | exit_hash
```

- [ ] **Step 5:** `apply_transfer` takes `pool_id: u32`; checks `pool_leaf_count(pool_id) >= min_pool_size` before spend (except allow admin test hook if needed).

- [ ] **Step 6:** Write contract tests in `test.rs`:

```rust
#[test]
fn pool_leaf_count_starts_at_zero() { ... }

#[test]
fn spend_reverts_when_pool_below_min_size() { ... }
```

Run: `cargo test -p vault`

Expected: PASS.

---

## Milestone C2 — `join_pool` (P1, P2)

**Delivers:** Private join event; fixed-denom transfer; no `depositor` in events.

### Task C2.1: `join_pool` entrypoint

**Files:**
- Modify: `contracts/contracts/vault/src/lib.rs`

- [ ] **Step 1:** Add event:

```rust
#[contractevent]
pub struct JoinEvent {
    pub pool_id: u32,
    pub commitment: BytesN<32>,
    pub leaf_index: u32,
}
```

- [ ] **Step 2:** Implement:

```rust
pub fn join_pool(env: Env, from: Address, pool_id: u32, commitment: BytesN<32>) {
    from.require_auth();
    assert!(pool_id < POOL_COUNT, "invalid pool");
    let amount = JOIN_AMOUNTS[pool_id as usize];
    // token transfer from → vault (amount fixed)
    // insert commitment into pool_id tree
    JoinEvent { pool_id, commitment, leaf_index }.publish(&env);
}
```

- [ ] **Step 3:** Remove `deposit` and `DepositEvent` (hard cutover).

- [ ] **Step 4:** Tests:

```rust
#[test]
fn join_pool_emits_no_depositor() { /* parse events — only pool_id, commitment, leaf_index */ }

#[test]
fn join_pool_transfers_fixed_amount() { ... }
```

Run: `cargo test -p vault`

---

### Task C2.2: Client join + commitment v2

**Files:**
- Create: `web/src/lib/commitment-v2.ts`
- Modify: `web/src/lib/noir-runtime.ts`, `web/src/components/JoinPanel.tsx` (replace DepositPanel), `web/src/lib/stellar.ts`

- [ ] **Step 1:** `commitment-v2.ts`:

```typescript
export function randomDepositSecret(): Uint8Array { ... }

export async function computeCommitmentV2(params: {
  valueStroops: bigint;
  secret: string;
  nullifierSecret: string;
  depositSecret: Uint8Array;
  poolId: number;
}): Promise<string> { ... } // calls Noir Poseidon t=5
```

- [ ] **Step 2:** `joinPoolOnVault({ poolId, sourcePublicKey, signTransaction })` in `stellar.ts` — calls `join_pool`.

- [ ] **Step 3:** `JoinPanel`: pool picker (1/10/100 XLM), passkey derive secrets, show privacy badge with current `pool_leaf_count`.

- [ ] **Step 4:** Update `WalletApp.tsx` tab `deposit` → `join` label "Join pool".

Run: `cd web && npm run build`

---

### Task C2.3: Event indexer for joins

**Files:**
- Modify: `web/src/lib/vault-events.ts`, `vault-events-serde.ts`

- [ ] **Step 1:** Replace `VaultDepositEvent` with:

```typescript
export type VaultJoinEvent = {
  kind: "join";
  poolId: number;
  commitment: string;
  leafIndex: number;
  ledger: number;
  txHash: string;
};
```

- [ ] **Step 2:** Update `rebuildChainCommitments` to namespace by pool or store `poolId` on notes.

- [ ] **Step 3:** `Note` type gains `poolId`, `depositSecret` (stored encrypted in vault JSON export metadata only if needed for backup — prefer re-derive from passkey + index).

---

## Milestone C3 — `exit_pool` (P3, P4, P5)

**Delivers:** No recipient/amount on-chain; relayer payout path.

### Task C3.1: Exit encryption helper

**Files:**
- Create: `web/src/lib/exit-crypto.ts`

- [ ] **Step 1:**

```typescript
export type ExitPayload = {
  recipient: string;
  amountStroops: string;
  memo?: string;
};

export function encryptExitForRelayer(
  relayerPublicKey: Uint8Array,
  payload: ExitPayload
): { encryptedExit: Uint8Array; exitHashHex: string };

export function decryptExit(relayerSecretKey: Uint8Array, encryptedExit: Uint8Array): ExitPayload;
```

Use same ECDH+AES-GCM pattern as `ecdh-delivery.ts`; `exit_hash = Poseidon2(encrypted_bytes)` via `noir-runtime.ts`.

---

### Task C3.2: `exit_pool` contract entrypoint

**Files:**
- Modify: `contracts/contracts/vault/src/lib.rs`

- [ ] **Step 1:** Event:

```rust
#[contractevent]
pub struct ExitEvent {
    pub pool_id: u32,
    pub nullifier: BytesN<32>,
    pub exit_hash: BytesN<32>,
}
```

- [ ] **Step 2:** Entrypoint:

```rust
pub fn exit_pool(
    env: Env,
    pool_id: u32,
    // same shielded_transfer nullifier/commitment slots...
    merkle_root: BytesN<32>,
    public_inputs: Bytes,
    proof_bytes: Bytes,
    exit_hash: BytesN<32>,
    encrypted_exit: Bytes,
) {
    assert!(encrypted_exit.len() > 0 && encrypted_exit.len() <= 256);
    // verify proof with exit_hash in public inputs, public_amount = JOIN_AMOUNTS[pool_id]
    // NO token.transfer to recipient on-chain
    ExitEvent { pool_id, nullifier, exit_hash }.publish(&env);
}
```

- [ ] **Step 3:** Remove public `withdraw` / `WithdrawEvent`.

- [ ] **Step 4:** Tests: exit emits no recipient; proof with wrong `exit_hash` reverts.

Run: `cargo test -p vault`

---

### Task C3.3: Relayer payout worker

**Files:**
- Create: `scripts/relayer/server.ts`, `scripts/relayer/config.ts`, `scripts/relayer/payout.ts`

- [ ] **Step 1:** Config: `RELAYER_SECRET`, `RELAYER_X25519_SECRET`, `SOROBAN_RPC`, `VAULT_ID`, `HORIZON_URL`.

- [ ] **Step 2:** Poll `getEvents` for `ExitEvent`; for each new `exit_hash`:
  1. Fetch `encrypted_exit` from tx meta / stored IPFS-style or from event companion storage — **store `encrypted_exit` in event** (add to `ExitEvent` as `Bytes` if not already in tx calldata only).

  **Decision:** Include `encrypted_exit` in tx calldata (public bytes but encrypted). Relayer reads from chain; only relayer decrypts.

- [ ] **Step 3:** `payout.ts`: decrypt → `TransactionBuilder` payment `relayer → recipient` for `amountStroops`.

- [ ] **Step 4:** CLI: `npx tsx scripts/relayer/server.ts --once` for E2E.

---

### Task C3.4: Web ExitPanel

**Files:**
- Create: `web/src/components/ExitPanel.tsx`
- Modify: `web/src/lib/action-witness.ts`, `web/src/lib/stellar.ts`, `WalletApp.tsx`

- [ ] **Step 1:** `buildExitWitness` — like withdraw but sets `exit_hash`, `public_amount = pool join amount`.

- [ ] **Step 2:** `exitPoolOnVault({ poolId, encryptedExit, exitHash, ... })`.

- [ ] **Step 3:** UI: recipient G + optional memo; show "Relayer will pay you off-chain of vault events".

- [ ] **Step 4:** Remove `WithdrawPanel` from default tabs.

Run: `npm run build`

---

## Milestone C4 — Off-chain identity (P6)

### Task C4.1: Remove default on-chain register

**Files:**
- Modify: `web/src/components/NotesPanel.tsx`, `web/src/lib/shielded-registry.ts`, `SendPanel.tsx`

- [ ] **Step 1:** Delete or hide "Register on-chain" behind Advanced + warning.

- [ ] **Step 2:** Send panel: require zk1 address or pasted X25519 pubkey only; remove `fetchShieldedKey(ownerG)` auto-resolve in privacy mode.

- [ ] **Step 3:** Payment envelope export remains primary delivery for new recipients.

- [ ] **Step 4:** Update Dashboard copy: "Shielded receive via zk1 — no chain registration needed."

---

## Milestone C5 — Relayer submission (P8)

### Task C5.1: Relayer submit API

**Files:**
- Create: `scripts/relayer/submit.ts`
- Modify: `web/src/lib/stellar.ts`, `web/src/lib/config.ts`

- [ ] **Step 1:** Relayer HTTP POST `/submit` accepts `{ xdr: string }` (user-signed prepared tx).

- [ ] **Step 2:** Web config: `NEXT_PUBLIC_RELAYER_URL` optional.

- [ ] **Step 3:** `signAndSend` path:

```typescript
if (privacyMode === "strict" && RELAYER_URL) {
  await fetch(`${RELAYER_URL}/submit`, { method: "POST", body: JSON.stringify({ xdr: signed }) });
} else {
  await sendTransactionViaApi(signed); // dev fallback, UI warns
}
```

- [ ] **Step 4:** Document in `docs/deploy.md` how to run relayer on testnet.

---

## Milestone C6 — Metadata hardening

### Task C6.1: Fixed-size ciphertext + per-output nullifiers

**Files:**
- Modify: `web/src/lib/ecdh-delivery.ts`, `contracts/contracts/vault/src/lib.rs`

- [ ] **Step 1:** Pad `encrypted_note` to 512 bytes before submit.

- [ ] **Step 2:** Fix `ShieldedSendEvent`: emit `nullifier` per spent slot, not shared `primary_nf`:

```rust
ShieldedSendEvent {
    nullifier: nullifiers[i].clone(), // slot-specific when output i from spend i
    ...
}
```

- [ ] **Step 3:** Update event parser + tests.

---

## Milestone C7 — E2E, audit script, deploy

### Task C7.1: Privacy audit script

**Files:**
- Create: `scripts/e2e/privacy-audit.ts`

- [ ] **Step 1:** Scan vault events; **fail** if any event contains keys: `depositor`, `recipient`, `amount`, `owner` (in new event types).

- [ ] **Step 2:** Heuristic unlink test: N joins, M exits → compute random-match score; print report.

Run:

```bash
npx tsx scripts/e2e/privacy-audit.ts --vault $VAULT_ID
```

---

### Task C7.2: E2E flow rewrite

**Files:**
- Modify: `scripts/e2e/run.ts`, `scripts/e2e/stellar.ts`

- [ ] **Step 1:** Replace `runDeposit` → `runJoin(poolId)`.

- [ ] **Step 2:** Replace `runWithdraw` → `runExit` with relayer `--once` in same script.

- [ ] **Step 3:** Flow `alice-bob`: Alice join → shielded send → Bob exit → relayer payout.

Run:

```bash
ZK_MOCK_PROOF=false STELLAR_SOURCE=admin npx tsx scripts/e2e/run.ts --flow phase-c
```

Expected: all steps OK + privacy-audit PASS.

---

### Task C7.3: Deploy + hard cutover

**Files:**
- Modify: `scripts/deploy_testnet.sh`, `web/.env.local.example`, `README.md`

- [ ] **Step 1:** Deploy new verifier (pool_actions VK) + vault.

- [ ] **Step 2:** Update `.env.local` with new `VAULT_CONTRACT_ID`; add `NEXT_PUBLIC_RELAYER_URL`, `NEXT_PUBLIC_PRIVACY_MODE=strict|dev`.

- [ ] **Step 3:** README: deprecate Phase B vault ID; document 1/10/100 pools, relayer trust, min anonymity set.

- [ ] **Step 4:** Update `docs/threat-model.md` § Out of scope → Phase D ASP; add relayer adversary section.

---

## Milestone C8 — Web witness + prover pipeline

### Task C8.1: Wire `pool_actions` into browser prove

**Files:**
- Modify: `web/src/lib/action-witness.ts`, `web/src/lib/prover-client.ts`, `web/src/app/api/prove-witness/route.ts`, `scripts/sync_noir_circuits.sh`

- [ ] **Step 1:** Sync circuit artifact path `pool_actions` instead of `transfer_actions`.

- [ ] **Step 2:** `encodePublicInputs` → 352 bytes (add `poolId`, `exitHash`).

- [ ] **Step 3:** ProveProgress labels: "Proving pool action…"

- [ ] **Step 4:** CI: `nargo test` in `circuits/pool_actions`.

---

## Execution order (strict)

```
C1.1 → C1.2 → C2.1 → C2.2 → C2.3 → C3.1 → C3.2 → C8.1
  → C3.3 → C3.4 → C4.1 → C5.1 → C6.1 → C7.1 → C7.2 → C7.3
```

Do **not** merge C5 before C3 relayer payout works. Do **not** deploy before C7.1 audit script passes.

---

## Success checklist (from spec §11)

- [ ] 10+ joins pool 0, 3 exits — heuristic audit ≤ random + ε
- [ ] Event scanner: zero `depositor` / `recipient` / `amount` in new events
- [ ] Explorer doc in README: cannot read payee/amount from vault events alone
- [ ] E2E `phase-c` flow green with real ZK
- [ ] UI shows pool size + weak/medium/strong badge
- [ ] Soroban budget re-measured and documented

---

## Spec coverage self-review

| Spec § | Task |
|--------|------|
| P1–P2 join | C2 |
| P3–P5 exit | C3 |
| P6 identity | C4 |
| P7 anonymity set | C1 min_pool_size + badge |
| P8 relayer | C5 |
| §14 decisions | Constants block + C7.3 hard cutover |
| C6 metadata | C6.1 |
| Threat model update | C7.3 |

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Circuit budget > 400M | Measure in C1.1; drop exit_hash from circuit if needed, bind via contract-only hash check |
| Relayer downtime | Dev mode self-submit; doc volunteer relays |
| Encrypted exit public on calldata | Acceptable — ciphertext hides recipient; relayer-only decrypt |
| Small testnet pool | Enforce min 3; UI warns "weak privacy" below 10 |

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-22-phase-c-privacy.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per milestone (C1, C2, …), review between milestones  
2. **Inline Execution** — implement in this session starting at C1.1, checkpoint after each milestone

Which approach do you want?
