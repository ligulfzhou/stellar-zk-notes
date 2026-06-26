# zk-tornado — Demo Video Script (DoraHacks submission)

**Hackathon:** [Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk/detail)  
**Target length:** **2–3 minutes** (required)  
**Product:** Tornado-style privacy pools on Stellar / Soroban  
**Live flow:** Connect → Passkey → Deposit → Exit (relayer or self)  
**Testnet vault:** `CCSA45EVCX3JJDE5OIGJFGWAQPYWD65MMTQZKL66ZILZDMVAUXZXLV4H`

---

## What judges need (from official requirements)

Your video should make these four points obvious — in any order, but all four should land:

| # | Requirement | How we satisfy it |
|---|-------------|-------------------|
| 1 | **Real-world problem** | Cross-border / public-ledger payments leak who paid whom; users need **unlinkability** without leaving Stellar |
| 2 | **ZK is load-bearing** | Exit **requires** a Noir `pool_actions` proof; Soroban **UltraHonk verifier** rejects invalid spends — not a slide, not optional |
| 3 | **Stellar integration** | Native XLM SAC, `join_pool` / `exit_pool` on **testnet Soroban**, Freighter signing, explorer links |
| 4 | **Working demo** | Browser wallet deposits, generates proof locally, exit pays recipient on-chain |

You do **not** need to be on camera. Screen recording + voiceover is fine. Production quality is **not** scored — clarity is.

**Also submit:** public GitHub repo + README (setup, honest limitations).

**Deadline:** June 29, 2026, 12:00 PM PST.

---

## Before recording

1. Freighter on **Testnet**, **15+ XLM** (deposit + fees + retakes)  
2. `cd web && npm run sync:circuits && npm run dev` → **http://localhost:3000** (not `127.0.0.1`)  
3. **Relayer** (recommended for strongest story — deposit G ≠ exit tx source):

   ```bash
   cd scripts/relayer
   RELAYER_SECRET=<SD...> \
   VAULT_ID=CCSA45EVCX3JJDE5OIGJFGWAQPYWD65MMTQZKL66ZILZDMVAUXZXLV4H \
   npm run server
   ```

