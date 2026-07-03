# zk-utxo Demo Video Script — 4-Minute Primary Cut

> **Target length:** ~4:00 (trim to **2–3 min** for DoraHacks submission by time-lapsing Send proof).  
> **Language:** English narration.  
> **Full script:** [demo-video-script.md](./demo-video-script.md) · **Architecture:** [architecture.en.md](./architecture.en.md)

---

## Timeline

| Scene | Time | What |
|-------|------|------|
| **A** | 0:00–0:25 | Hook — public payment on Stellar Expert |
| **B** | 0:25–1:10 | Architecture diagram + 3 flows |
| **C** | 1:10–1:35 | Wallet unlock → `G…` + `zkstellar1…` |
| **D** | 1:35–2:10 | Deposit 10 XLM + Expert event |
| **E** | 2:10–3:25 | Send 3 XLM + ZK proof (time-lapse OK) |
| **F** | 3:25–3:50 | Withdraw to `G…` |
| **H** | 3:50–4:00 | CTA — GitHub + hackathon |

---

## Before You Record (5 min prep)

| Item | Action |
|------|--------|
| Web app | `cd web && npm run dev` |
| Testnet | Funded `G…` with ≥ 50 XLM |
| `.env.local` | `NEXT_PUBLIC_VAULT_CONTRACT_ID` set |
| ZK | `NEXT_PUBLIC_ZK_MOCK_PROOF=false` (real proof); or mock + say “UltraHonk on testnet” in voiceover |
| Wallet | **Pre-created** — start at Unlock, **never show 24-word mnemonic** |
| Stellar Expert | Tab open: testnet explorer |
| Dry run | Unlock → Deposit 10 → Send 3 → Withdraw 5 (note timings) |

**Demo amounts:** Deposit **10** XLM · Send **3** XLM · Withdraw **5** XLM (one note).

---

## Scene A — Hook (0:00 – 0:25)

**Visual**
1. Stellar Expert: normal payment — circle **from / to / amount** (all public).
2. Title card (3s):

```
zk-utxo
UTXO Private Payments on Stellar
Stellar Hacks: Real-World ZK
```

3. Cut to app (Dashboard or Notes).

**Narration**
> “On Stellar, every payment is transparent. **zk-utxo** adds UTXO-style private payments: shield any amount of XLM, send privately, withdraw with **UltraHonk** proofs on Soroban.”

**Lower third:** `Arbitrary amounts · 4×4 action bundles · UltraHonk`

---

## Scene B — Architecture (0:25 – 1:10) ★ Keep this

**Visual** — open `docs/architecture.en.md` §1 diagram (Web wallet ↔ Vault ↔ Merkle tree).

Highlight in order (~45s on diagram):

1. One mnemonic → `G` + shielded keys **(5s)**
2. **Deposit** → commitment leaf, no ZK **(10s)**
3. **Send** → `utxo_actions` proof, hidden amounts **(15s)**
4. **Withdraw** → same circuit, public XLM out **(10s)**
5. Lower third: `UltraHonk · Soroban · arbitrary amounts` **(5s)**

**Narration (read during diagram)**
> “One recovery phrase gives you a public Stellar account and a shielded identity. Deposit puts a commitment into a global Merkle tree — the chain never sees the note amount. Send proves in zero knowledge that inputs are valid and balance is conserved — without revealing amounts. Withdraw uses the same circuit to pay public XLM back out. All proofs are UltraHonk, verified on Soroban testnet.”

**Skip:** long circuit deep-dive, relayer paths, terminal.

---

## Scene C — Wallet (1:10 – 1:35)

**Visual**
1. **Notes** tab → **Unlock wallet** → passkey.
2. Show **Shielded receive address** (`zkstellar1…`).
3. Header → **Open wallet** if needed → `G…` visible.

**Narration**
> “Unified web wallet — one mnemonic, passkey-encrypted. **G** address for deposits; **zkstellar** address for private receives.”

**Click path**
```
Notes → Unlock → Shielded address visible → Open wallet
```

**Do NOT:** create wallet on camera, show mnemonic.

---

## Scene D — Deposit (1:35 – 2:10)

