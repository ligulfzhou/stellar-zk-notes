# zk-notes E2E Testnet

自动化跑通 **deposit → shielded send → withdraw**，无需浏览器/Freighter。

## 前置条件

1. `web/.env.local` 已配置（`NEXT_PUBLIC_VAULT_CONTRACT_ID`、`NEXT_PUBLIC_SOROBAN_RPC_URL`、`ZK_MOCK_PROOF=true`）
2. `nargo` 在 PATH（commitment/nullifier 脚本）
3. Stellar CLI 密钥 **或** 环境变量 `STELLAR_SECRET`（**必须已有 testnet XLM**）

```bash
# 方式 A：CLI 密钥（默认尝试 alice，再 admin）
stellar keys generate alice --network testnet   # 首次
# 在 https://lab.stellar.org/account/create 给 alice 的 G 地址充 testnet XLM

# 方式 B：直接传 secret
export STELLAR_SECRET=SD...
```

## 运行

```bash
# 完整流程：deposit → shielded send → withdraw
./scripts/e2e_testnet.sh

# 仅 deposit + withdraw
./scripts/e2e_testnet.sh --flow withdraw

# 仅 deposit + shielded send
./scripts/e2e_testnet.sh --flow send

# 仅 deposit
./scripts/e2e_testnet.sh --flow deposit

# Rust CLI 包装
cd cli/zk-notes && cargo run -- e2e-testnet --flow all
```

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `STELLAR_SECRET` | 签名用 secret key | — |
| `STELLAR_SOURCE` | CLI 密钥名，逗号分隔 | `alice,admin` |
| `E2E_AMOUNT_STROOPS` | 每笔 note 金额 | `1000000` (0.1 XLM) |
| `E2E_DERIVATION_INDEX` | 测试 note 派生 index | 时间戳 mod 1e6 |
| `E2E_SKIP_FUND` | 跳过 Friendbot | `false` |

## 交互流程（`--flow all`）

```
1. 从固定 e2e root seed + derivationIndex 派生 secret / nullifierSecret
2. compute_commitment.sh → commitment
3. vault.deposit(from, amount, commitment)     → leaf N
4. buildChainState + merkleWitnessFromTreeState → prove (mock)
5. vault.shielded_send(nullifier, new_commitment, root, …)  [6-arg legacy]
6. vault.withdraw(to, nullifier, amount, root, …)
7. 等待链上确认
```

## 与 Web 钱包的关系

- E2E 使用 **独立测试 seed**（`e2eRootSeed()`），不会动浏览器 passkey / IndexedDB 里的 notes
- Web 端手动测试前，先跑 `./scripts/e2e_testnet.sh` 确认链上 vault + mock proof 通路正常
- 当前 testnet vault 为 **legacy 6-arg shielded_send** + **poseidon2 T=3** Merkle；mock 模式已适配

## 目录

```
scripts/e2e/
  config.ts    # 读取 web/.env.local
  crypto.ts    # commitment / nullifier 脚本
  field.ts     # public inputs 编码
  stellar.ts   # RPC 存取款 / send / withdraw
  prove.ts     # 链状态 + mock prove
  run.ts       # 主流程
```
