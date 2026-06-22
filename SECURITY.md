# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| testnet / pre-release | ✅ best effort |

zk-notes is **not audited** and **not production-ready**. Use on testnet only.

## Reporting a vulnerability

Please report security issues **privately** — do not open public GitHub issues for exploitable bugs.

1. Open a **private** GitHub Security Advisory on this repo (preferred), **or**
2. Contact the repository owner via GitHub profile.

Include:

- Description and impact
- Steps to reproduce
- Affected contract IDs / commit hash
- Suggested fix (optional)

We aim to acknowledge within **7 days** and share a timeline for testnet fixes.

## Scope

**In scope**

- Soroban vault (`contracts/contracts/vault`)
- Noir `spend_note` circuit and on-chain UltraHonk verifier integration
- Web wallet: passkey handling, note encryption, browser proving pipeline

**Out of scope**

- Third-party wallets (Freighter, etc.)
- Stellar network / Soroban platform bugs (report to Stellar)
- Social engineering, physical access to user device

## Safe harbor

Good-faith research on **testnet** deployments is welcome. Do not attack mainnet users, third parties, or production systems without permission.

See [docs/threat-model.md](docs/threat-model.md) for known limitations.
