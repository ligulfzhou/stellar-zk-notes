# zk-notes E2E Testnet

自动化跑通 **deposit → shielded send → withdraw**，无需浏览器/Freighter。

## 前置条件

1. `web/.env.local` 已配置（`NEXT_PUBLIC_VAULT_CONTRACT_ID`、`NEXT_PUBLIC_SOROBAN_RPC_URL`）
2. `nargo` 在 PATH（commitment/nullifier 脚本）
3. Stellar CLI 密钥 **或** 环境变量 `STELLAR_SECRET`（**必须已有 testnet XLM**）

| 模式 | `ZK_MOCK_PROOF` | Verifier |
|------|-----------------|----------|
| Demo | `true` | MockVerifier |
| Real ZK | `false` | UltraHonk (`deploy_testnet.sh --real-zk`) + `bb` |

**Testnet budget:** UltraHonk verify is **~76M** instructions with the NethermindEth SDK26 verifier (fits testnet 400M cap). Run: `ZK_MOCK_PROOF=false STELLAR_SOURCE=admin ./scripts/e2e_testnet.sh --flow all`

```bash
# 在 https://lab.stellar.org/account/create 创建并领取 testnet XLM

export STELLAR_SECRET=SD...   # 或 STELLAR_SOURCE=admin
```

## 运行

```bash
# 完整流程：register → deposit → shielded send → withdraw
./scripts/e2e_testnet.sh

# Real ZK (需要 bb + --real-zk 部署的 vault):
ZK_MOCK_PROOF=false ./scripts/e2e_testnet.sh --flow all

# 双账户：Alice 存款 → 发给 Bob 的 G… → Bob 提现
# 需要 stellar keys 里存在 alice、bob 两个账户且均有 testnet XLM
./scripts/prepare_e2e_accounts.sh alice bob
ZK_MOCK_PROOF=false ./scripts/e2e_testnet.sh --flow alice-bob
```

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `STELLAR_SECRET` | 签名用 secret key | — |
| `STELLAR_SOURCE` | CLI 密钥名 | `admin` |
| `ZK_MOCK_PROOF` | mock vs real proofs | `true` |
| `E2E_AMOUNT_STROOPS` | 每笔 note 金额 | `1000000` (0.1 XLM) |
| `E2E_DERIVATION_INDEX` | 测试 note 派生 index | 时间戳 mod 1e6 |
| `E2E_ALICE_SOURCE` | alice-bob 流程 Alice 密钥名 | `alice` |
| `E2E_BOB_SOURCE` | alice-bob 流程 Bob 密钥名 | `bob` |

## 交互流程

**`--flow all`（单账户自环）**

```
1. register_shielded_key (G → zk1)
2. deposit → leaf N
3. merkle witness + prove (mock or bb UltraHonk)
4. shielded_send (ECDH encrypted)
5. withdraw
```

**`--flow alice-bob`（双账户）**

```
1. Bob register_shielded_key
2. Alice deposit
3. Alice shielded_send (encrypt for Bob's zk1)
4. Bob withdraw
```

## 目录

```
scripts/e2e/
  config.ts    # 读取 web/.env.local
  crypto.ts    # commitment / nullifier 脚本
  field.ts     # public inputs + proof bytes
  stellar.ts   # RPC 存取款 / send / withdraw
  prove.ts     # 链状态 + merkle witness + prove
  run.ts       # 主流程
```
