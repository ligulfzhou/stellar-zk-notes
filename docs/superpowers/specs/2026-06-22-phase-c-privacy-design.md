# Phase C — Strong Privacy Design (Effect-First)

**Date:** 2026-06-22  
**Status:** Approved — decisions locked (see §14)  
**Precedes:** Phase A (circuit) ✅ · Phase B (Action protocol) ✅  
**Principle:** Prioritize **privacy outcome**, not implementation ease.

---

## 1. Goal

Evolve zk-notes from **「公开进、池内隐、公开出」** to a system where a **passive global observer** cannot reliably link:

1. A **deposit** to a later **withdraw** or **shielded send**
2. A **shielded send** to a specific **depositor** or **public Stellar identity**
3. **Amounts** across pool boundaries (within chosen denomination / pool policy)

Phase C is **not** UI polish, relayer-only metadata hiding, or event field trimming unless those changes materially advance the properties below.

---

## 2. Privacy properties (target)

Formal names follow the Zcash / academic literature; each maps to a concrete leak in the current system.

| Property | Definition | Current (Phase B) | Phase C target |
|----------|------------|-------------------|----------------|
| **P1 — Deposit unlinkability** | Observer cannot associate a pool note with a unique public depositor identity | ❌ `DepositEvent.depositor` + public XLM transfer | ✅ |
| **P2 — Deposit amount hiding** | Observer cannot learn note value at deposit time | ❌ `DepositEvent.amount` + transfer amount | ✅ (within pool policy) |
| **P3 — Withdraw unlinkability** | Observer cannot associate a withdraw with a specific prior deposit / note | ❌ Small pool + public withdraw | ✅ |
| **P4 — Withdraw recipient hiding** | Observer cannot learn destination `G` at withdraw time | ❌ `WithdrawEvent.recipient` | ✅ |
| **P5 — Withdraw amount hiding** | Observer cannot learn exact withdraw amount on-chain | ❌ `WithdrawEvent.amount` | ✅ (within pool policy) |
| **P6 — Identity unlinkability** | Observer cannot link public `G` ↔ shielded receive key | ❌ `register_shielded_key` on-chain | ✅ |
| **P7 — Anonymity set** | Spend proof hides **which** note in the set is consumed | ⚠️ ZK hides path, but tiny pool defeats it | ✅ Meaningful set size |
| **P8 — Submitter hiding** | Observer cannot tie `shielded_transfer` to payer's `G` | ❌ Tx source account public | ✅ (relayer layer) |

**Phase C success:** P1–P7 are **design requirements**; P8 is **strongly recommended** but can ship immediately after core unlinkability.

**Explicit non-goals for Phase C:**

- Regulatory ASP / allowlist compliance (Phase D or product fork)
- Multi-token (USDC SAC) — orthogonal to privacy architecture
- Recursive proof aggregation — performance, not privacy core

---

## 3. Gap analysis (Phase B → Phase C)

### 3.1 On-chain leaks today

```
DepositEvent     { depositor, amount, commitment, leaf_index }   → breaks P1, P2
ShieldedSendEvent { nullifier, new_commitment, epk, encrypted_note } → OK for value/recipient
WithdrawEvent    { recipient, amount, nullifier }                → breaks P3, P4, P5
ShieldedKeyRegisteredEvent { owner, receive_pubkey }           → breaks P6
Stellar tx envelope { source account, fee, sequence }          → breaks P8
Stellar token.transfer(from, vault, amount) on deposit         → breaks P1, P2
Stellar token.transfer(vault, to, amount) on withdraw          → breaks P4, P5
```

### 3.2 Why Phase B pool-internal privacy is insufficient

`transfer_actions` already proves balance conservation without revealing note values in **shielded transfer** public inputs (`public_amount = 0`). That only satisfies privacy **inside** the pool.

A global observer still sees:

- Who funded the pool and how much (deposit leg)
- Who exited and how much (withdraw leg)
- How many notes exist and when nullifiers appear (graph + timing)

With a small testnet pool, **P3 fails trivially** without ASP / large anonymity set — even perfect ZK cannot unlink Alice→Bob when Alice is the only depositor.

---

## 4. Architectural approaches (effect comparison)

Three viable end states. **Recommended: Approach B** for Stellar constraints + strongest practical unlinkability.

### Approach A — Full shielded lifecycle (Zcash / Orchard direction)

