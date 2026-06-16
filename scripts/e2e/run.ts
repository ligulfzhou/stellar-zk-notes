#!/usr/bin/env node
/**
 * End-to-end testnet flow for zk-notes (no browser required).
 *
 * Usage:
 *   ./scripts/e2e_testnet.sh
 *   ./scripts/e2e_testnet.sh --flow withdraw
 *   ./scripts/e2e_testnet.sh --flow send
 *   ./scripts/e2e_testnet.sh --flow all
 *
 * Env:
 *   STELLAR_SECRET or STELLAR_SOURCE (stellar CLI key name, default: admin)
 *   E2E_AMOUNT_STROOPS (default: 1000000 = 0.1 XLM)
 *   E2E_DERIVATION_INDEX (default: timestamp-based)
 */
import { execFileSync } from "node:child_process";
import { deriveNoteSecretsFromSeed } from "../../web/src/lib/root-seed.ts";
import { config, env, requireVaultId } from "./config.ts";
import { e2eRootSeed } from "./crypto.ts";
import { encodePublicInputs, randomFieldDecimal } from "./field.ts";
import { buildNoteSecrets, proveSpend } from "./prove.ts";
import {
  deposit,
  getVaultLeafCount,
  getVaultMerkleRoot,
  shieldedSend,
  signerFromSecret,
  waitForTx,
  withdraw,
} from "./stellar.ts";

type Flow = "deposit" | "withdraw" | "send" | "all";

function parseArgs(): { flow: Flow; derivationIndex: number; amount: bigint } {
  const args = process.argv.slice(2);
  let flow: Flow = "all";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--flow" && args[i + 1]) {
      flow = args[i + 1] as Flow;
      i++;
    }
  }
  const amount = BigInt(env("E2E_AMOUNT_STROOPS", "1000000"));
  const derivationIndex = Number(
    env("E2E_DERIVATION_INDEX", String(Date.now() % 1_000_000))
  );
  return { flow, derivationIndex, amount };
}

function resolveSecretKey(): string {
  if (process.env.STELLAR_SECRET) return process.env.STELLAR_SECRET;
  const sources = env("STELLAR_SOURCE", "alice,admin").split(",").map((s) => s.trim());
  for (const source of sources) {
    try {
      return execFileSync("stellar", ["keys", "secret", source], {
        encoding: "utf8",
        env: {
          ...process.env,
          STELLAR_NETWORK_PASSPHRASE: config.networkPassphrase,
          STELLAR_RPC_URL: config.rpcUrl,
        },
      }).trim();
    } catch {
      /* try next key */
    }
  }
  throw new Error(
    "Set STELLAR_SECRET or configure stellar CLI key (STELLAR_SOURCE=alice)"
  );
}

function log(step: string, detail?: string) {
  console.log(`\n==> ${step}${detail ? `: ${detail}` : ""}`);
}

function ok(label: string, value: string) {
  console.log(`    ✓ ${label}: ${value.slice(0, 20)}…`);
}

async function runDeposit(
  signer: ReturnType<typeof signerFromSecret>,
  derivationIndex: number,
  amount: bigint
) {
  const rootSeed = e2eRootSeed();
  const { secret, nullifierSecret } = deriveNoteSecretsFromSeed(
    rootSeed,
    derivationIndex
  );
  const note = await buildNoteSecrets(
    amount.toString(),
    secret,
    nullifierSecret
  );

  log("Deposit", `${Number(amount) / 1e7} XLM → vault ${requireVaultId().slice(0, 8)}…`);
  const { txHash, leafIndex } = await deposit({
    signer,
    amountStroops: amount,
    commitmentHex: note.commitmentHex,
  });
  ok("deposit tx", txHash);
  ok("leaf index", String(leafIndex));
  await waitForTx(txHash).catch(() => undefined);

  return { note, leafIndex, amount, derivationIndex, secret, nullifierSecret };
}

