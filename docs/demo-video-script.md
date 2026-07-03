# zk-utxo Demo Video Script

> **Purpose:** Hackathon / investor demo — show arbitrary-amount UTXO private payments on Stellar.  
> **Recommended upload:** **~4 minutes** (architecture + live demo) — see §1 below.  
> **Also available:** 6–8 min full walkthrough (§2) · 2:30 ultra-short (no architecture — not recommended).  
> **Language:** English narration recommended; Chinese subtitles optional.  
> **Architecture reference:** [architecture.en.md](./architecture.en.md)

---

## 0. Before You Record

### 0.1 Demo goals (say these once, early)

1. **Problem:** Stellar payments are public — amount and counterparty are visible.
2. **Solution:** zk-utxo — shield XLM into a Soroban vault as UTXO-style notes; move value privately with ZK proofs.
3. **Differentiator:** **Any amount** (not fixed denominations), **4×4 action bundles**, **UltraHonk** on testnet, **one mnemonic** for both `G…` and `zkstellar…`.

### 0.2 Environment checklist

| Item | Action |
|------|--------|
| Web app | `cd web && npm run dev` → `http://localhost:3000` |
| Testnet account | Funded `G…` with ≥ 50 XLM (friendbot if needed) |
| Vault ID | Set `NEXT_PUBLIC_VAULT_CONTRACT_ID` in `web/.env.local` |
| ZK mode | **Real ZK recommended for demo:** `NEXT_PUBLIC_ZK_MOCK_PROOF=false` (proof generation ~30–90s — plan cuts) |
| Fast fallback | If live proving is too slow, use mock for recording, mention “real UltraHonk on testnet” in voiceover + show architecture slide |
| Browser | Chrome, 1280×720 or 1920×1080 window; hide bookmarks bar |
| Passkey | Use a **dedicated demo passkey** (Touch ID / Windows Hello); do not use production wallet |
| Second profile (optional) | Chrome Profile B = “Bob” for receiving shielded send |
| Screen recorder | OBS / QuickTime; mic + system audio off unless showing errors |
| Stellar Expert | Tab open: `https://stellar.expert/explorer/testnet` for tx proof |

### 0.3 Pre-record dry run (mandatory)

Run this sequence once without recording:

1. Notes → Create wallet → save mnemonic **offline** (do not show on camera)
2. Unlock → copy `zkstellar1…` address
3. Deposit 10 XLM
4. Send 3 XLM to second wallet’s `zkstellar…` (or same wallet change demo)
5. Withdraw 5 XLM (on-chain path)

Note actual timings for: deposit (~15s), prove send (~60s), prove withdraw (~60s).

### 0.4 Safety — never on screen

- Full 24-word mnemonic
- Secret key / `S…`
- Passkey setup dialogs with personal account names (crop or use blur)
- Relayer secret

Use **pre-created wallets** with mnemonic already backed up; on camera only show “Create wallet” UI briefly or skip creation and start at “Unlock”.

---

## 1. Video Structure Overview

### ★ Recommended primary cut (~4:00) — **use this for submission**

Architecture stays; trim wallet intro, dashboard recap, and relayer detail.

| Scene | Duration | Content |
|-------|----------|---------|
| A | 0:00–0:25 | Hook — public payment on Stellar Expert + one-line problem |
| B | 0:25–1:10 | **Architecture (keep)** — system diagram + 3 flows |
| C | 1:10–1:35 | Wallet — Unlock only, show `G…` + `zkstellar1…` |
| D | 1:35–2:10 | Deposit 10 XLM + Expert event |
| E | 2:10–3:25 | Send 3 XLM + proof (time-lapse OK) |
| F | 3:25–3:50 | Withdraw to `G…` |
| H | 3:50–4:00 | CTA — GitHub + hackathon |

**Why ~4 min:** Judges get the **mental model** (Scene B) before the UI demo. Without architecture, Deposit/Send/Withdraw look like opaque button clicks. With it, ~4 minutes still fits attention span.

**Scene B is non-negotiable for this project** — zk-utxo’s story is “UTXO + ZK on Soroban”, not “another wallet UI”.

#### Scene B — what to show in 45 seconds (primary cut)

Use **`docs/architecture.en.md` §1 diagram** (Web wallet ↔ Vault ↔ Merkle tree). Pointer or highlight in this order:

