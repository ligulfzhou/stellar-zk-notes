# zk-notes Threat Model (MVP / testnet)

This document describes known trust boundaries and risks for the current implementation. It is not a formal audit.

## Assets to protect

| Asset | Where it lives |
|-------|----------------|
| Note secrets (`secret`, `nullifier_secret`) | Passkey-derived root seed → browser memory / IndexedDB (encrypted by origin) |
| Spend witnesses | Built in browser; server fallback only on prove failure |
| UltraHonk proofs | Public on-chain with public inputs |
| Encrypted note payloads | On-chain (`ShieldedSendEvent`); decryptable by recipient X25519 key |

## Trust boundaries

```
User browser (passkey PRF, bb.js, Noir.js)
    ↓ public inputs + proof bytes only
Stellar/Soroban RPC  →  Vault contract  →  UltraHonk verifier
```

**Design goal (staging):** Note secrets and witnesses do not leave the browser under normal operation. `/api/prove-witness` is a documented fallback when browser WASM proving fails.

## Threats

### 1. XSS in the web wallet

**Impact:** Attacker script could read unlocked passkey session, note store, and witnesses during a spend.

**Mitigations today:** Same-origin app; no third-party scripts in wallet bundle; CSP left to Next.js defaults.

**Residual risk:** High if XSS exists — treat wallet as high-value target; audit front-end before mainnet.

### 2. Malicious or stale RPC

**Impact:** Wrong Merkle root / events → failed spends or confused rescan. RPC could censor transactions.

**Mitigations:** Client recomputes Merkle path and compares root before proving; user can switch `NEXT_PUBLIC_SOROBAN_RPC_URL`.

**Residual risk:** User must trust RPC for liveness and event completeness within the query window.

### 3. Encrypted-note metadata leakage

**Impact:** Observer sees `epk`, ciphertext size, timing, and public commitments. Does not break ZK soundness but may aid traffic analysis.

**Mitigations:** Ciphertext hides note contents; fixed 512-byte padding on `encrypted_note`; per-output nullifiers in `ShieldedSendEvent`.

**Residual risk:** Timing and volume patterns may still correlate activity.

### 3b. Relayer adversary (Phase C)

**Impact:** Relayer decrypts `encrypted_exit` and learns recipient + amount for payouts. Relayer can censor submissions or exit payouts.

**Mitigations:** Exit ciphertext is public but encrypted; users can run their own relayer; `strict` mode hides wallet as tx submitter.

**Residual risk:** Single relayer is trusted for liveness and payout honesty until multi-relayer / ASP (Phase D).

### 4. Front-running / mempool visibility

**Impact:** Public `nullifier` and `new_commitment` are visible before inclusion; mempool observers learn spend intent timing.

**Mitigations:** Unlinkability is between deposit and withdraw, not against global observers at spend time.

**Residual risk:** No private mempool; standard Stellar transparency applies to submitters.

### 5. Verifier / VK pinning

**Impact:** Wrong verifier WASM or VK → invalid proofs accepted (if mock) or all spends fail.

**Mitigations:** `--real-zk` deploy pins VK bytes; production forbids `ZK_MOCK_PROOF`; NethermindEth verifier budget-tested on testnet.

**Residual risk:** Vault admin could point to a new verifier — document immutable deploy policy for mainnet.

### 6. Passkey / device loss

**Impact:** Without recovery passkey, notes may be unspendable.

**Mitigations:** Recovery passkey flow in Notes panel; manual export not implemented.

**Residual risk:** Users must complete recovery setup before large deposits.

### 7. Tree capacity (height 16)

**Impact:** Vault rejects new deposits when ~65k leaves filled.

**Mitigations:** Documented in UI and README; no rollover in MVP.

## Out of scope (explicit)

- **ASP / compliance membership proofs** — anonymity set sizing only in Phase C; full ASP is Phase D (see [Phase C spec](superpowers/specs/2026-06-22-phase-c-privacy-design.md)).
- **Multi-token** — native XLM SAC only in MVP.
- **On-chain privacy against global adversaries** — Phase C targets join↔exit unlinkability within denomination pools; relayer sees exit payouts.

## Pre-mainnet checklist

1. External audit: Soroban vault + Noir `spend_note` + client crypto (ECDH, passkey).
2. Remove or hard-disable mock verifier on production deploy.
3. Confirm `NEXT_PUBLIC_ZK_MOCK_PROOF=false` in production builds.
4. Publish responsible disclosure contact (issue tracker or security@).
5. Re-measure Soroban budget after any verifier or circuit change.
