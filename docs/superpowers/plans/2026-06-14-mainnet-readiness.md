# Mainnet Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve zk-notes from testnet demo (mock proofs) to a production-grade shielded payment system suitable for mainnet deployment and external audit.

**Architecture:** Four layers — (1) **cryptography**: Noir circuit + Barretenberg UltraHonk + on-chain verifier with VK pinning; (2) **protocol**: Soroban vault with comprehensive contract tests and documented limits; (3) **client**: browser-side witness + proof generation so secrets never leave the device; (4) **ops**: CI, staging deploy, monitoring, and honest limitation docs.

**Tech Stack:** Noir/Nargo, Barretenberg `bb`, UltraHonk Soroban verifier (indextree), Soroban SDK, Next.js, WebAuthn PRF, `@aztec/bb.js` (Phase 3).

---

## Phase 0 — Foundation ✅

| Task | Status |
|------|--------|
| Sync README / deploy.md contract IDs | done |
| Add `web/.env.local.example` with prod flags | done |
| Contract tests: withdraw, double-spend, stale root, empty ciphertext | done (10 tests) |
| GitHub Actions: `nargo test`, `cargo test`, web build | done |
| `assertMockProofAllowed()` — block mock in production builds | done |
| Remove obsolete poseidon T=3 mock override in prove API | done |

---

## Phase 1 — Real ZK on testnet ✅

**Objective:** One end-to-end path with **real** UltraHonk proofs (CLI first, then server).

### 1.1 UltraHonk verifier

- [x] `scripts/setup_ultrahonk.sh` + `.gitmodules` → indextree verifier
- [x] `scripts/build_vk.sh`: compile circuit → `bb write_vk` (keccak)
- [x] `scripts/build_ultrahonk_verifier.sh` — build WASM
- [x] `scripts/deploy_testnet.sh --real-zk` flag
- [x] Deploy `--real-zk` on testnet (2026-06-18, upgraded 2026-06-18)
- [x] E2E withdraw/send with real proofs — **NethermindEth SDK26 verifier (~76M insn)**

**Deployed (testnet, real ZK, SDK26 verifier):**
- `VERIFIER_ID=CBOH4NCUOT62N6ILEYUYQLVMSJ6NQ77ZACHTSY2APJ3CWWAJXLCJVJQB`
- `VAULT_ID=CC7GU73ZMB7GDQTWGLLVSEVVEBA7GP2AY7TGZHUAZ6HBH3T3SYDNZP4S`

**Budget (measured after NethermindEth upgrade):** `verify_proof` **~75,856,453** CPU instructions (was ~401M with yugocabrio SDK25). Fits testnet 400M limit with room for vault logic.

**E2E fix:** `prove_from_witness` proof must be read from `artifacts/spend_note/proof` (not stdout — `nargo execute` lines polluted hex parse → 32-byte mock proof).

**Files:** `scripts/deploy_testnet.sh`, `scripts/build_vk.sh`, `third_party/ultrahonk_soroban_contract`

### 1.2 Proof pipeline (server-side interim)

- [x] `scripts/prove_from_witness.sh` — keccak UltraHonk prove
- [x] `/api/prove-spend` returns proof hex from `prove_from_witness.sh`
- [x] E2E `prove.ts` — full merkle witness + real proof when `ZK_MOCK_PROOF=false`
- [x] `scripts/install_zk_tools.sh` — bb installer
- [ ] CI optional job with bb (allow failure)

**Files:** `web/src/app/api/prove-spend/route.ts`, `scripts/e2e/prove.ts`

### 1.3 Validation

- [x] Manual: deposit → withdraw with `ZK_MOCK_PROOF=false` on `--real-zk` deploy
- [x] Contract rejects spend when verifier rejects proof (`reject_verifier_blocks_spend` test)

---

## Phase 2 — Client-side proving (trust model) ✅

**Objective:** Note secrets never sent to server; only public inputs + proof bytes hit the API (or skip API entirely).

### 2.1 Browser witness ✅ (partial)

- [x] `merkle-witness-client.ts` — Merkle path in browser (Noir `hash_pair` via `noir-runtime.ts`)
- [x] `spend-witness.ts` — assemble Noir witness client-side
- [x] `/api/prove-witness` — server only runs nargo/bb (no Merkle recompute)
- [x] Send/Withdraw panels use client witness flow
- [x] Commitment/nullifier/hash-pair in browser via `@noir-lang/noir_js` (`noir-runtime.ts`)
- [x] `/api/prove-witness` reads proof from `artifacts/spend_note/proof` (14592 bytes)
- [x] `bb.js` in-browser proving (`prover-client.ts`); server fallback only on failure

**Files:** `web/src/lib/spend-witness.ts`, `web/src/app/api/prove-witness/route.ts`

### 2.2 bb.js WASM