1. **One mnemonic** → `G` address + shielded keys (5s)
2. **Deposit** — commitment leaf, **no ZK** (10s)
3. **Send** — `utxo_actions` proof, amounts hidden inside pool (15s)
4. **Withdraw** — same circuit, public XLM out (10s)
5. Lower-third: `UltraHonk · Soroban · arbitrary amounts` (5s)

**Narration (English, ~80 words — read during Scene B):**
> “One recovery phrase gives you a public Stellar account and a shielded identity. Deposit puts a commitment into a global Merkle tree — the chain never sees the note amount. Send proves in zero knowledge that your inputs are valid and balance is conserved — without revealing amounts. Withdraw uses the same circuit to pay public XLM back out. All proofs are UltraHonk, verified on Soroban testnet.”

#### Primary cut — what to skip

| Skip | Save |
|------|------|
| Create wallet / mnemonic | Start at Unlock (pre-created wallet) |
| Dashboard tour | One glance at shielded balance after deposit |
| Relayer exit path | One spoken line: “relayer exit also supported” |
| Bob second browser | Self-send OK; mention recipient decrypts off-chain |
| Terminal / `nargo test` | — |

#### Primary cut — proving on camera

Send + Withdraw proving ~60s each raw. **Do not** show full 2 minutes of spinner.

- Record real ProveProgress for **Send only** (5–10s on screen, rest time-lapsed 3×)
- Withdraw: cut from click → success, subtitle “ZK proof verified on-chain”
- Voiceover during Send prove: “The browser generates an UltraHonk proof locally — keys never leave the device.”

---

### Full walkthrough (~6–8 min) — rehearsal / deep dive

| Scene | Duration | Content |
|-------|----------|---------|
| A | 0:00–0:45 | Hook + title + problem |
| B | 0:45–1:30 | Architecture (diagram) — extended narration |
| C | 1:30–2:30 | Wallet setup (Notes tab) |
| D | 2:30–3:30 | Deposit |
| E | 3:30–5:30 | Send (private transfer) |
| F | 5:30–6:45 | Withdraw |
| G | 6:45–7:30 | Dashboard + privacy recap |
| H | 7:30–8:00 | CTA + links |

Use when: internal review, mentor feedback, or YouTube “full demo” second link.

---

### Ultra-short (2:30) — emergency only

A (20s) → C unlock (20s) → D (40s) → E fast cut (50s) → H (20s). **Drops architecture** — only if hard time limit; not recommended for zk-utxo.

---

## 2. Full Script (Scene by Scene)

---

### Scene A — Hook & Title (0:00 – 0:45)

**Visual**
- Start on Stellar Expert: a normal payment — highlight **amount + from/to** visible.
- Cut to black → title card:

```
zk-utxo
UTXO Private Payments on Stellar
Stellar Hacks: Real-World ZK
```

- Fade into app homepage (Dashboard tab, wallet disconnected or connected).

**Narration (English)**
> “On Stellar, every payment is transparent — anyone can see who paid whom, and how much.  
> **zk-utxo** brings UTXO-style private payments to Stellar: deposit any amount of XLM into a shielded pool, send privately to a `zkstellar` address, and withdraw back to a public account — all verified by **UltraHonk** zero-knowledge proofs on Soroban.”

**On-screen text (lower third)**
- `Arbitrary amounts · Sapling-style notes · 4×4 action bundles`

**B-roll option**
- 5-second clip of `docs/architecture.en.md` system diagram (screen capture or exported PNG).

---

### Scene B — Architecture (0:45 – 1:30)

**Visual**
- Show **architecture diagram** from `docs/architecture.en.md` §1 (Web wallet ↔ Vault ↔ Merkle tree).
- Animate or pointer-highlight:
  1. BIP39 mnemonic → `G` address + shielded keys
  2. Deposit → commitment leaf (no ZK)
  3. Send / Withdraw → `utxo_actions` proof

**Narration**
> “One mnemonic derives both your normal Stellar account and your shielded keys.  
> When you **deposit**, only a **commitment hash** goes on-chain — not the amount inside the note.  
> When you **send** or **withdraw**, the browser builds a witness and generates an **UltraHonk proof**. The vault verifies it and updates the Merkle tree — or pays out public XLM on exit.”

**On-screen text**
- `Circuits: note_hash · hash_pair · utxo_actions`
- `Contract: Soroban Vault + UltraHonk Verifier`

