# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| testnet / pre-release | ✅ best effort |

zk-utxo is **not audited** and **not production-ready**. Use on testnet only.

## Reporting a vulnerability

Please report security issues **privately** — do not open public GitHub issues for exploitable bugs.

1. Open a **private** GitHub Security Advisory on this repo (preferred), **or**
2. Contact the repository owner via GitHub profile.

## Scope

**In scope**

- Soroban vault (`contracts/contracts/vault`)
- Noir `utxo_actions` circuit and UltraHonk verifier integration
- Web wallet: passkey handling, note encryption, browser proving pipeline
- Relayer service (`scripts/relayer/`)

**Out of scope**

- Third-party wallets (Freighter, etc.)
- Stellar network / Soroban platform bugs (report to Stellar)
- Sibling project [`zk`](../zk) unless the bug is in shared copied code