All value stays in shielded notes; no public amount or identity at any protocol boundary.

| Pros | Cons |
|------|------|
| Best P1–P5 if achieved | Stellar **native** `token.transfer` is always public unless never used |
| Single unified pool | Requires shielded **join** / **split** semantics beyond current `transfer_actions` |
| Industry reference model | UltraHonk budget on Soroban may require circuit split or off-chain recursive layer |

**Effect score:** ⭐⭐⭐⭐⭐ if fully realized; high execution risk on Stellar.

### Approach B — Denomination pools + membership spend (Tornado / Semaphore hybrid) **★ Recommended**

Multiple vault instances (or one vault, multiple **pools**) per fixed denomination: e.g. 1 / 10 / 100 XLM.

| Pros | Cons |
|------|------|
| Strong **P3** when pool has volume | Amount privacy only at **fixed denominations** |
| Deposit can stay **one tx** with commitment-only event | Change requires splitting notes off-chain |
| Membership: prove "I know a valid deposit secret" without revealing **which** leaf | Deposit **address** still visible on Stellar unless relayer (→ P8) |
| Fits existing Merkle + nullifier model | UX: user picks denomination |

**Effect score:** ⭐⭐⭐⭐½ — best privacy **per engineering unit** on a transparent L1.

### Approach C — ASP-gated account pool (Nethermind-style)

Association Set Provider signs membership; users prove non-membership of bad actors.

| Pros | Cons |
|------|------|
| Compliance-friendly | **ASP is not anonymity** — trust + identity layer |
| Good for regulated deployment | Does not alone fix public deposit/withdraw |

**Effect score:** ⭐⭐ for **unlinkability**; ⭐⭐⭐⭐ for **compliance**. Use as **Phase D** add-on, not Phase C core.

### Recommendation

**Phase C = Approach B core + relayer (P8) + chain-off identity (P6).**  
Approach A elements (shielded join without public transfer amount) added where Stellar allows.

---

## 5. Target architecture (Phase C)

```
                    ┌─────────────────────────────────────┐
                    │         Relayer network (P8)         │
                    │  submits tx; hides user G source     │
                    └─────────────────┬───────────────────┘
                                      │
┌──────────────┐   join (P1,P2*)   ┌───▼──────────────────────────────┐
│ Public XLM   │ ───────────────► │  Vault — per-denomination pool   │
│ (optional    │                  │  Merkle(commitments)             │
│  relayer)    │                  │  Nullifier set                   │
└──────────────┘                  │  No depositor in events            │
                                  └───┬──────────────────────────────┘
                                      │ shielded_transfer (existing)
                                      │ membership spend (NEW, P7)
                                      │
                    exit (P3,P4,P5)   │
                    ┌─────────────────▼──────────────────┐
                    │  Private withdraw: ZK + encrypted   │
                    │  payout instruction OR relayer pay  │
                    └─────────────────────────────────────┘

* P2: amount hidden in event; Stellar transfer may still show value unless
  fixed-denomination + uniform join pattern or relayer-funded join.
```

### 5.1 Pool model

| Pool | Join amount (stroops) | Purpose |
|------|------------------------|---------|
| `POOL_1` | 10_000_000 (1 XLM) | High anonymity set, small payments |
| `POOL_2` | 100_000_000 (10 XLM) | Medium |
| `POOL_3` | 1_000_000_000 (100 XLM) | Large |

Each pool maintains its **own Merkle tree** (or namespaced `DataKey` prefix). Notes cannot cross pools without explicit **public_amount** bridge (discouraged in UX).

**Privacy effect:** Observer sees "someone joined POOL_1" not "Alice joined with 1.37 XLM".

---

## 6. Phase C deliverables (ordered by privacy effect)

### C1 — Anonymity set & membership spend (P7, P3) **Critical**

**Problem:** Today spend proves Merkle inclusion of **one** commitment via private path, but public `nullifier` + tiny pool enables heuristic linking.

**Design:**

1. **Join secret:** On deposit, client generates `deposit_secret`; commitment includes it:
   ```
   commitment = Poseidon2(value, secret, nullifier_secret, deposit_secret)
   ```
   (Circuit version bump — backward incompatible.)