**Tip:** Keep this scene under 45 seconds; judges skim architecture quickly.

---

### Scene C — Wallet Setup (1:30 – 2:30)

**Visual**
1. Click **Notes** tab.
2. **Option 1 (live demo):** Click **Create new wallet** → passkey prompt → show green **Unlocked** + **G** address in header after **Open wallet**.
3. **Option 2 (safer):** Wallet already exists → click **Unlock wallet** → passkey.
4. Scroll to **Shielded receive address** — highlight full `zkstellar1…` string.
5. Click **Copy shielded address** (for later Send scene if using two profiles).

**Narration**
> “The wallet is a unified web app — no browser extension. A 24-word recovery phrase controls both your Stellar **G** address and your shielded **`zkstellar`** receive address.  
> A passkey encrypts the phrase locally. After unlock, you get your shielded address — this is what you share to receive private payments, like an email address for hidden amounts.”

**On-screen callouts (arrows)**
- `G…` = public layer (fees, deposit signer)
- `zkstellar1…` = private receive address

**Do NOT**
- Scroll to or linger on the 24-word mnemonic box. If it appears after create, **cut in post** or blur.

**Click path**
```
Notes → Unlock wallet → (passkey) → Shielded receive address visible
Header → Open wallet (if G address not shown)
```

---

### Scene D — Deposit (2:30 – 3:30)

**Visual**
1. Tab **Deposit**.
2. Point at **Public XLM** balance on Dashboard (optional quick cut).
3. Enter amount: **10** XLM (default field often shows `10`).
4. Click **Deposit to vault**.
5. Passkey unlock if prompted.
6. Wait for success message + **Stellar Expert tx link**.
7. Click tx link → show:
   - `invokeHostFunction` → `deposit`
   - Token transfer `G → vault`
   - Event: `DepositEvent` with **commitment + leaf_index only** (no amount in event)
8. Back to app → **Notes** / Dashboard: **Shielded balance** increased, **Unspent notes** = 1.

**Narration**
> “**Deposit** moves public XLM into the vault. Locally we compute a Poseidon commitment and submit it to the contract.  
> Notice on-chain: the deposit event only publishes the **commitment** and **leaf index** — not the note’s secret amount. The full note stays in your browser vault.”

**On-screen text**
- `No ZK proof at deposit — commitment only`
- `On-chain: Merkle leaf + DepositEvent`

**If something fails**
- “Connect wallet first” → Notes → Unlock → Open wallet
- Insufficient balance → friendbot the testnet account

**Timing note:** Deposit usually **10–20 seconds**; keep camera on loading spinner briefly, then cut to success.

---

### Scene E — Send (Private Transfer) (3:30 – 5:30)

**Visual — Setup**
1. Tab **Send**.
2. **Recipient field:** paste **Bob’s `zkstellar1…`** (second browser profile) OR paste your own address for demo (self-send + change).
3. Amount: **3** XLM.
4. Briefly show coin selection hint if UI shows selected notes / change.

**Visual — Prove (important)**
5. Click **Send shielded** (or equivalent submit button).
6. Show **ProveProgress** UI:
   - `Executing circuit…`
   - `Generating proof…`
   - (This is the “real ZK” money shot — **do not skip** if using real proofs)

**Visual — Submit**
7. Success + tx link.
8. Stellar Expert: `shielded_transfer` — point at nullifiers + new commitments in events / logs.
9. Sender wallet: input note **spent**, **change note** if any remains.
10. **(Optional) Recipient profile:** Bob → Notes → Rescan from chain → new note appears, shielded balance +3 XLM.

**Narration**
> “**Send** is a true private transfer inside the pool — no public XLM moves.  
> The wallet selects notes, builds a **4×4 action bundle** witness, and generates an **UltraHonk proof** in the browser.  
> The proof shows the vault that inputs are valid and balance is conserved — without revealing which amounts went where.  
> The recipient’s note is delivered encrypted on-chain; they scan events and decrypt with their shielded key.”

**On-screen text**
- `public_amount = 0 · relayer_fee = 0`
- `UltraHonk proof · utxo_actions circuit`
- `Encrypted note in ShieldedSendEvent`

**Editing trick for long proving**
- Record proving segment in real time.
- In post: speed up 2× with “Generating ZK proof…” overlay, or cut from click → jump to success with text “~60s in browser”.

