# zk-utxo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a full-featured UTXO private payment system on Stellar testnet (`zk-utxo`), sibling to the Tornado `zk` project, with 4×4 `utxo_actions` circuit, single-tree vault, coin-selection wallet, and dual withdraw paths.

**Architecture:** Fork `transfer_actions` into `utxo_actions` (+ `relayer_fee`); new Soroban vault without pools; web wallet copied from `zk/web` and adapted (Deposit/Send/Withdraw, coin selection); relayer handles deposit/transfer/exit in strict mode.

**Tech Stack:** Noir 1.0.0-beta, Barretenberg `bb`, Soroban Rust, UltraHonk verifier, Next.js 15, Tailwind, Zustand, `@aztec/bb.js`, Stellar Wallets Kit, WebAuthn PRF.

**Spec:** `docs/superpowers/specs/2026-06-24-utxo-private-payment-design.md`

**Source repo to copy from:** `/Users/ligulfzhou/Money/blockchain/stellar/zk`

---

## File Map

| Path | Responsibility |
|------|----------------|
| `circuits/utxo_actions/src/main.nr` | 4×4 spend circuit + relayer_fee |
| `circuits/note_hash/` | v1 commitment helper |
| `circuits/hash_pair/` | Merkle pair hash |
| `contracts/contracts/vault/src/lib.rs` | deposit, shielded_transfer, withdraw, exit_via_relayer |
| `contracts/contracts/vault/src/merkle.rs` | Incremental Merkle tree (copy from zk) |
| `contracts/contracts/vault/src/verifier.rs` | utxo_actions PI encode + verify |
| `contracts/contracts/mock-verifier/` | Demo mock verifier |
| `web/src/lib/coin-selection.ts` | Note selection + change computation |
| `web/src/lib/action-witness.ts` | utxo_actions witness builder (no pool fields) |
| `web/src/lib/commitment.ts` | v1 commitment via note_hash |
| `web/src/components/DepositPanel.tsx` | Arbitrary amount deposit |
| `web/src/components/SendPanel.tsx` | Multi-recipient + coin select |
| `web/src/components/WithdrawPanel.tsx` | On-chain + relayer toggle |
| `scripts/relayer/` | HTTP relayer (deposit/submit/exit) |
| `scripts/e2e/` | Full flow + privacy audit |
| `cli/zk-utxo-notes/` | Rust dev CLI |

---

## Phase 1: Repository Scaffold

### Task 1: Initialize repo skeleton

**Files:**
- Create: `README.md`, `.gitignore`, `LICENSE`, `SECURITY.md`
- Create: `scripts/install_zk_tools.sh` (copy from zk)

- [ ] **Step 1: Create root README**

```markdown
# zk-utxo

UTXO-style private payments on Stellar — arbitrary amounts, 4×4 action bundles, dual withdraw.

Sibling project: [zk](../zk) (Tornado-style denomination pools).

See [design spec](docs/superpowers/specs/2026-06-24-utxo-private-payment-design.md).
```

- [ ] **Step 2: Copy shared scripts from zk**

```bash
cp ../zk/scripts/install_zk_tools.sh scripts/
cp ../zk/scripts/sync_noir_circuits.sh scripts/
cp ../zk/.gitignore .gitignore
chmod +x scripts/*.sh
```

- [ ] **Step 3: Init git**

```bash
cd /Users/ligulfzhou/Money/blockchain/stellar/zk-utxo
git init
git add README.md .gitignore LICENSE SECURITY.md docs/ scripts/install_zk_tools.sh
git commit -m "chore: initialize zk-utxo repository"
```

---

### Task 2: Copy hash_pair and note_hash circuits

**Files:**
- Create: `circuits/hash_pair/` (from zk)
- Create: `circuits/note_hash/` (from zk, verify 3-field commitment only)

- [ ] **Step 1: Copy circuits**

```bash
cp -r ../zk/circuits/hash_pair circuits/
cp -r ../zk/circuits/note_hash circuits/
rm -rf circuits/hash_pair/target circuits/note_hash/target
```

