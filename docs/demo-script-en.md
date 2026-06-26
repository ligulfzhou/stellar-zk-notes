# zk-tornado — Demo Video Script

**Hackathon:** [Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk/detail)  
**Length:** **2–3 minutes** (required)  
**Format:** Screen recording + voiceover. You do **not** need to appear on camera. Production quality is **not** scored — clarity is.

**Product:** Tornado-style privacy pools on Stellar Soroban — fixed 1 / 10 / 100 XLM pools, browser Noir/UltraHonk proofs, passkey wallet, relayer exit.

**Testnet vault:** `CCSA45EVCX3JJDE5OIGJFGWAQPYWD65MMTQZKL66ZILZDMVAUXZXLV4H`

---

## Map video → official submission requirements

Organizers ask for three things. Your video should make each one obvious.

| Requirement | What to show / say in the video | Where in repo |
|-------------|----------------------------------|---------------|
| **1. Open-source repo** | End card or closing line: *“Full source on GitHub — README, architecture, honest limitations.”* | [README.md](../README.md), [architecture.md](architecture.md) |
| **2. Short demo video** | Live walkthrough: connect → deposit → **wait for ZK proof** → exit → XLM received | This script |
| **3. ZK + Stellar (load-bearing)** | Say explicitly: exit **fails** without a valid proof; Soroban **verifier contract** checks UltraHonk on testnet — not a slide, not optional | `circuits/pool_actions`, vault `exit_pool`, verifier `verify_proof` |

**What “load-bearing ZK” means for us:** You cannot withdraw from the pool unless the browser generates a Noir `pool_actions` proof and the Soroban verifier accepts it. Mock proofs are rejected on our deployed testnet verifier.

---

## Before you hit Record

### Environment

```bash
cd web && npm run sync:circuits && npm run dev
# Open http://localhost:3000  (not 127.0.0.1 — passkeys)
```

`web/.env.local`:

```
NEXT_PUBLIC_VAULT_CONTRACT_ID=CCSA45EVCX3JJDE5OIGJFGWAQPYWD65MMTQZKL66ZILZDMVAUXZXLV4H
ZK_MOCK_PROOF=false
NEXT_PUBLIC_ZK_MOCK_PROOF=false
NEXT_PUBLIC_RELAYER_URL=http://127.0.0.1:8787
```

### Relayer (recommended — shows deposit wallet ≠ exit tx source)

```bash
cd scripts/relayer
RELAYER_SECRET=<SD...> \
VAULT_ID=CCSA45EVCX3JJDE5OIGJFGWAQPYWD65MMTQZKL66ZILZDMVAUXZXLV4H \
npm run server
```

### Accounts & pool

- Freighter on **Testnet**, **15+ XLM** (retakes + fees)
- Pick a pool with **≥ 3 notes** already (10 XLM or 100 XLM pool) so exit is not blocked
- Optional: second G address as **exit recipient** (can have 0 XLM)

### Recording (OBS)

- Use **Display Capture** (full screen), not Window Capture on Chrome only — **Freighter popups** are a separate extension window and won’t show otherwise
- macOS: System Settings → Privacy → **Screen Recording** → enable OBS

### Tabs to have ready