2. **Membership proof:** Spend circuit additionally proves knowledge of `deposit_secret` such that the spent note's commitment is in the **pool Merkle tree**, without publishing leaf index.

   Implementation options (pick one in implementation plan):
   - **Option 1:** Merkle path remains private witness (current) — already hides index; **anonymity set = all unspent notes in pool**. Phase C must **measure and publish** minimum set size for claimed privacy level.
   - **Option 2:** Separate **note commitment tree** + **nullifier accumulator** (Sapling-style) — stronger, larger circuit.
   - **Option 3:** Semaphore-style identity nullifier from `deposit_secret` — good for fixed-size sets.

3. **Contract:** Reject spends if pool **active note count** < `MIN_ANonymity_SET` (configurable, e.g. 10 for testnet, 100+ for mainnet marketing).

**Acceptance test:** Given N join events from distinct accounts, observer cannot determine which join funded a given withdraw better than **1/N** (simulation + heuristic audit script).

---

### C2 — Private join / shielded deposit (P1, P2) **Critical**

**Problem:** `DepositEvent` and `token.transfer(from, …)` expose depositor and amount.

**Design:**

1. **New entrypoint:** `join_pool(pool_id, commitment)` — no `from: Address` in event.

2. **Funding path (must implement at least one):**

   | Path | P1 effect | P2 effect |
   |------|-----------|-----------|
   | **C2a — Fixed denomination transfer** | ⚠️ Stellar still shows `from` | ✅ amount = pool constant |
   | **C2b — Relayer-funded join** | ✅ user not tx source | ✅ fixed denom |
   | **C2c — Pre-commit + delayed pull** | ✅ commit tx separate from fund | ⚠️ complex |

   **Minimum for Phase C:** C2a + C2b. User-facing default: relayer when available.

3. **Events:** Emit only `{ pool_id, commitment, leaf_index }` — remove `depositor`, `amount`.

4. **Deprecate:** `deposit(from, amount, commitment)` — migrate UI to `join_pool`.

**Acceptance test:** Contract events alone insufficient to recover depositor identity or non-denomination amount.

---

### C3 — Private exit / shielded withdraw (P3, P4, P5) **Critical**

**Problem:** `WithdrawEvent { recipient, amount }` and public token transfer.

**Design:**

1. **New entrypoint:** `exit_pool(proof, nullifiers, public_inputs, encrypted_exit)` where `encrypted_exit` contains:
   - Recipient `G` address (or payment hash)
   - Amount (must match pool denom or split policy)
   - Optional memo / expiry

2. **On-chain:** Contract verifies ZK, marks nullifier spent, emits **only** `ExitEvent { pool_id, nullifier, exit_hash }` — no recipient, no amount.

3. **Payout execution (choose one primary):**

   | Mode | On-chain visibility | Trust |
   |------|---------------------|-------|
   | **C3a — Relayer decrypts & pays** | Vault → relayer → user (relayer visible) | Relayer learns recipient |
   | **C3b — Withdrawal queue + user claim** | Vault → holding; user claims with signature | Extra step |
   | **C3c — Stealth address in encrypted blob** | Only relayer with key pays | Best P4 with honest relayer |

   **Phase C minimum:** C3a with **rotating relayer set** + encrypted exit blob (ECDH to relayer pubkey published off-chain or in contract config).

4. **Remove public `withdraw(to, amount, …)`** or gate behind `legacy_public_exit` flag disabled on mainnet.

**Acceptance test:** Block explorer cannot read recipient or amount from vault events or contract return value.

---

### C4 — Off-chain identity & delivery (P6) **High**

**Problem:** `register_shielded_key(owner, receive_pubkey)` links `G` to shielded receive key forever.

**Design:**

1. **Default:** Shielded sends use **zk1 address** or **one-time delivery key** shared via encrypted channel (payment envelope — already partially implemented).

2. **Deprecate on-chain register** for privacy mode; optional `register_shielded_key` only for **explicit opt-in** merchants who accept public linking.

3. **Wallet:** Send flow requires recipient zk1 / pasted X25519 pubkey — never infer from on-chain registry in privacy mode.

**Acceptance test:** No on-chain tx required before receiving first shielded payment.

---

### C5 — Relayer / meta-transaction layer (P8) **High**

**Problem:** Stellar tx `source account` identifies who submitted shielded operations.

**Design:**

1. Relayer accepts signed **auth entries** + fee from user (Soroban `require_auth` on spend remains).