- [ ] **Step 2: Verify note_hash has no pool_id**

Read `circuits/note_hash/src/main.nr` — inputs must be `value, secret, nullifier_secret` only (3 fields). If zk version includes pool_id, strip it.

- [ ] **Step 3: Run tests**

```bash
cd circuits/hash_pair && nargo test
cd ../note_hash && nargo test
```

Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add circuits/hash_pair circuits/note_hash
git commit -m "feat: add hash_pair and note_hash circuits"
```

---

## Phase 2: utxo_actions Circuit

### Task 3: Create utxo_actions from transfer_actions

**Files:**
- Create: `circuits/utxo_actions/src/main.nr`
- Create: `circuits/utxo_actions/Nargo.toml`
- Create: `circuits/utxo_actions/Prover.toml`

- [ ] **Step 1: Copy transfer_actions as base**

```bash
cp -r ../zk/circuits/transfer_actions circuits/utxo_actions
rm -rf circuits/utxo_actions/target
```

- [ ] **Step 2: Add relayer_fee public input**

In `circuits/utxo_actions/src/main.nr`, add to `main()` signature:

```noir
relayer_fee: pub Field,
```

After balance check `assert(spend_sum == out_sum + public_amount)`, add:

```noir
if public_amount != 0 {
    assert(relayer_fee as u64 <= public_amount as u64);
} else {
    assert(relayer_fee == 0);
}
if public_amount != 0 {
    for j in 0..MAX_OUTPUTS {
        assert(new_commitment[j] == 0);
    }
}
```

Update all test `invoke_transfer` calls to pass `relayer_fee` (use `0` for shielded tests, `fee` for exit tests).

- [ ] **Step 3: Add relayer exit test**

```noir
#[test]
fn test_relayer_exit_via_actions() {
    let value = 1_000_000;
    let fee = 10_000;
    // ... same setup as test_withdraw_via_actions ...
    invoke_transfer(
        [value, 0, 0, 0],
        [secret, 0, 0, 0],
        [ns, 0, 0, 0],
        paths, indices,
        [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0],
        root,
        [nf, 0, 0, 0],
        [0, 0, 0, 0],
        value,
        fee,
    );
}
```

- [ ] **Step 4: Run tests**

```bash
cd circuits/utxo_actions && nargo test
```

Expected: all PASS including `test_4_in_2_out_via_actions`, `test_relayer_exit_via_actions`

- [ ] **Step 5: Commit**

```bash
git add circuits/utxo_actions
git commit -m "feat: add utxo_actions circuit (4x4 + relayer_fee)"
```

---

### Task 4: VK build and budget measurement

**Files:**
- Create: `scripts/build_vk.sh` (adapt from zk, circuit name `utxo_actions`)
- Create: `scripts/measure_utxo_actions_budget.sh`
- Create: `scripts/gen_utxo_actions_fixtures.ts` (adapt from `gen_transfer_actions_fixtures.ts`)

- [ ] **Step 1: Copy and adapt build scripts**

```bash
cp ../zk/scripts/build_vk.sh scripts/build_vk_utxo_actions.sh
cp ../zk/scripts/measure_transfer_actions_budget.sh scripts/measure_utxo_actions_budget.sh
cp ../zk/scripts/gen_transfer_actions_fixtures.ts scripts/gen_utxo_actions_fixtures.ts
# Edit all three: replace transfer_actions → utxo_actions, add relayer_fee to fixtures
```

- [ ] **Step 2: Build VK**

```bash
./scripts/install_zk_tools.sh
./scripts/build_vk_utxo_actions.sh
```

Expected: `artifacts/utxo_actions/vk` exists

- [ ] **Step 3: Run budget test** (after contracts Task 5)

```bash
./scripts/measure_utxo_actions_budget.sh
```

Expected: verify passes under testnet 400M insn limit

---

## Phase 3: Soroban Vault Contract

### Task 5: Contract workspace scaffold

**Files:**
- Create: `contracts/Cargo.toml`, `contracts/contracts/vault/`, `contracts/contracts/mock-verifier/`

- [ ] **Step 1: Copy contract workspace from zk**

```bash
cp -r ../zk/contracts/Cargo.toml contracts/
cp -r ../zk/contracts/contracts/mock-verifier contracts/contracts/
mkdir -p contracts/contracts/vault/src
cp ../zk/contracts/contracts/vault/src/merkle.rs contracts/contracts/vault/src/
cp ../zk/contracts/contracts/vault/src/storage.rs contracts/contracts/vault/src/
```

- [ ] **Step 2: Rewrite storage.rs — remove pool keys**

`DataKey` should have: `Admin`, `Token`, `Verifier`, `Tree` (single), `Nullifier(BytesN<32>)`. Remove `PoolTree`, `MinPoolSize`.

- [ ] **Step 3: Create verifier.rs for utxo_actions**

```rust
/// BN254 public inputs for utxo_actions (11 x 32 bytes = 352).
pub const PUBLIC_INPUTS_LEN: u32 = 352;
pub const MAX_ACTION_SLOTS: usize = 4;

