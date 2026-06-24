# zk-notes E2E Testnet

Automated **join → exit** flow without browser/Freighter.

## Prerequisites

1. `web/.env.local` configured (`NEXT_PUBLIC_VAULT_CONTRACT_ID`, `NEXT_PUBLIC_SOROBAN_RPC_URL`)
2. `nargo` on PATH (commitment/nullifier scripts)
3. Stellar CLI key **or** `STELLAR_SECRET` (must hold testnet XLM)

| Mode | `ZK_MOCK_PROOF` | Verifier |
|------|-----------------|----------|
| Demo | `true` | MockVerifier |
| Real ZK | `false` | UltraHonk (`deploy_testnet.sh --real-zk`) + `bb` |

**Phase B vault:** only `join_pool` + `exit_pool` — redeploy after contract/circuit changes.

```bash
export STELLAR_SECRET=SD...   # or STELLAR_SOURCE=admin
```

## Run

```bash
# Full flow: deposit (legacy) or join + exit on same account
./scripts/e2e_testnet.sh

# Tornado-style: seed pool → Alice exits to Bob (relayer fee)
./scripts/prepare_e2e_accounts.sh --fund alice bob
ZK_MOCK_PROOF=false ./scripts/e2e_testnet.sh --flow phase-c

# Real ZK (requires bb + --real-zk deploy):
ZK_MOCK_PROOF=false ./scripts/e2e_testnet.sh --flow all
```

## Environment

| Variable | Description | Default |
|----------|-------------|---------|
| `STELLAR_SECRET` | Signing secret | — |
| `STELLAR_SOURCE` | CLI key name | `admin` |
| `ZK_MOCK_PROOF` | mock vs real proofs | `true` |
| `E2E_POOL_ID` | Pool for phase-c | `0` |
| `E2E_ALICE_SOURCE` | phase-c depositor | `alice` |
| `E2E_BOB_SOURCE` | phase-c exit recipient | `bob` |

## Flows

**`--flow all` / `--flow exit`**

```
1. join/deposit → leaf N
2. merkle witness + prove exit
3. exit_pool → recipient G
```

**`--flow phase-c`**

```
1. Alice join_pool until min anonymity set
2. Alice prove + exit_pool → Bob (Alice as relayer, fee on-chain)
3. privacy-audit.ts
```

## Layout

```
scripts/e2e/
  config.ts    # reads web/.env.local
  prove.ts     # chain state + merkle witness + proveExit
  stellar.ts   # join_pool / exit_pool RPC
  run.ts       # orchestration
```