2. Relayer submits `shielded_transfer` / `exit_pool`; observer sees relayer as source.

3. Document relayer trust: relayer sees timing, fee payer, encrypted exit (C3) — not note secrets if client-side proving retained.

**Acceptance test:** Shielded tx source account ∉ set of pool joiners with high probability.

---

### C6 — Metadata hardening **Medium (after C1–C5)**

| Item | Effect |
|------|--------|
| Fixed-size `encrypted_note` (pad to 512 B) | Reduces ciphertext length fingerprint |
| Uniform `shielded_transfer` shape (always 4×4 slots) | Already mostly true in Phase B |
| Per-output unique nullifier in events (fix `primary_nf` reuse) | Reduces output linkage |
| Private mempool / submit via relayer batch | Timing resistance |

---

## 7. Cryptography & circuit changes

### 7.1 New circuit: `pool_membership` (or extend `transfer_actions` v2)

**Public inputs (draft):**

| Field | Purpose |
|-------|---------|
| `pool_id` | Domain separation |
| `merkle_root` | Pool state |
| `nullifier[4]` | Spent notes |
| `new_commitment[4]` | Outputs |
| `public_amount` | 0 for shielded; fixed for exit |
| `exit_hash` | Hash of encrypted exit blob (C3) |

**Private inputs:** Existing spend/output witnesses + optional `deposit_secret` if using Semaphore-style membership.

**Budget:** Must re-measure on Soroban after any change; target ≤ 76M CPU insn (current Nethermind verifier baseline).

### 7.2 Commitment scheme v2

```
commitment_v2 = Poseidon2(value, secret, nullifier_secret, deposit_secret, pool_id)
```

Migration: Phase B notes **not compatible** — new vault deploy or explicit `pool_v1` / `pool_v2` split.

### 7.3 Exit encryption

Reuse ECDH note delivery (`web/src/lib/ecdh-delivery.ts`) pattern:

```
encrypted_exit = AES-GCM(JSON({ recipient, amount_stroops, memo }), ECDH(user, relayer_pk))
exit_hash = Poseidon2(ciphertext)
```

Relayer set config on vault: `Vec<BytesN<32>> relayer_x25519_keys`.

---

## 8. Contract API (Phase C vault)

| Function | Replaces | Privacy |
|----------|----------|---------|
| `join_pool(pool_id, commitment)` | `deposit` | C2 |
| `shielded_transfer(...)` | (keep, pool-scoped root) | existing |
| `exit_pool(proof, …, exit_hash, encrypted_exit)` | `withdraw` | C3 |
| `get_pool_root(pool_id)` | `get_root` | view |
| `pool_leaf_count(pool_id)` | `leaf_count` | view + anonymity metric |

**Removed from default build:** public `withdraw(to, amount, …)`, `DepositEvent.depositor/amount`, on-chain `register_shielded_key` (optional module).

---

## 9. Client & UX implications

| Flow | Phase B | Phase C |
|------|---------|---------|
| Deposit | Any amount, public | Pick pool denomination; optional relayer |
| Send | zk1 / registered G | zk1 / pasted key only (privacy mode) |
| Withdraw | Public G + amount | Encrypted exit; relayer pays out |
| Dashboard | Public + shielded balance | Show **pool anonymity stats** (set size) |

**User-facing honesty:** Display "Privacy strength: weak / medium / strong" based on `pool_leaf_count` and user's chosen pool.

---

## 10. Threat model updates (Phase C)

| Adversary | Phase C mitigation | Residual risk |
|-----------|-------------------|---------------|
| Global passive observer | C1–C5 | Small pools, long-range timing |
| Relayer | Encrypted exit | Relayer sees recipient on payout |
| RPC / indexer | Same as today | Event completeness |
| XSS | Same as today | High if unlocked |
| Malicious relayer censoring | Multi-relayer | Liveness |

Update `docs/threat-model.md` when Phase C ships; remove "ASP out of scope" for anonymity section — replace with "ASP compliance is Phase D".

---

## 11. Success criteria (effect-based)

Phase C is **done** when all of the following hold on testnet:

1. **Unlinkability demo:** 10+ joins in POOL_1, 3 exits — third-party script cannot match join→exit > random baseline + ε.

2. **Event audit:** Automated scanner finds **no** `recipient`, `depositor`, or `amount` in new vault events.

