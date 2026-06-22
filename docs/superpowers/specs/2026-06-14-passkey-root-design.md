# Passkey Root Design (zk-notes)

**Date:** 2026-06-14  
**Status:** Implemented in web wallet v3

## Goal

Replace BIP39 mnemonic as the shielded wallet root with **WebAuthn passkey + PRF extension**. Best UX (biometrics), no seed phrase to write down, root key never persisted in IndexedDB.

## Architecture

```
┌─────────────────────┐     PRF eval      ┌──────────────────┐
│ Platform authenticator │ ──────────────► │ 32-byte PRF out  │
│ (Touch ID / iCloud)    │                 └────────┬─────────┘
└─────────────────────┘                          │
                                                 ▼ HKDF
                                        ┌──────────────────┐
                                        │ rootSeed (memory) │
                                        └────────┬─────────┘
                    ┌────────────────────────────┼────────────────────────────┐
                    ▼                            ▼                            ▼
           deriveNoteSecretsFromSeed   deriveShieldedReceiveKeys   recovery wrap (AES)
                    │                            │
                    ▼                            ▼
              ZK spend witness              zk1 address + ECDH decrypt
```

## Vault v3 (`StoredNoteVault`)

| Field | Purpose |
|-------|---------|
| `passkey` | Public metadata: `userId`, `prfSalt`, credential IDs, recovery wraps |
| `notes[].derivationIndex` | Passkey-derived notes (secrets re-derived on unlock) |
| `notes` without index | ECDH-received notes (secrets stored from on-chain decrypt) |

**Never stored:** root seed, PRF output.

## Backup passkeys

WebAuthn PRF is **per-credential** — a second passkey produces a different PRF output.

Recovery model:

1. User unlocks with primary passkey (has `rootSeed` in session).
2. Registers recovery passkey → PRF from recovery cred encrypts `rootSeed` (AES-GCM).
3. Ciphertext stored in `passkey.recoveryWraps[]`.
4. On new device: unlock with recovery passkey → decrypt same `rootSeed`.

Platform sync (iCloud Keychain / Google Password Manager) remains the primary multi-device path.

## Session model

- `usePasskeyStore`: `rootSeed` in memory only.
- Tab close / `lock()` clears seed.
- Every spend/deposit/rescan requires unlock (user gesture → WebAuthn).

## Browser requirements

- Safari 17+ / Chrome 118+ with platform authenticator
- WebAuthn PRF extension support
- HTTPS or `localhost` for `rpId`

## Unchanged

- Noir circuit, Soroban vault, Stellar Wallets Kit `G…` address
- zk1 address format (`zk1:testnet:…`)
- On-chain `register_shielded_key` maps `G…` → X25519 receive pubkey

## Threat model notes

| Risk | Mitigation |
|------|------------|
| Lost passkey + no recovery | Recovery passkey wrap; platform sync |
| Malicious rpId | Fixed to current hostname |
| XSS steals rootSeed | Seed only in memory during session |
| Phishing | WebAuthn origin binding |