- App: `http://localhost:3000`
- Optional 5s cutaway: [Vault on stellar.expert](https://stellar.expert/explorer/testnet/contract/CCSA45EVCX3JJDE5OIGJFGWAQPYWD65MMTQZKL66ZILZDMVAUXZXLV4H)
- Optional: GitHub README or [Deposit / Exit diagrams](architecture.md#1-system-diagram)

---

## Main script (~2:30)

Read the **Voiceover** column; do the **On screen** column. Target **2:00–2:45**; hard cap **3:00**.

### Scene 1 — Problem (0:00 – 0:25)

| Time | On screen | Voiceover |
|------|-----------|-----------|
| 0:00 | Dashboard or app title **zk-tornado** | “Stellar payments are public — anyone can link who paid whom. **zk-tornado** adds Tornado-style **privacy pools** on Soroban: you deposit native XLM into fixed **1, 10, or 100 XLM** pools, and you exit with a **zero-knowledge proof** so observers can’t tell which deposit you spent.” |

**Requirement hit:** real-world problem (cross-border / graph analysis on transparent ledger).

---

### Scene 2 — What ZK does here (0:25 – 0:50)

| Time | On screen | Voiceover |
|------|-----------|-----------|
| 0:25 | Flash [Exit diagram](architecture.md#exit-exit_pool--zk) or README “How it works” for 3–5s | “Here’s what ZK is **doing** — not decoration. On deposit, only a **commitment** goes on-chain. On exit, the wallet proves in **Noir** that it knows a valid note: correct **Merkle path**, correct **nullifier**, right **pool denomination** — **without revealing which leaf** in the tree. The proof is **UltraHonk**, verified on testnet by a **Soroban verifier contract**. No valid proof, no withdrawal — the vault reverts.” |

**Requirement hit:** ZK + Stellar, load-bearing (verifier on-chain, proof mandatory).

---

### Scene 3 — Connect & passkey (0:50 – 1:05)

| Time | On screen | Voiceover |
|------|-----------|-----------|
| 0:50 | Connect wallet → Unlock passkey (Touch ID) | “I connect **Freighter** on testnet. Note secrets come from a **passkey** — derived locally, never sent to a server. Same idea as a wallet, without copying Tornado backup strings.” |

**Requirement hit:** Stellar integration (Freighter / testnet).

---

### Scene 4 — Deposit (1:05 – 1:35)

| Time | On screen | Voiceover |
|------|-----------|-----------|
| 1:05 | Deposit tab → enter **10 XLM** → Freighter approve | “I deposit **10 XLM**. The app splits into fixed pools — here, one **10 XLM** note in **pool 1**. Freighter signs **`join_pool`** on our Soroban vault.” |
| 1:20 | Success: note listed, pool shows **N / 3 min notes** | “On-chain you only see the **commitment** and **leaf index** — not my note secrets. The pool needs at least **three notes** before anyone can exit; that’s our testnet minimum anonymity set.” |

**Requirement hit:** working demo + Stellar (`join_pool`, SAC transfer).

---

### Scene 5 — Exit + ZK proof (1:35 – 2:20) ★ most important

| Time | On screen | Voiceover |
|------|-----------|-----------|
| 1:35 | Exit tab → select note → recipient G (different from deposit wallet if possible) | “To withdraw, I pick my note and a **recipient address** — it can be a fresh account.” |
| 1:45 | Status: *Loading on-chain Merkle tree…* then *Generating ZK proof…* | “The browser loads the pool Merkle tree from the **vault contract**, builds a witness, and runs **Noir plus UltraHonk** locally. This takes about **thirty to ninety seconds** — I’ll let it finish; this is the real proof step.” |
| 2:00 | **ProveProgress** bar completes — do not skip | “The proof and **public inputs** go to **`exit_pool`**. The verifier checks them before any XLM moves.” |
| 2:10 | Exit via **relayer** → success + tx link | “I submit through our **relayer** so the **transaction source** is the relayer, not the wallet that deposited. Recipient gets **10 XLM minus the relayer fee**.” |

**Requirement hit:** demo working + ZK visible (proof progress) + Stellar (`exit_pool`, verifier).

**If proof step was pre-recorded:** splice in a clearly labeled clip, but live proof bar is stronger for judges.

---

### Scene 6 — Result & honest close (2:20 – 2:45)

| Time | On screen | Voiceover |
|------|-----------|-----------|
| 2:20 | Recipient balance or stellar.expert: exit tx (source = relayer) | “Money arrived. Inside the pool, this exit is **unlinkable** from my deposit. The recipient is still public — we break **deposit-to-withdraw linkage**, not payee hiding.” |
| 2:35 | GitHub repo / README | “This is **testnet**, **not audited**. Full source, architecture diagrams, and known limits are in the **README**. Thanks for watching.” |

**Requirement hit:** open-source repo + honesty (organizers prefer this over polished mystery).

---

## One paragraph (if you prefer reading, not tables)

> Stellar payments are public; **zk-tornado** adds fixed **1 / 10 / 100 XLM** privacy pools on Soroban. Deposits call **`join_pool`** — only commitments on-chain. Exits need a **Noir `pool_actions` proof** verified by an **UltraHonk Soroban verifier**; without it, withdrawal fails. I connect Freighter, unlock a **passkey**, deposit **10 XLM**, then exit to another address while the browser generates the proof. A **relayer** submits the tx so my deposit wallet isn’t the exit source. Unlinkability is inside the pool; recipient stays public. Testnet demo, open source on GitHub, not audited.

~40 seconds at normal pace — use as intro or B-roll voiceover under diagrams.

---

## 90-second emergency cut

If UltraHonk eats your budget, pre-deposit off-camera and record:

| Sec | Content |
|-----|---------|
| 0–15 | Problem + “ZK proof required for exit on Soroban” |
| 15–30 | Flash architecture **Exit** diagram |
| 30–50 | Connect + passkey (5s) → Exit only: note + recipient |
| 50–75 | **Full proof progress bar** → relayer submit → success |
| 75–90 | “Open source README + testnet + not audited” |

Still hit all three submission requirements if proof bar and `exit_pool` success are visible.

---

## Shot checklist (tick while editing)

- [ ] App visibly running (localhost or deployed)
- [ ] Freighter / wallet interaction shown (or full-screen capture caught popup)
- [ ] **`join_pool`** deposit completes
- [ ] **ZK proof generation** visible (progress UI, not skipped)
- [ ] **`exit_pool`** completes; recipient receives XLM
- [ ] Voiceover explains **what the proof proves** (Merkle + nullifier, hides leaf)
- [ ] Voiceover mentions **Soroban verifier** on testnet
- [ ] Closing mention of **GitHub + README**
- [ ] Honest line: **testnet, not audited**
- [ ] Total length **≤ 3:00**

---

## BUIDL submission copy-paste

**Title:** zk-tornado — Privacy pools on Stellar with Noir / UltraHonk

**One-liner:**

Fixed-denomination Tornado-style pools on Soroban: browser Noir/UltraHonk exit proofs verified on-chain, passkey-derived notes, relayer-assisted unlinkable withdraw on native XLM.

**Description (short):**

zk-tornado lets users deposit XLM into 1 / 10 / 100 XLM pools on testnet Soroban. Only commitments enter the Merkle tree. Withdrawals require a valid `pool_actions` ZK proof checked by an UltraHonk verifier contract — load-bearing, not cosmetic. Web wallet: passkey secrets, local proving, optional relayer exit. Open source with architecture docs and honest limitations.

**Repo URL:** `<your public GitHub URL>`

**Demo video:** `<YouTube / Loom / uploaded file URL>`

**Contract IDs (testnet):**

- Vault: `CCSA45EVCX3JJDE5OIGJFGWAQPYWD65MMTQZKL66ZILZDMVAUXZXLV4H`
- Verifier: `CA6RD6K36U3QERNRMX6DBDK6ZP2VRSCXSD7MSMLJ22NDAIQWJKQ57CFR`

---

## DoraHacks checklist

- [ ] Public GitHub (or GitLab/Bitbucket) with full source
- [ ] README: what you built, setup, **honest** WIP / limitations
- [ ] Demo video **2–3 min**, project **working** on screen
- [ ] Video explains **what ZK is doing** (proof gates exit)
- [ ] Stellar testnet: Soroban vault + verifier + Freighter
- [ ] Submit before **June 29, 2026, 12:00 PM PST** ([hackathon page](https://dorahacks.io/hackathon/stellar-hacks-zk/detail))

---

## FAQ (for voiceover or README)

| Question | Answer |
|----------|--------|
| Why is ZK load-bearing? | `exit_pool` calls verifier; invalid or mock proofs **revert**. |
| What does the proof prove? | Valid note in Merkle tree + nullifier; **not** which deposit. |
| Why Stellar / Soroban? | Native XLM SAC, Poseidon2 host fns, deployed UltraHonk verifier on testnet. |
| Why Noir? | Rust-like circuits; fits Stellar’s Noir verifier path (see hackathon Resources). |
| Real-world angle? | Unlinkability for payroll, donations, or reducing graph analysis on public XLM flows. |
| What’s public? | Join tx source, exit recipient, pool size, nullifiers. |
| What’s private? | Which commitment you spent (within the pool). |
| Min pool size? | ≥ **3 notes** per pool on testnet before exit. |
| More technical detail? | [architecture.md](architecture.md) — Deposit/Exit diagrams, public inputs, relayer API. |

---

## What not to do

- Don’t spend 3 minutes only on UI polish with no proof step
- Don’t claim “fully private Stellar payments” — recipient and join source are public
- Don’t skip saying proof is **verified in a contract**
- Don’t use Window Capture if Freighter never appears — judges may think signing is faked