**Two-wallet demo script (recommended for judges)**
| Role | Action |
|------|--------|
| Alice (main recording) | Deposit 10, Send 3 to Bob’s zkstellar |
| Bob (second profile) | Show receive address → after tx, Rescan → balance |

---

### Scene F — Withdraw (5:30 – 6:45)

**Visual**
1. Tab **Withdraw**.
2. Select an **unspent note** (dropdown).
3. Destination: default **G** address (self).
4. Mode: **On-chain withdraw** (simpler for demo; explain relayer in one sentence).
5. Click withdraw → prove progress → success.
6. Stellar Expert: `withdraw` — show **WithdrawEvent** with nullifier, recipient, amount (contrast with Send privacy).
7. Dashboard: public XLM balance up, shielded balance down.

**Narration**
> “**Withdraw** spends a shielded note and pays public XLM back to any Stellar address.  
> Same `utxo_actions` circuit — but with **no new shielded outputs** and **public_amount** set to the full note value.  
> On-chain withdraw reveals recipient and amount in the event — that’s the transparency trade-off.  
> We also support **relayer exit**: you send the proof to a relayer, they submit the tx, and the event only shows a **nullifier** — better exit privacy.”

**On-screen text**
- `Path A: on-chain withdraw (simple)`
- `Path B: relayer exit (nullifier-only event)`

**Optional 15s B-roll**
- Architecture diagram §5 dual-path chart.

---

### Scene G — Dashboard Recap (6:45 – 7:30)

**Visual**
- Tab **Dashboard**.
- Highlight cards:
  - **Public XLM**
  - **Shielded balance**
  - **Unspent notes**
  - **Global anonymity set** (PrivacyBadge / leaf count)
- Scroll **Activity (recent)** — deposit, send, withdraw labels.
- Quick flash **How it works** panel (3 bullets).

**Narration**
> “The dashboard tracks both layers: public XLM for fees and exits, shielded balance from your local notes.  
> Every commitment in the vault contributes to a **global anonymity set** — the larger the tree, the stronger the privacy for all users.”

---

### Scene H — Closing CTA (7:30 – 8:00)

**Visual**
- Title card:

```
github.com/<your-org>/zk-utxo
docs/architecture.en.md
Testnet: Stellar Hacks — Real-World ZK
```

- Optional: terminal `nargo test` / `cargo test -p vault` flash (1–2s).

**Narration**
> “zk-utxo is open source — Noir circuits, Soroban vault, and a unified web wallet with in-browser proving.  
> Thank you — we’d love your feedback on Stellar Hacks.”

---

## 3. Narration Script (Continuous English — ~650 words)

Read straight through for voiceover recording:

> On Stellar, every payment is transparent. zk-utxo changes that with UTXO-style private payments: arbitrary amounts, Sapling-inspired notes, and UltraHonk zero-knowledge proofs verified on Soroban.
>
> Here’s the model. One BIP39 mnemonic gives you a normal Stellar account and a shielded identity. Deposit public XLM into the vault — the chain only sees a commitment hash in a Merkle tree, not your note’s amount. Send privately to a zkstellar address — the browser selects coins, builds a four-by-four action witness, and proves balance conservation without revealing amounts. Withdraw when you need public XLM again — or use a relayer for stronger exit privacy.
>
> Let me show you the wallet. It runs entirely in the browser — passkey-encrypted mnemonic, local signing, no extension required. After unlock, you have a G address for deposits and a zkstellar address for private receives.
>
> Deposit ten XLM. The contract pulls tokens into the vault and appends my commitment as a new leaf. On Stellar Expert, the deposit event has no amount — only the commitment and index.
>
> Now Send three XLM to a recipient’s zkstellar address. Watch the prover — this is real UltraHonk in the browser. The vault verifies the proof, marks nullifiers spent, and inserts new output commitments. The recipient decrypts their note from the encrypted payload in the transaction.
>
> Finally, Withdraw back to my public account. The same circuit, but paying out public XLM. On-chain withdraw shows recipient and amount; relayer exit hides that in the event.
>
> All of this is live on testnet — open source circuits, contracts, and documentation. Thanks for watching.

---

## 4. Shot List (Checklist for Editor)