/// Layout: merkle_root | nullifier[4] | new_commitment[4] | public_amount | relayer_fee
pub fn encode_public_inputs(
    env: &Env,
    merkle_root: &BytesN<32>,
    nullifiers: &[BytesN<32>; MAX_ACTION_SLOTS],
    new_commitments: &[BytesN<32>; MAX_ACTION_SLOTS],
    public_amount: &BytesN<32>,
    relayer_fee: &BytesN<32>,
) -> Bytes { /* ... */ }
```

- [ ] **Step 4: Implement lib.rs**

Core functions (no `pool_id` anywhere):

```rust
pub fn deposit(env: Env, from: Address, amount: i128, commitment: BytesN<32>)
pub fn shielded_transfer(env: Env, /* 4 nullifiers, 4 commitments, root, proof, 4 epk, 4 encrypted_note */)
pub fn withdraw(env: Env, recipient: Address, /* nullifiers, root, proof */)
pub fn exit_via_relayer(env: Env, recipient: Address, relayer: Address, /* nullifiers, root, proof */)
```

`shielded_transfer`: decode PI, assert `public_amount == 0 && relayer_fee == 0`, verify proof, mark nullifiers, insert commitments.

`withdraw`: decode PI, assert `relayer_fee == 0`, verify, `token.transfer(vault, recipient, public_amount)`, emit `WithdrawEvent`.

`exit_via_relayer`: decode PI, `payout = public_amount - relayer_fee`, transfer to recipient + relayer, emit `ExitEvent { nullifier }` only.

- [ ] **Step 5: Write contract tests**

Copy patterns from `zk/contracts/contracts/vault/src/test.rs`, remove pool tests, add:

```rust
#[test]
fn deposit_inserts_commitment() { /* ... */ }

#[test]
fn shielded_transfer_1x1() { /* mock verifier */ }

#[test]
fn withdraw_on_chain() { /* ... */ }

#[test]
fn exit_via_relayer_pays_fee() { /* ... */ }

#[test]
fn rejects_double_spend() { /* ... */ }
```

- [ ] **Step 6: Run tests**

```bash
cd contracts && cargo test -p vault
```

Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add contracts/
git commit -m "feat: add single-tree vault contract for utxo_actions"
```

---

### Task 6: UltraHonk verifier integration

**Files:**
- Create: `scripts/build_ultrahonk_verifier.sh`
- Create: `scripts/deploy_testnet.sh`

- [ ] **Step 1: Copy deploy scripts from zk**

Adapt `deploy_testnet.sh`: no pool initialization, single tree vault.

- [ ] **Step 2: Deploy to testnet**

```bash
STELLAR_SOURCE=admin ./scripts/deploy_testnet.sh --real-zk
```

Record contract IDs in `README.md` and `web/.env.local.example`.

---

## Phase 4: Web Wallet

### Task 7: Scaffold Next.js app

**Files:**
- Create: `web/` (copy from zk/web, strip pool-specific code)

- [ ] **Step 1: Copy web app**