async function runWithdraw(
  signer: ReturnType<typeof signerFromSecret>,
  noteCtx: Awaited<ReturnType<typeof runDeposit>>
) {
  log("Prove spend (withdraw)");
  const prove = await proveSpend({
    mode: "withdraw",
    value: noteCtx.amount.toString(),
    secret: noteCtx.secret,
    nullifierSecret: noteCtx.nullifierSecret,
    leafIndex: noteCtx.leafIndex,
    commitmentHex: noteCtx.note.commitmentHex,
    reader: signer.publicKey,
  });
  ok("merkle root", prove.merkleRoot);

  const publicInputs = encodePublicInputs({
    merkleRootHex: prove.merkleRoot,
    nullifierHex: prove.nullifierHex,
    newCommitmentHex: "0x0",
    publicAmount: prove.publicInputs.public_amount,
    mode: prove.publicInputs.mode,
  });

  log("Withdraw", `→ ${signer.publicKey.slice(0, 12)}…`);
  const txHash = await withdraw({
    signer,
    recipient: signer.publicKey,
    amountStroops: noteCtx.amount,
    nullifierHex: prove.nullifierHex,
    merkleRootHex: prove.merkleRoot,
    publicInputs,
    proofBytes: prove.proofBytes,
  });
  ok("withdraw tx", txHash);
  await waitForTx(txHash);
  return txHash;
}

async function runSend(
  signer: ReturnType<typeof signerFromSecret>,
  noteCtx: Awaited<ReturnType<typeof runDeposit>>
) {
  const newSecret = randomFieldDecimal();
  const newNullifierSecret = randomFieldDecimal();

  log("Prove spend (shielded send)");
  const prove = await proveSpend({
    mode: "shielded_send",
    value: noteCtx.amount.toString(),
    secret: noteCtx.secret,
    nullifierSecret: noteCtx.nullifierSecret,
    leafIndex: noteCtx.leafIndex,
    commitmentHex: noteCtx.note.commitmentHex,
    reader: signer.publicKey,
    newSecret,
    newNullifierSecret,
  });
  ok("new commitment", prove.newCommitmentHex);

  const publicInputs = encodePublicInputs({
    merkleRootHex: prove.merkleRoot,
    nullifierHex: prove.nullifierHex,
    newCommitmentHex: prove.newCommitmentHex,
    publicAmount: prove.publicInputs.public_amount,
    mode: prove.publicInputs.mode,
  });

  log("Shielded send", "legacy 6-arg contract call");
  const txHash = await shieldedSend({
    signer,
    nullifierHex: prove.nullifierHex,
    newCommitmentHex: prove.newCommitmentHex,
    merkleRootHex: prove.merkleRoot,
    publicInputs,
    proofBytes: prove.proofBytes,
  });
  ok("send tx", txHash);
  await waitForTx(txHash);

  const leafCount = await getVaultLeafCount(signer.publicKey);
  return { txHash, newLeafIndex: leafCount - 1, newSecret, newNullifierSecret, amount: noteCtx.amount };
}

async function main() {
  const { flow, derivationIndex, amount } = parseArgs();

  console.log("zk-notes e2e testnet");
  console.log(`  network: ${config.network}`);
  console.log(`  rpc:     ${config.rpcUrl}`);
  console.log(`  vault:   ${requireVaultId()}`);
  console.log(`  mock:    ${config.mockProof}`);
  console.log(`  flow:    ${flow}`);

  const secret = resolveSecretKey();
  const signer = signerFromSecret(secret);
  log("Signer", signer.publicKey);

  const leafBefore = await getVaultLeafCount(signer.publicKey).catch(() => 0);
  const rootBefore = await getVaultMerkleRoot(signer.publicKey).catch(() => "n/a");
  console.log(`  leaf_count: ${leafBefore}, root: ${rootBefore.slice(0, 18)}…`);

  if (flow === "deposit") {
    await runDeposit(signer, derivationIndex, amount);
    console.log("\n✅ Deposit OK");
    return;
  }

  if (flow === "withdraw") {
    const noteCtx = await runDeposit(signer, derivationIndex, amount);
    await runWithdraw(signer, noteCtx);
    console.log("\n✅ Deposit + Withdraw OK");
    return;
  }

  if (flow === "send") {
    const noteCtx = await runDeposit(signer, derivationIndex, amount);
    await runSend(signer, noteCtx);
    console.log("\n✅ Deposit + Shielded send OK");
    return;
  }

  // flow === "all"
  const noteA = await runDeposit(signer, derivationIndex, amount);
  const sendResult = await runSend(signer, noteA);

  const noteB = await buildNoteSecrets(
    sendResult.amount.toString(),
    sendResult.newSecret,
    sendResult.newNullifierSecret
  );
  const withdrawCtx = {
    note: noteB,
    leafIndex: sendResult.newLeafIndex,
    amount: sendResult.amount,
    derivationIndex,
    secret: sendResult.newSecret,
    nullifierSecret: sendResult.newNullifierSecret,
  };
  await runWithdraw(signer, withdrawCtx);

  console.log("\n✅ Full flow OK (deposit → send → withdraw)");
}

main().catch((err) => {
  console.error("\n❌ E2E failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
