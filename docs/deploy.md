# Deploy zk-utxo (testnet)

## Prerequisites

- [Stellar CLI](https://developers.stellar.org/docs/tools/cli) with funded testnet account (`stellar keys generate admin` + friendbot)
- For **real ZK**: `./scripts/install_zk_tools.sh` (nargo `1.0.0-beta.9`, bb `v0.87.0`)

## Mock verifier (fast demo)

Accepts any proof — use for UI development only.

```bash
STELLAR_SOURCE=admin ./scripts/deploy_testnet.sh
```

Set in `web/.env.local`:

```
NEXT_PUBLIC_VAULT_CONTRACT_ID=<VAULT_ID>
ZK_MOCK_PROOF=true
NEXT_PUBLIC_ZK_MOCK_PROOF=true
```

## Real ZK (UltraHonk)

```bash
./scripts/build_vk_utxo_actions.sh
./scripts/build_ultrahonk_verifier.sh   # builds contracts/contracts/ultrahonk-verifier
STELLAR_SOURCE=admin ./scripts/deploy_testnet.sh --real-zk
```

Set in `web/.env.local`:

```
NEXT_PUBLIC_VAULT_CONTRACT_ID=<VAULT_ID>
ZK_MOCK_PROOF=false
NEXT_PUBLIC_ZK_MOCK_PROOF=false
```

## Current testnet (real ZK, v3 diversifier + mnemonic wallet)

| | Contract ID |
|--|-------------|
| Vault | `CBMMBBS2W7SJV6Q2T3FWGDW2XUTANUEHXX63BAMSFHFFZGWI3TOT54ES` |
| Verifier | `CCCHSZQSPHG7CE3NBIPQ32BDQLDDLVAKFHX6N2XIOPE6WWZXEGSIBE5L` |
| XLM SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

## Relayer

```bash
cd scripts/relayer && npm install
RELAYER_SECRET=$(stellar keys secret alice) \
VAULT_ID=CDXNSHTPMRSDJSVHJ4K5BUJPDOT7NI6XH6HSBODRLLG3R2EYVBIATICW \
npm run server
```

Point `NEXT_PUBLIC_RELAYER_URL=http://127.0.0.1:8787` in `web/.env.local`.

## E2E verification

```bash
export PATH="$HOME/.bb/bin:$HOME/.nargo/bin:$PATH"
ZK_MOCK_PROOF=false STELLAR_SOURCE=alice ./scripts/e2e_testnet.sh --flow send
```

## RPC

Default: `https://soroban-rpc.testnet.stellar.gateway.fm` (set `STELLAR_RPC_URL` or `NEXT_PUBLIC_SOROBAN_RPC_URL`).