```bash
cp -r ../zk/web web
rm -rf web/node_modules web/.next
```

- [ ] **Step 2: Update branding**

`web/src/app/layout.tsx` title: `zk-utxo | UTXO Private Payments on Stellar`

Remove imports/references to: `pool-config`, `join-decompose`, `commitment-v2`, `JoinPanel`, `ExitPanel`.

- [ ] **Step 3: Install and build**

```bash
cd web && cp .env.local.example .env.local && npm install && npm run build
```

Fix compile errors from removed pool modules.

- [ ] **Step 4: Commit**

```bash
git add web/
git commit -m "feat: scaffold web wallet from zk (pool code removed)"
```

---

### Task 8: v1 commitment + action witness

**Files:**
- Create: `web/src/lib/commitment.ts`
- Modify: `web/src/lib/action-witness.ts`
- Modify: `web/src/lib/noir-runtime.ts`

- [ ] **Step 1: Create commitment.ts**

```typescript
import { executeNoirField } from "./noir-runtime";

export async function computeCommitment(params: {
  valueStroops: bigint;
  secret: string;
  nullifierSecret: string;
}): Promise<string> {
  return executeNoirField("note_hash", {
    value: params.valueStroops.toString(),
    secret: params.secret,
    nullifier_secret: params.nullifierSecret,
  });
}
```

- [ ] **Step 2: Rewrite action-witness.ts**

Remove: `pool_id`, `spend_deposit_secret`, `out_deposit_secret`, `relayer_fee` from pool path.

`TransferWitnessPayload` fields:

```typescript
export type UtxoWitnessPayload = {
  spend_value: string[];
  spend_secret: string[];
  spend_nullifier_secret: string[];
  spend_merkle_path: string[][];
  spend_path_indices: boolean[][];
  out_value: string[];
  out_secret: string[];
  out_nullifier_secret: string[];
  merkle_root: string;
  nullifier: string[];
  new_commitment: string[];
  public_amount: string;
  relayer_fee: string;
};
```

Add `buildShieldedTransferWitness`, `buildWithdrawWitness`, `buildRelayerExitWitness`.

- [ ] **Step 3: Sync circuits to web/public**

```bash
./scripts/sync_noir_circuits.sh
```

Add `utxo_actions` to sync script and `noir-runtime.ts` circuit list.

---

### Task 9: Coin selection module

**Files:**
- Create: `web/src/lib/coin-selection.ts`
- Create: `web/src/lib/coin-selection.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect } from "vitest";
import { selectNotesForAmount, computeChange } from "./coin-selection";

const notes = [
  { id: "a", value: 100n, status: "unspent" as const },
  { id: "b", value: 50n, status: "unspent" as const },
  { id: "c", value: 200n, status: "unspent" as const },
];

describe("selectNotesForAmount", () => {
  it("picks single note when exact match", () => {
    const r = selectNotesForAmount(notes, 50n);
    expect(r.inputs.map((n) => n.id)).toEqual(["b"]);
    expect(r.change).toBe(0n);
  });

  it("merges notes when needed", () => {
    const r = selectNotesForAmount(notes, 150n);
    expect(r.inputs.reduce((s, n) => s + n.value, 0n)).toBeGreaterThanOrEqual(150n);
    expect(r.change).toBe(r.inputs.reduce((s, n) => s + n.value, 0n) - 150n);
  });

  it("throws when insufficient funds", () => {
    expect(() => selectNotesForAmount(notes, 500n)).toThrow();
  });
});
```

- [ ] **Step 2: Implement**

```typescript
export function selectNotesForAmount(
  notes: Pick<Note, "id" | "value" | "status">[],
  target: bigint
): { inputs: Note[]; change: bigint } {
  const unspent = notes.filter((n) => n.status === "unspent").sort((a, b) =>
    a.value > b.value ? -1 : a.value < b.value ? 1 : 0
  );
  const exact = unspent.find((n) => n.value === target);
  if (exact) return { inputs: [exact], change: 0n };
  let sum = 0n;
  const picked: Note[] = [];
  for (const n of unspent) {
    if (sum >= target) break;
    picked.push(n);
    sum += n.value;
  }
  if (sum < target) throw new Error("Insufficient shielded balance");
  return { inputs: picked, change: sum - target };
}
```