- [x] `@aztec/bb.js@0.87.0` — matches pinned `bb v0.87.0`
- [x] Browser UltraHonk prove with `keccak: true` (14592-byte proofs, local verify)
- [x] `prover-client.ts` + `ProveProgress.tsx` in Send/Withdraw panels
- [x] Server `/api/prove-witness` fallback when browser WASM fails
- [ ] Web Worker offload (optional — main-thread POC ~2–60s)

**Files:** new `web/src/lib/prover-client.ts`, `web/src/components/ProveProgress.tsx`, `SendPanel.tsx`, `WithdrawPanel.tsx`

---

## Phase 3 — Protocol hardening

**Objective:** Audit-ready contract behavior and documented limits.

### 3.1 Contract tests (negative paths) ✅

- [x] `withdraw_transfers_tokens_to_recipient`
- [x] `double_spend_nullifier_reverts`
- [x] `stale_merkle_root_reverts`
- [x] `shielded_send_empty_encrypted_reverts`
- [x] `register_shielded_key_requires_auth`
- [x] Failing verifier contract in tests (`reject_verifier_blocks_spend`)

### 3.2 Vault admin / upgrade (optional)

- [ ] `upgrade` entry point with admin auth (WASM hash pin) OR explicit immutable deploy policy doc
- [ ] Pause / emergency withdraw admin path (design decision)

### 3.3 Limits & migration

- [ ] Document tree height 16 cap (~65k notes) in user-facing docs
- [ ] Rescan: raise default derivation scan or paginate with user prompt — default scan **1024** indices
- [ ] Event indexer: don't rely on RPC event window for old leaves

---

## Phase 4 — Product & ops

**Objective:** Mainnet launch checklist.

### 4.1 UX

- [x] Explorer links on Send / Withdraw (TxLink + Deposit)
- [x] Dashboard: public XLM balance + shielded balance
- [x] Onboarding: passkey required before first deposit (DepositPanel)
- [x] Prove progress indicator (`ProveProgress.tsx`)
- [x] ZK mode badge in header (`ZkModeBadge`)
- [x] Dashboard limits panel (tree height, 1-in-1-out)
- [x] Prove cancel (between phases; WASM may finish in background)
- [ ] Clear error messages for unregistered G… recipient (partial — shielded-registry)

### 4.2 Dual-account E2E

- [x] `scripts/e2e/run.ts --flow alice-bob`: Alice deposit → send to Bob's registered G → Bob withdraw
- [x] Run on testnet with funded `alice` + `bob` stellar keys (2026-06-18, real UltraHonk)

### 4.3 CI/CD

- [x] GitHub Actions: lint web, contract tests, circuit tests on every PR
- [x] Optional `bb-prove` smoke job (allow failure, 14592-byte proof)
- [~] Staging deploy workflow — **deferred** (low priority; manual deploy is fine for hackathon/staging)
- [x] Mainnet deploy runbook draft ([deploy.md](../../deploy.md) § Mainnet runbook)

### 4.4 Security & compliance

- [ ] External audit (contract + crypto)
- [x] Threat model doc: XSS, RPC trust, encrypted-note metadata, front-running ([threat-model.md](../../threat-model.md))
- [x] ASP / compliance explicitly deferred (design spec § MVP Limitations #3)
- [x] Bug bounty / responsible disclosure policy ([SECURITY.md](../../SECURITY.md) draft)

---

## Phase 5 — Post-MVP protocol (not mainnet blockers)

- Change outputs / note splitting (1-in-1-out today)
- Multi-token (USDC SAC)
- Merkle tree rollover when height 16 fills
- ASP membership proofs

---

## Environment matrix

| Variable | Testnet demo | Staging (real ZK) | Production |
|----------|--------------|-------------------|------------|
| `ZK_MOCK_PROOF` | `true` | `false` | `false` (enforced) |
| `NEXT_PUBLIC_ZK_MOCK_PROOF` | `true` | `false` | `false` |
| Verifier | MockVerifier | UltraHonk | UltraHonk |
| `NEXT_PUBLIC_VAULT_LEGACY_SEND` | `false` | `false` | `false` |
| Proving | mock bytes | bb.js browser + CLI E2E | bb.js in browser |

---

## Success criteria for mainnet

1. **Real proofs only** — mock verifier not deployed; production build rejects mock flag.
2. **Client-side secrets** — no `secret` / `nullifierSecret` in server logs or prove API body.
3. **Contract test coverage** — all spend paths + negative cases; CI green.
4. **One external audit** — critical findings resolved or accepted with docs.
5. **Runbook** — deploy, upgrade, incident response documented.
6. **Limitations published** — tree height, 1-in-1-out, no ASP, single token.

---

## Recommended execution order

```
Phase 0 (1–2 days) → Phase 1 (3–5 days, needs bb) → Phase 3.1 parallel
→ Phase 2 (1–2 weeks) → Phase 4 → Audit → Mainnet
```

**Current vault (testnet, real ZK):** `CC7GU73ZMB7GDQTWGLLVSEVVEBA7GP2AY7TGZHUAZ6HBH3T3SYDNZP4S`
