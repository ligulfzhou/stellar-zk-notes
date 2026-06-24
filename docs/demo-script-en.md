# zk-tornado — English Demo Script (~2 min)

**Product:** Tornado-style privacy pools on Stellar (Soroban)  
**Flow:** Connect → Unlock passkey → Deposit → Exit via relayer  
**Testnet vault (Phase B):** `CCSA45EVCX3JJDE5OIGJFGWAQPYWD65MMTQZKL66ZILZDMVAUXZXLV4H`

---

## Before recording

1. Freighter on **Testnet**, funded with a few XLM  
2. `cd web && npm run dev` → open **http://localhost:3000** (passkeys need `localhost`, not `127.0.0.1`)  
3. Relayer (optional, for gasless exit):  
   `cd scripts/relayer && RELAYER_SECRET=<SD...> VAULT_ID=CCSA45EVCX3JJDE5OIGJFGWAQPYWD65MMTQZKL66ZILZDMVAUXZXLV4H npm run server`  
4. Header should show **Real ZK** (`NEXT_PUBLIC_ZK_MOCK_PROOF=false`)

---

## Script

**[0:00 — Hook]**  
"This is zk-tornado — a Tornado-style privacy pool on Stellar. You deposit fixed denominations into a shared pool, and later you exit with a zero-knowledge proof. On-chain, observers only see commitments and nullifiers — not which deposit wallet received the withdrawal."

**[0:15 — Connect]**  
"I connect Freighter on testnet. My public Stellar address is visible here — that's normal for the deposit step."

**[0:25 — Passkey]**  
"I unlock with a passkey — Touch ID or Face ID. The passkey derives my note secrets locally. There's no 12-word seed phrase and no Tornado-style backup string. First visit registers the device; later visits just unlock."

**[0:40 — Deposit]**  
"I deposit into the pool — say 10 XLM. The wallet splits it into fixed pools: 1, 10, and 100 XLM, Tornado-style. Only the commitment goes on-chain; secrets stay in the browser."

*(Click Deposit, confirm in Freighter.)*  
"The transaction confirms. My note is stored locally. The pool privacy badge shows how big the anonymity set is — more deposits means stronger unlinkability when I exit."

**[1:05 — Notes / Rescan (optional 10s)]**  
"If I switch browsers, I unlock the same passkey and hit **Rescan from chain**. The wallet scans join events and re-derives my notes — no file export required for deposits I made myself."

**[1:20 — Exit]**  
"Now I exit. I pick an unspent note, choose a recipient address — it can be a fresh wallet, not the one that deposited — and generate the proof in the browser with UltraHonk."

*(Show proof progress if Real ZK.)*  
"The proof shows I own a valid note in the Merkle tree without revealing which leaf. I submit through the relayer so the on-chain transaction source is the relayer, not my deposit wallet — classic Tornado gasless withdraw."

**[1:45 — Result]**  
"Funds land on the recipient. Deposit address and exit recipient are unlinkable inside the pool. The exit recipient is still public on Stellar — we're not hiding who gets paid, we're breaking the link from deposit to withdraw."

**[1:55 — Close]**  
"Stack: Noir circuits, UltraHonk verified on Soroban, passkey wallet, relayer-assisted exit. Testnet demo — not audited. Code and contracts on GitHub. Thanks for watching."

---

## One-liner (elevator pitch)

"Fixed-denomination privacy pools on Stellar: browser ZK proofs, passkey-derived notes, and relayer gasless exit — Tornado mechanics without the note backup headache."

---

## FAQ bites (if judges ask)

| Question | Answer |
|----------|--------|
| What's private? | Unlinkability within the pool (deposit G ≠ exit G when using relayer). |
| What's public? | Exit recipient, pool size, join/exit events (commitments / nullifiers). |
| vs Tornado? | Same deposit/exit model; passkey + rescan instead of note strings; Soroban + Stellar native XLM. |
| In-pool payments? | Removed in Phase B — deposit and exit only. |
| Trust relayer? | Relayer submits tx and earns on-chain fee; cannot steal notes without your secrets. |
