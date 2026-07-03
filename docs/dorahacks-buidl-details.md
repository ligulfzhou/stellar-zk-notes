## zk-utxo — UTXO Private Payments on Stellar

**Tagline:** Arbitrary-amount shielded XLM — deposit, private send, public withdraw — with UltraHonk ZK proofs on Soroban.

---

### Problem

Stellar payments are fully transparent: sender, recipient, and amount are visible on-chain. Apps and users need **amount privacy** and **UTXO-style spend control** without leaving Stellar.

### Solution

**zk-utxo** is a UTXO-style private payment system on Stellar testnet:

| Flow | What happens |
|------|----------------|
| **Deposit** | XLM → Soroban Vault. Chain stores only a **Poseidon commitment** in a Merkle tree; note amount stays in the wallet. |
| **Send** | Private in-pool transfer to `zkstellar1…` addresses. **UltraHonk** proof (`utxo_actions` Noir circuit, 4×4 action bundle); nullifiers prevent double-spend. |
| **Withdraw** | Spend shielded notes → public XLM at any `G…` address. Same circuit. |
| **Relayer exit** | Withdraw via relayer: only a **nullifier** is published on-chain (recipient + amount hidden from vault events). |

### Unified Web Wallet

- One **BIP39 mnemonic** → Stellar `G…` (SEP-0005) + shielded `zkstellar1…`
- **Passkey-encrypted** local notes (IndexedDB)
- **In-browser proof generation** (Noir + Barretenberg) — keys never leave the device

### Tech Stack

- **Circuits:** Noir — `note_hash`, `hash_pair`, `utxo_actions`
- **Proofs:** UltraHonk (Barretenberg `bb`)
- **Contracts:** Soroban Vault + UltraHonk Verifier
- **Client:** Next.js web wallet + optional HTTP relayer (`scripts/relayer/`)
- **Network:** Stellar **testnet** (live)

---

### Demo Video

https://youtu.be/KxVBc_uOqgA

Deposit → shielded Send (browser ZK proof) → Withdraw / Relayer exit.

---

### Quick Start — Web Wallet

    git clone https://github.com/ligulfzhou/stellar-zk-notes
    cd stellar-zk-notes/web && npm install && npm run dev

Create `web/.env.local`:

    NEXT_PUBLIC_VAULT_CONTRACT_ID=CBMMBBS2W7SJV6Q2T3FWGDW2XUTANUEHXX63BAMSFHFFZGWI3TOT54ES
    NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-rpc.testnet.stellar.gateway.fm
    NEXT_PUBLIC_RELAYER_URL=http://127.0.0.1:8787
    NEXT_PUBLIC_PRIVACY_MODE=strict

Open **Notes** → create/unlock wallet → **Deposit / Send / Withdraw**.

---

### Quick Start — Relayer (required for strict mode)

Local HTTP service in `scripts/relayer/`:

- **GET /info** — relayer `G` address + default/min fee
- **POST /submit** — broadcast signed Soroban txs (Deposit in strict mode)
- **POST /exit** — Relayer exit withdrawal (relayer pays gas; fee in ZK public inputs)

**Terminal 1 — start relayer:**

    cd scripts/relayer && npm install

    RELAYER_SECRET=<funded-testnet-secret-key> \
    VAULT_ID=CBMMBBS2W7SJV6Q2T3FWGDW2XUTANUEHXX63BAMSFHFFZGWI3TOT54ES \
    npm run server

- `RELAYER_SECRET` — secret key of a **funded testnet G account**
- Default port: **8787** (override with `RELAYER_PORT`)

**Terminal 2 — web app** (same `.env.local` as above), then restart `npm run dev`.

**Verify:**

    curl http://127.0.0.1:8787/info

**UI:** Withdraw tab → **Relayer exit** → destination `G…` + fee (default 100000 stroops = 0.01 XLM).

**No relayer?** Set `NEXT_PUBLIC_PRIVACY_MODE=dev` — wallet submits directly to RPC (OK for local demo).

---

### Testnet Contracts

| | Contract ID |
|--|-------------|
| **Vault** | `CBMMBBS2W7SJV6Q2T3FWGDW2XUTANUEHXX63BAMSFHFFZGWI3TOT54ES` |
| **Verifier** | `CCCHSZQSPHG7CE3NBIPQ32BDQLDDLVAKFHX6N2XIOPE6WWZXEGSIBE5L` |

---

### What's Working

- End-to-end Deposit / Send / Withdraw on testnet
- Real UltraHonk verification on Soroban
- Unified mnemonic wallet + `zkstellar1…` receive addresses
- Relayer exit + E2E (`./scripts/e2e_testnet.sh --flow relayer-exit`)
- Architecture docs (EN + 中文)

### Links

- **GitHub:** https://github.com/ligulfzhou/stellar-zk-notes
- **Architecture:** https://github.com/ligulfzhou/stellar-zk-notes/blob/main/docs/architecture.en.md
- **Deploy & relayer:** https://github.com/ligulfzhou/stellar-zk-notes/blob/main/docs/deploy.md

**Track:** Wild — UTXO-style private payment system  
**License:** Apache-2.0