- [ ] **Step 3: Run tests**

```bash
cd web && npx vitest run src/lib/coin-selection.test.ts
```

Expected: PASS

---

### Task 10: DepositPanel

**Files:**
- Create: `web/src/components/DepositPanel.tsx`
- Modify: `web/src/components/WalletApp.tsx`

- [ ] **Step 1: Implement DepositPanel**

Flow:
1. User enters XLM amount (arbitrary, min 0.1 XLM)
2. Optional: split into N notes (even split)
3. Passkey unlock → derive secrets per note
4. `computeCommitment` for each
5. Call `depositOnVault(amount, commitment)` — batch = multiple txs if split
6. Save notes to vault with `leafIndex` from events

No `pool_id` on notes. Use `createNote({ valueStroops, ... })` without poolId.

- [ ] **Step 2: Wire tab in WalletApp**

Replace `join` tab with `deposit` → `<DepositPanel />`.

---

### Task 11: SendPanel (multi-recipient + change)

**Files:**
- Create: `web/src/components/SendPanel.tsx`

- [ ] **Step 1: UI fields**

- Recipient list (1–4 rows): zk1 address + amount each
- Auto coin-select or manual note picker
- Show change output preview
- ProveProgress during bb.js prove

- [ ] **Step 2: Build witness**

```typescript
const { inputs, change } = selectNotesForAmount(unspent, totalOut);
const outputs = [...recipients, ...(change > 0n ? [{ change }] : [])];
await buildShieldedTransferWitness({ inputs, outputs, poolChainCommitments });
```

- [ ] **Step 3: Submit**

`shieldedTransferOnVault(...)` or relayer `POST /submit` in strict mode.

- [ ] **Step 4: ECDH encrypt outputs**

Port `ecdh-delivery.ts` from zk unchanged — encrypt note secrets for each recipient output.

---

### Task 12: WithdrawPanel (dual path)

**Files:**
- Create: `web/src/components/WithdrawPanel.tsx`

- [ ] **Step 1: Toggle on-chain vs relayer**

```typescript
const [mode, setMode] = useState<"onchain" | "relayer">("onchain");
```

- [ ] **Step 2: On-chain path**

`buildWithdrawWitness` → user signs `withdraw(recipient, ...)` → `WithdrawEvent` on chain.

- [ ] **Step 3: Relayer path**

`buildRelayerExitWitness` with `relayer_fee` → `POST /exit` → relayer calls `exit_via_relayer`.

- [ ] **Step 4: Wire tab**

Replace `exit` tab with `withdraw` → `<WithdrawPanel />`.

---

### Task 13: Note types + rescan cleanup

**Files:**
- Modify: `web/src/lib/note-types.ts`
- Modify: `web/src/lib/rescan-vault.ts`
- Modify: `web/src/lib/incoming-scanner.ts`

- [ ] **Step 1: Remove poolId from Note type** (or make optional, unused)

```typescript
export type Note = {
  id: string;
  value: bigint;
  secret: string;
  nullifierSecret: string;
  ownerPubkey: string;
  commitment: string;
  leafIndex: number;
  status: NoteStatus;
  derivationIndex?: number;
  createdAt: number;
};
```

- [ ] **Step 2: Single commitment list**

`StoredNoteVault.chainCommitments: string[]` (not `poolChainCommitments[][]`).

- [ ] **Step 3: Update rescan for DepositEvent** (no depositor field)

Match joins by derivation index scan + commitment match.

---

## Phase 5: Relayer

### Task 14: UTXO relayer service

**Files:**
- Create: `scripts/relayer/server.ts`
- Create: `scripts/relayer/deposit.ts`
- Create: `scripts/relayer/submit.ts`
- Create: `scripts/relayer/exit.ts`
- Create: `scripts/relayer/config.ts`

- [ ] **Step 1: Copy relayer from zk**