4. Use a pool with **exit enabled** (≥3 notes in that pool — e.g. 10 XLM or 100 XLM)  
5. Optional second Freighter account as **exit recipient** (shows unlinkability)  
6. Have [stellar.expert testnet vault](https://stellar.expert/explorer/testnet/contract/CCSA45EVCX3JJDE5OIGJFGWAQPYWD65MMTQZKL66ZILZDMVAUXZXLV4H) open in another tab for a 5s cutaway

---

## Recommended structure (~2:30)

### [0:00–0:20] Problem + one-liner

> "On Stellar, every payment is public — anyone can link sender and receiver. **zk-tornado** brings Tornado-style **privacy pools** to Soroban: fixed denominations, zero-knowledge exit proofs, and optional relayer submission so your deposit wallet isn't the same as your withdraw transaction."

*On screen:* Dashboard or title slide with repo name.

---

### [0:20–0:35] Stellar + ZK stack (load-bearing)

> "Deposits call **`join_pool`** on our testnet vault — only a commitment enters the Merkle tree. Withdrawals call **`exit_pool`** with an **UltraHonk proof** verified on-chain by a Soroban verifier contract. The ZK circuit proves you own a note and burns its nullifier — without revealing **which** deposit it was. That's the core security property; everything else is UX."

*On screen:* Brief flash of README **How it works** section or stellar.expert contract page (`exit_pool`, `verify_proof` in tx events if you have a prior tx).

> *(Optional +10s if under 3 min)* "Full stack — Noir `pool_actions`, Poseidon2 commitments, browser UltraHonk, three Merkle pools on Soroban — is in the GitHub README for reviewers."

---

### [0:35–0:50] Connect + Passkey

> "I connect Freighter on testnet. Notes are controlled by a **passkey** — no seed phrase, no Tornado backup file. Secrets are derived locally and never sent to a server."

*On screen:* Connect → Unlock passkey (Touch ID).

---

### [0:50–1:25] Deposit

> "I deposit **10 XLM**. The wallet splits amounts into fixed **1 / 10 / 100 XLM pools**, like Tornado. Each join is one on-chain transaction; only commitments are public."

*On screen:* Deposit tab → enter 10 → confirm Freighter → show note + pool line `exit enabled` or privacy badge.

> "The pool counter is the **anonymity set** — more joins means stronger unlinkability when someone exits later."

---

### [1:25–1:45] (Optional, cut if over 3 min) Rescan

> "Same passkey on a new browser: **Rescan from chain** rebuilds my notes from join events — no manual backup for my own deposits."

*Skip this if tight on time — judges care more about deposit → exit + ZK.*

---

### [1:45–2:25] Exit + ZK proof

> "To exit, I pick a note and a **recipient** — can be a different G address than the one that deposited. The browser builds a witness and runs **Noir + UltraHonk** proof generation — this takes roughly half a minute on testnet."

*On screen:* Exit tab → select note → recipient → show **Generating UltraHonk proof** progress → wait until done.

> "The proof encodes: valid Merkle path, correct nullifier, pool denomination, and **no new shielded outputs** — exit-only. I submit via the **relayer** so the transaction source is the relayer, not my deposit wallet."

*On screen:* Exit via relayer → success + tx link.

---

### [2:25–2:45] Result + honesty

> "XLM arrives at the recipient. Observers can't tie this exit to my earlier deposit inside the pool. The recipient address is still public — we're breaking **deposit→withdraw linkage**, not hiding the payee. Testnet demo, not audited; full source on GitHub."

*Optional 5s cutaway:* stellar.expert — deposit tx from wallet A, exit tx source = relayer.

---

### [2:45–3:00] Close

> "zk-tornado: **real ZK on Soroban**, passkey wallet, Tornado-style pools on native XLM. Thanks for watching."

---

## Short voiceover-only version (~90s)

If proof generation eats time, record **deposit + exit in one take** and use this compressed script:

1. **Problem (15s):** Public Stellar payments are linkable; pools + ZK exits fix that.  
2. **ZK + Stellar (20s):** `join_pool` commitments, `exit_pool` + UltraHonk verifier on testnet — proof is mandatory.  
3. **Demo (45s):** Passkey → deposit 10 XLM → exit to new address → relayer submits → done.  
4. **Close (10s):** Open source, testnet, not audited.

---

## DoraHacks submission checklist

- [ ] **GitHub** link public, README with setup + `CCSA45…` vault ID  
- [ ] **Video** 2–3 min, shows working deposit + exit  
- [ ] Video states **what ZK proves** (note ownership + nullifier, not which leaf)  
- [ ] Video shows **Soroban** interaction (Freighter tx or explorer)  
- [ ] README / [architecture.md](architecture.md) explain stack for reviewers who skip the video  
- [ ] README notes **limitations** (testnet, min pool size, exit recipient public, not audited)  
- [ ] Submit on DoraHacks before **Jun 29, 2026 12:00 PM PST**

---

## One-liner (title / BUIDL description)

**Fixed-denomination privacy pools on Stellar: browser Noir/UltraHonk proofs verified in Soroban, passkey notes, relayer gasless exit — Tornado-style unlinkability on transparent XLM.**

---

## FAQ (voiceover or README)

| Question | Answer |
|----------|--------|
| Why is ZK "load-bearing"? | Contract rejects exit without valid proof; mock proofs fail on our Real ZK verifier. |
| Real-world use? | Payroll privacy, donation unlinkability, reducing graph analysis on cross-border XLM flows. |
| What's private? | Which deposit funded which exit (within the pool). |
| What's public? | Exit recipient, pool size, join/exit events. |
| vs Ethereum Tornado? | Same pool model; Stellar native asset + Soroban verify + passkey instead of note strings. |
| Min pool size? | Testnet requires ≥3 notes per pool before exit (shown as `N / 3 min notes for exit`). |
| Full technical spec? | [architecture.md](architecture.md) — Merkle, witness, public inputs, relayer API. |

---

## Recording tips (hackathon-specific)

- **Show the proof step** — judges must see ZK is not faked; wait for the progress bar.  
- **Say "UltraHonk" and "Soroban verifier" once** — signals load-bearing ZK on Stellar.  
- **Technical depth → README** — video stays 2–3 min; point reviewers to README **How it works** for circuit, public inputs, and relayer.  
- **OBS / screen capture** — Freighter sign prompts are a **separate extension window**; use **Display Capture** (full screen), not Window Capture on Chrome only, or wallet popups won't appear in the recording.  
- **Don't hide failures** — if something is WIP, say it; organizers prefer honest READMEs.  
- **No need for Cloudflare deploy** — local localhost demo + public repo is enough per community norm.
