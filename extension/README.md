# ZK Stellar Wallet (browser extension) — paused

> **Status:** Development paused. Use the **web app** unified wallet instead (`web/` — Notes tab).
> Chrome MV3 is a poor fit for Noir WASM + Stellar SDK; the extension popup fails to load crypto reliably.

Unified **Stellar G-address** + **zkstellar shielded** wallet from one BIP39 mnemonic.

## Build (if revisiting later)

```bash
cd web && npm install
cd ../extension && npm install && npm run build
# Load extension/dist in Chrome
```

See [docs/key-derivation.md](../docs/key-derivation.md).