3. **Explorer walkthrough:** Documented tx lifecycle where block explorer alone cannot answer "who paid whom how much" for shielded path.

4. **E2E:** `join → shielded_transfer → exit` with relayer submission and client-side prove.

5. **Published limitations:** Denomination constraints, relayer trust, minimum anonymity set — honest user docs.

---

## 12. Relationship to other docs

| Doc | Relationship |
|-----|----------------|
| [2026-06-13-utxo-private-payment-design.md](./2026-06-13-utxo-private-payment-design.md) | Phase C **supersedes** MVP limitations §3 (ASP) for anonymity; ASP compliance remains future |
| [2026-06-14-mainnet-readiness.md](../plans/2026-06-14-mainnet-readiness.md) | Phase C **blocks** mainnet privacy claims until C1–C3 ship |
| [threat-model.md](../../threat-model.md) | Must update after implementation |
| Phase A/B artifacts | `transfer_actions` is foundation; Phase C = v2 circuit + new vault entrypoints |

---

## 13. Implementation sequencing (effect order, not ease order)

```
C1 membership + pool split
  → C2 private join
  → C3 private exit
  → C4 off-chain identity
  → C5 relayer
  → C6 metadata
```

Do **not** ship C5/C6 before C1–C3 — relayer without anonymity set gives **false sense of privacy**.

---

## 14. Decisions (locked)

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | **Fixed denominations** | **1 / 10 / 100 XLM only** (3 pools) | Maximizes P2 per pool; variable amounts leak through Stellar transfer + heuristics |
| 2 | **Relayer** | **Open relay + self-relay fallback** | Dev: anyone can run relayer; wallet may submit directly for local testing (P8 off). Payout relayers publish X25519 key off-chain / in repo config; no on-chain allowlist in Phase C |
| 3 | **Migration** | **Hard cutover — new vault, no v1/v2** | Still in development; Phase B vault/notes not migrated; update `.env.local` + redeploy only |
| 4 | **Minimum anonymity set** | **On-chain enforce, env-specific** | Testnet: `min_pool_size = 3` (E2E with few keys). Staging/mainnet doc target: **≥ 100** before claiming "strong privacy". UI always shows set size + weak/medium/strong badge |

### 14.1 Relayer economics (detail)

- **Join / shielded_transfer:** User signs auth; relayer pays Soroban fee. Optional `tip_stroops` in signed payload (0 allowed on testnet).
- **Exit:** Relayer decrypts `encrypted_exit`, pays recipient from relayer balance OR pulls from vault exit queue — primary path **relayer pays user** after verifying `exit_hash` matches ciphertext.
- **No token subsidy** in Phase C; relayer runs as volunteer / own infra.
- **Self-relay:** Wallet setting `privacyMode: strict` disables direct submit; `dev` allows direct submit (warn in UI).

### 14.2 Denomination pools (detail)

| `pool_id` | Join amount | Use case |
|-----------|-------------|----------|
| `0` | 10_000_000 stroops (1 XLM) | Small payments, largest anonymity set target |
| `1` | 100_000_000 (10 XLM) | Medium |
| `2` | 1_000_000_000 (100 XLM) | Large |

No custom amounts. Change = split note off-chain inside pool (shielded transfer), not partial join.

### 14.3 Hard cutover checklist

- New contract IDs (`vault_c`, `verifier_c`); old Phase B vault deprecated in README
- New circuit `pool_membership` or `transfer_actions` v2; new VK
- Commitment v2 (`deposit_secret`, `pool_id` in hash) — **Phase B notes invalid**
- Web: remove public `deposit` / `withdraw` / on-chain `register_shielded_key` from default flows
- E2E: rewrite for `join_pool` → `shielded_transfer` → `exit_pool`

---

## 15. Summary

| Phase | Focus | Privacy level |
|-------|-------|---------------|
| A | `transfer_actions` circuit | — |
| B | Multi-action shielded transfer | Pool-internal |
| **C** | **Denomination pools + private join/exit + membership + relayer** | **Approaching Tornado-class unlinkability on transparent L1** |
| D (future) | ASP / compliance | Regulatory, not anonymity |

Phase C is **not started**. Decisions in §14 are locked; next step is the implementation plan.

---

*Next step: `docs/superpowers/plans/2026-06-22-phase-c-privacy.md`*