| # | Shot ID | Description | Duration |
|---|---------|-------------|----------|
| 1 | `hook_expert` | Stellar Expert public payment | 8s |
| 2 | `title_card` | Logo + hackathon | 5s |
| 3 | `arch_diagram` | architecture.en.md §1 diagram | 25s |
| 4 | `notes_unlock` | Notes tab, unlock, zkstellar address | 40s |
| 5 | `deposit_ui` | Deposit 10 XLM click + spinner | 15s |
| 6 | `deposit_tx` | Expert: deposit event | 20s |
| 7 | `deposit_result` | Dashboard shielded balance | 10s |
| 8 | `send_form` | Send tab, recipient + amount | 15s |
| 9 | `send_prove` | ProveProgress full cycle | 30–90s |
| 10 | `send_tx` | Expert: shielded_transfer | 20s |
| 11 | `send_recipient` | Bob rescan (optional) | 20s |
| 12 | `withdraw_ui` | Withdraw note select + submit | 20s |
| 13 | `withdraw_prove` | ProveProgress | 30–90s |
| 14 | `withdraw_tx` | Expert: WithdrawEvent | 15s |
| 15 | `dashboard` | All cards + activity | 25s |
| 16 | `end_card` | GitHub + hackathon link | 10s |

---

## 5. On-Screen Labels (Copy-Paste for Editor)

Use consistent lower-thirds:

| Label | When |
|-------|------|
| `Deposit → commitment enters Merkle tree` | Scene D |
| `Send → UltraHonk proof · amounts hidden` | Scene E |
| `Withdraw → public XLM payout` | Scene F |
| `Browser-side proving · keys never leave device` | Scene E prove |
| `Global anonymity set: N commitments` | Scene G |

---

## 6. FAQ — Judge Questions (Prepare 10s Answers)

| Question | Answer |
|----------|--------|
| Fixed denominations? | No — arbitrary amounts, coin selection + change. |
| What ZK system? | Noir circuits + Barretenberg UltraHonk on Soroban. |
| Is deposit private? | Depositor and transfer amount are public; note content is hidden in commitment. |
| Where are secrets? | Mnemonic + notes in IndexedDB; passkey-wrapped. |
| Why not Freighter? | Unified web wallet — one mnemonic, local sign + prove. |
| Relayer trust? | Relayer only submits tx; cannot steal funds without valid proof. |

---

## 7. Troubleshooting During Recording

| Issue | Fix on camera / cut |
|-------|---------------------|
| Prove > 2 min | Switch to mock env for take 2; disclose in narration |
| Passkey fails | Use password unlock if implemented; or pre-unlock before record |
| `Unlock in Notes tab` | Click Open wallet → auto-jump Notes |
| No zkstellar address | Refresh + unlock; bech32 fix must be deployed |
| Tx failed fee | Fund testnet account |
| Recipient note missing | Notes → Rescan from chain |

---

## 8. Post-Production Notes

- **Music:** subtle ambient; duck under narration.
- **Captions:** burn English subs; optional 中文字幕 for bilingual team.
- **Pacing:** architecture ≤ 45s; proving can be time-lapsed.
- **Thumbnail:** Dashboard + “UTXO Private Payments on Stellar” + Stellar logo.
- **Description template:**

```
zk-utxo — UTXO-style private payments on Stellar (testnet demo)

• Arbitrary-amount shielded notes
• Deposit / Send / Withdraw in a unified web wallet
• UltraHonk ZK proofs (utxo_actions circuit)
• Soroban vault + Merkle commitment tree

Repo: https://github.com/...
Docs: docs/architecture.en.md
Hackathon: Stellar Hacks — Real-World ZK
```

---

## 9. Demo Data Sheet (Fill Before Recording)

| Field | Alice (sender) | Bob (recipient, optional) |
|-------|----------------|---------------------------|
| G address | `G…` | `G…` |
| zkstellar address | `zkstellar1…` | `zkstellar1…` |
| Deposit amount | 10 XLM | — |
| Send amount | 3 XLM | — |
| Withdraw amount | 5 XLM (one note) | — |
| Vault ID | `CBMMBBS2W7SJV6Q2T3FWGDW2XUTANUEHXX63BAMSFHFFZGWI3TOT54ES` | same |
| ZK mock? | `false` / `true` | — |

---

## 10. Related Docs

- [architecture.en.md](./architecture.en.md) — diagrams for Scene B
- [architecture.md](./architecture.md) — 中文版架构
- [deploy.md](./deploy.md) — testnet setup
- [key-derivation.md](./key-derivation.md) — mnemonic / address explanation