```bash
cp -r ../zk/scripts/relayer scripts/
```

- [ ] **Step 2: Add deposit endpoint**

`POST /deposit`: relayer calls `vault.deposit(relayer_account, amount, commitment)` — user sends XLM to relayer off-chain or via prior funding; document trust model.

- [ ] **Step 3: Adapt submit for shielded_transfer**

Remove `pool_id` from contract call args.

- [ ] **Step 4: Adapt exit for exit_via_relayer**

Variable `public_amount` from proof PI (not fixed pool denomination).

- [ ] **Step 5: Run relayer**

```bash
npx tsx scripts/relayer/server.ts
```

Expected: listens on `:8787`, `/health` returns OK

---

## Phase 6: E2E, CLI, Docs

### Task 15: E2E test suite

**Files:**
- Create: `scripts/e2e/run.ts`, `scripts/e2e/stellar.ts`, `scripts/e2e/prove.ts`
- Create: `scripts/e2e/privacy-audit.ts`
- Create: `scripts/e2e_testnet.sh`

- [ ] **Step 1: Copy and adapt from zk**

Replace `join_pool` → `deposit`, `exit_pool` → `withdraw` / `exit_via_relayer`, remove pool_id.

- [ ] **Step 2: Full flow test**

```bash
./scripts/prepare_e2e_accounts.sh --fund alice bob
STELLAR_SOURCE=admin ./scripts/e2e_testnet.sh --flow full
```

Flow: deposit 15 XLM → send 7 XLM with change → merge 2 notes → on-chain withdraw 3 XLM → relayer exit remainder.

- [ ] **Step 3: Privacy audit**

```bash
npx tsx scripts/e2e/privacy-audit.ts --vault $VAULT_ID
```

Expected: `Privacy audit PASSED`

---

### Task 16: Rust CLI

**Files:**
- Create: `cli/zk-utxo-notes/` (copy from `cli/zk-notes`, adapt)

- [ ] **Step 1: Copy CLI**

```bash
cp -r ../zk/cli/zk-notes cli/zk-utxo-notes
```

- [ ] **Step 2: Update commands**

`deposit`, `send`, `withdraw`, `exit` — no pool flags.

---

### Task 17: Documentation and README

**Files:**
- Modify: `README.md`
- Create: `docs/threat-model.md`
- Create: `docs/deploy.md`

- [ ] **Step 1: README comparison table** (zk vs zk-utxo)

- [ ] **Step 2: Threat model** (adapt from zk, add relayer deposit trust)

- [ ] **Step 3: Demo video script**

deposit → multi-send with change → on-chain withdraw → relayer exit

---

## Phase 7: CI

### Task 18: GitHub Actions

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: CI jobs**

```yaml
jobs:
  circuits:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd circuits/utxo_actions && nargo test
  contracts:
    runs-on: ubuntu-latest
    steps:
      - run: cd contracts && cargo test -p vault
  web:
    runs-on: ubuntu-latest
    steps:
      - run: cd web && npm ci && npm run build
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| utxo_actions 4×4 + relayer_fee | Task 3 |
| Single Merkle tree vault | Task 5 |
| deposit / shielded_transfer / withdraw / exit_via_relayer | Task 5 |
| v1 commitment | Task 2, 8 |
| Coin selection | Task 9 |
| Multi-recipient send | Task 11 |
| Dual withdraw | Task 12 |
| Relayer deposit/transfer/exit | Task 14 |
| Passkey + zk1 + ECDH | Task 7 (port), Task 11 |
| Privacy audit | Task 15 |
| E2E full flow | Task 15 |
| CLI | Task 16 |
| README differentiation | Task 17 |

---

## Execution Order

```
Phase 1 (scaffold) → Phase 2 (circuit) → Phase 3 (contract) → Task 4 (VK/budget)
    → Phase 4 (wallet) → Phase 5 (relayer) → Phase 6 (E2E/docs) → Phase 7 (CI)
```

Phases 4–5 can partially overlap once contract is deployed to testnet with mock verifier.