**Visual**
1. **Deposit** tab → amount **10** XLM → **Deposit to vault**.
2. Success + tx link → Stellar Expert:
   - `deposit` invoke
   - `DepositEvent`: **commitment + leaf_index only** (no amount in event)
3. Quick glance: shielded balance / 1 unspent note.

**Narration**
> “Deposit moves XLM into the vault. Only a **commitment** goes on-chain — the note amount stays in the browser.”

**Lower third:** `No ZK at deposit · Poseidon commitment`

---

## Scene E — Send (2:10 – 3:25)

**Visual**
1. **Send** tab → recipient `zkstellar1…` → amount **3** XLM.
2. Click send → **ProveProgress** (5–10s real, then **time-lapse 3×** or cut to success).
3. Stellar Expert: `shielded_transfer` — nullifiers + new commitments.
4. App: input note spent, change note if any.

**Narration**
> “Send is a private transfer inside the pool — no public XLM moves. The browser builds a **4×4 action bundle** and generates an **UltraHonk proof** locally — keys never leave the device. The recipient decrypts their note from the encrypted payload on-chain.”

**Lower third:** `utxo_actions · public_amount = 0`

**Proving edit rule:** Do not show 60s+ of spinner. Flash real ProveProgress, then jump-cut with subtitle “Generating ZK proof (~60s in browser)”.

**Optional one-liner:** “Relayer exit also supported for stronger withdraw privacy.”

---

## Scene F — Withdraw (3:25 – 3:50)

**Visual**
1. **Withdraw** tab → select unspent note → destination **G…** (self).
2. Mode: **On-chain withdraw**.
3. Click → cut from submit to success (subtitle: “ZK proof verified on-chain”).
4. Public XLM balance increased.

**Narration**
> “Withdraw spends a shielded note and pays public XLM back out — same circuit, no new shielded outputs.”

---

## Scene H — CTA (3:50 – 4:00)

**Visual**
```
github.com/<your-org>/zk-utxo
docs/architecture.en.md
Stellar Hacks: Real-World ZK
```

**Narration**
> “Open source on testnet — Noir circuits, Soroban vault, in-browser UltraHonk. Thanks for watching.”

---

## Continuous Voiceover (~280 words)

Record as one track if you prefer post-sync over scene-by-scene:

> On Stellar, every payment is transparent. zk-utxo adds UTXO-style private payments with arbitrary amounts and UltraHonk proofs on Soroban.
>
> One mnemonic gives you a public account and shielded keys. Deposit puts only a commitment into a Merkle tree. Send proves balance conservation in zero knowledge. Withdraw pays public XLM back out.
>
> Here’s the wallet — unlock with passkey, G address for deposits, zkstellar address for private receives.
>
> I deposit ten XLM. The chain sees a commitment, not the note amount.
>
> I send three XLM with a browser-generated UltraHonk proof — no public transfer, amounts hidden inside the pool.
>
> I withdraw back to my public account. Same circuit, public payout.
>
> All open source on Stellar testnet. Thank you.

---

## What to Skip (4-min cut)

| Skip | Why |
|------|-----|
| Create wallet / mnemonic | Safety + time |
| Dashboard tour | One balance glance enough |
| Relayer exit demo | One spoken line only |
| Second browser (Bob) | Self-send OK |
| Full 2×60s proving | Time-lapse Send only |

---

## Trim to 2–3 Min (DoraHacks requirement)

Official ask: **2–3 minute** demo video. From this 4-min script:

| Cut | Save |
|-----|------|
| Hook 25s → **15s** | Skip title card animation |
| Architecture 45s → **30s** | Faster pointer, same 4 bullets |
| Wallet 25s → **15s** | Unlock + addresses only |
| Send 75s → **45s** | Heavy time-lapse on proof |
| Withdraw 25s → **15s** | Cut prove entirely |

**Target:** ~2:45 total.

---

## Submission Checklist

- [ ] Video 2–3 min (or ~4 min if platform allows)
- [ ] Public GitHub + English README
- [ ] Testnet vault working
- [ ] No mnemonic / secret keys on screen
- [ ] Architecture shown before UI demo
- [ ] ZK clearly explained (Send prove flash)

---

## Related

- [Full demo script](./demo-video-script.md)
- [Architecture (English)](./architecture.en.md)
- [Deploy](./deploy.md)
