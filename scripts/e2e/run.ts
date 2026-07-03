#!/usr/bin/env node
/**
 * End-to-end testnet flow for zk-utxo (no browser required).
 *
 * Usage:
 *   STELLAR_SOURCE=admin ./scripts/e2e_testnet.sh
 *   ./scripts/e2e_testnet.sh --flow deposit
 *   ./scripts/e2e_testnet.sh --flow relayer-exit
 *   ./scripts/e2e_testnet.sh --flow send
 *   ./scripts/e2e_testnet.sh --flow full
 */
import { execFileSync } from "node:child_process";
import { deriveShieldedReceiveKeysFromSeed } from "../../web/src/lib/root-seed.ts";
import { bytesToHex0x } from "../../web/src/lib/note-crypto.ts";
import type { Note } from "../../web/src/lib/note-types.ts";
import {
  deriveSpendingKeysFromSeed,
  randomNoteRandomness,
} from "../../web/src/lib/shielded-keys.ts";
import { config, requireVaultId } from "./config.ts";
import { e2ePartySeed, e2eRootSeed } from "./crypto.ts";
import { encodePublicInputs } from "./field.ts";
import {
  buildDepositNote,
  proveRelayerExit,
  proveShieldedSend,
  proveWithdraw,
  waitForChainNote,
} from "./prove.ts";
import { submitExitViaRelayerHttp } from "./relayer-http.ts";
import {
  cliDeposit,
  cliLeafCount,
  cliMerkleRoot,
  cliPublicKey,
  cliWithdraw,
  proofToHex,
  publicInputsToHex,
} from "./stellar-cli.ts";
import {
  assertUtxoVault,
  deposit,
  exitViaRelayer,
  getVaultLeafCount,
  shieldedTransfer,
  signerFromSecret,
  waitForTx,
  withdraw,
} from "./stellar.ts";

type Flow = "deposit" | "withdraw" | "relayer-exit" | "relayer-http" | "send" | "full" | "all";

type Backend = {
  mode: "sdk" | "cli";
  publicKey: string;
  cliSource?: string;
  signer?: ReturnType<typeof signerFromSecret>;
};

function parseArgs(): { flow: Flow; derivationIndex: number; amount: bigint } {
  const args = process.argv.slice(2);
  let flow: Flow = "all";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--flow" && args[i + 1]) {
      flow = args[i + 1] as Flow;
      i++;
    }
  }
  const amount = BigInt(process.env.E2E_AMOUNT_STROOPS ?? "1500000");
  const derivationIndex = Number(
    process.env.E2E_DERIVATION_INDEX ?? String(Date.now() % 1_000_000)
  );
  return { flow, derivationIndex, amount };
}

async function resolveBackend(): Promise<Backend> {
  if (process.env.STELLAR_SECRET) {
    const signer = signerFromSecret(process.env.STELLAR_SECRET);
    return { mode: "sdk", publicKey: signer.publicKey, signer };
  }

  const sources = (process.env.STELLAR_SOURCE ?? "admin").split(",").map((s) => s.trim());
  for (const source of sources) {
    try {
      const secret = execFileSync("stellar", ["keys", "secret", source], {
        encoding: "utf8",
        env: {
          ...process.env,
          STELLAR_NETWORK_PASSPHRASE: config.networkPassphrase,
          STELLAR_RPC_URL: config.rpcUrl,
        },
      }).trim();
      const signer = signerFromSecret(secret);
      return { mode: "sdk", publicKey: signer.publicKey, signer };
    } catch {
      const publicKey = await cliPublicKey(source);
      return { mode: "cli", publicKey, cliSource: source };
    }
  }

  throw new Error("Set STELLAR_SECRET or STELLAR_SOURCE (e.g. admin)");
}

async function resolveBackendForSource(sourceName: string): Promise<Backend> {
  const prev = process.env.STELLAR_SOURCE;
  process.env.STELLAR_SOURCE = sourceName;
  try {
    return await resolveBackend();
  } finally {
    if (prev === undefined) delete process.env.STELLAR_SOURCE;
    else process.env.STELLAR_SOURCE = prev;
  }
}

function log(step: string, detail?: string) {
  console.log(`\n==> ${step}${detail ? `: ${detail}` : ""}`);
}

function ok(label: string, value: string) {
  console.log(`    ✓ ${label}: ${value.slice(0, 20)}…`);
}

function makeNote(params: {
  value: bigint;
  commitmentHex: string;
  leafIndex: number;
  noteRandomness: string;
  spendingPk: string;
  received?: boolean;
}): Note {
  return {
    id: `e2e-${params.leafIndex}`,
    value: params.value,
    noteRandomness: params.noteRandomness,
    spendingPk: params.spendingPk,
    diversifier: "0",
    commitment: params.commitmentHex,
    leafIndex: params.leafIndex,
    status: "unspent",
    createdAt: Date.now(),
    received: params.received,
  };
}

async function backendDeposit(
  backend: Backend,
  amount: bigint,
  commitmentHex: string
) {
  if (backend.mode === "sdk" && backend.signer) {
    return deposit({
      signer: backend.signer,
      amountStroops: amount,
      commitmentHex,
    });
  }
  return cliDeposit({
    source: backend.cliSource!,
    from: backend.publicKey,
    amountStroops: amount,
    commitmentHex,
  });
}

async function backendWithdraw(
  backend: Backend,
  params: {
    recipient: string;
    nullifierHexes: string[];
    merkleRootHex: string;
    publicInputs: Uint8Array;
    proofBytes: Uint8Array;
  }
) {
  if (backend.mode === "sdk" && backend.signer) {
    return withdraw({
      signer: backend.signer,
      recipient: params.recipient,
      nullifierHexes: params.nullifierHexes,
      merkleRootHex: params.merkleRootHex,
      publicInputs: params.publicInputs,
      proofBytes: params.proofBytes,
    });
  }
  return cliWithdraw({
    source: backend.cliSource!,
    recipient: params.recipient,
    nullifierHexes: params.nullifierHexes,
    merkleRootHex: params.merkleRootHex,
    publicInputsHex: publicInputsToHex(params.publicInputs),
    proofHex: proofToHex(params.proofBytes),
  });
}

async function runDeposit(
  backend: Backend,
  _derivationIndex: number,
  amount: bigint,
  partySeed: Uint8Array = e2eRootSeed()
) {
  const deposit = await buildDepositNote(amount.toString(), partySeed);

  log("Deposit", `${Number(amount) / 1e7} XLM → vault ${requireVaultId().slice(0, 8)}…`);
  const { txHash, leafIndex } = await backendDeposit(
    backend,
    amount,
    deposit.commitmentHex
  );
  ok("deposit tx", txHash);
  ok("leaf index", String(leafIndex));
  if (backend.mode === "sdk") {
    await waitForTx(txHash).catch(() => undefined);
  }

  return {
    note: makeNote({
      value: amount,
      commitmentHex: deposit.commitmentHex,
      leafIndex,
      noteRandomness: deposit.noteRandomness,
      spendingPk: deposit.spendingPk,
    }),
    spendingSk: deposit.spendingSk,
    spendingPk: deposit.spendingPk,
    amount,
  };
}

async function runWithdraw(
  backend: Backend,
  noteCtx: Awaited<ReturnType<typeof runDeposit>>,
  recipient: string,
  relayerFeeStroops = 0
) {
  log("Prove withdraw");
  const prove =
    relayerFeeStroops > 0
      ? await proveRelayerExit({
          note: noteCtx.note,
          spendingSk: noteCtx.spendingSk,
          reader: backend.publicKey,
          relayerFeeStroops: String(relayerFeeStroops),
        })
      : await proveWithdraw({
          note: noteCtx.note,
          spendingSk: noteCtx.spendingSk,
          reader: backend.publicKey,
        });
  ok("merkle root", prove.merkleRoot);

  const publicInputs = encodePublicInputs({
    merkleRootHex: prove.merkleRoot,
    nullifierHexes: prove.nullifierHexes,
    newCommitmentHexes: prove.newCommitmentHexes,
    publicAmount: noteCtx.amount.toString(),
    relayerFeeStroops: String(relayerFeeStroops),
  });

  log("Withdraw on-chain", `→ ${recipient.slice(0, 12)}…`);
  const txHash = await backendWithdraw(backend, {
    recipient,
    nullifierHexes: prove.nullifierHexes,
    merkleRootHex: prove.merkleRoot,
    publicInputs,
    proofBytes: prove.proofBytes,
  });
  ok("withdraw tx", txHash);
  if (backend.mode === "sdk") {
    await waitForTx(txHash).catch(() => undefined);
  }
  return txHash;
}

async function runSend(
  backend: Backend,
  noteCtx: Awaited<ReturnType<typeof runDeposit>>,
  payAmount: bigint,
  bobX25519Hex: string
) {
  if (!backend.signer) {
    throw new Error("send flow requires SDK signer (use alice or STELLAR_SECRET)");
  }

  const changeAmount = noteCtx.amount - payAmount;
  if (changeAmount <= 0n) {
    throw new Error("pay amount must be less than note value");
  }

  const aliceSeed = e2ePartySeed("alice");
  const bobSeed = e2ePartySeed("bob");
  const { spendingPk: bobPk } = await deriveSpendingKeysFromSeed(bobSeed);
  const { spendingPk: alicePk } = await deriveSpendingKeysFromSeed(aliceSeed);
  const { publicKey: aliceX25519 } = deriveShieldedReceiveKeysFromSeed(aliceSeed);
  const payeeRcm = randomNoteRandomness();
  const changeRcm = randomNoteRandomness();

  log("Prove shielded send", `${Number(payAmount) / 1e7} XLM + change`);
  const prove = await proveShieldedSend({
    spendNote: noteCtx.note,
    spendingSk: noteCtx.spendingSk,
    payAmount,
    changeAmount,
    payeeRecipientPk: bobPk,
    payeeNoteRandomness: payeeRcm,
    payeeX25519Hex: bobX25519Hex,
    changeRecipientPk: alicePk,
    changeNoteRandomness: changeRcm,
    changeX25519Hex: bytesToHex0x(aliceX25519).slice(2),
    reader: backend.publicKey,
  });

  const publicInputs = encodePublicInputs({
    merkleRootHex: prove.merkleRoot,
    nullifierHexes: prove.nullifierHexes,
    newCommitmentHexes: prove.newCommitmentHexes,
    publicAmount: "0",
    relayerFeeStroops: "0",
  });

  log("Shielded transfer on-chain");
  const leafBefore = await getVaultLeafCount(backend.signer.publicKey);
  const txHash = await shieldedTransfer({
    signer: backend.signer,
    nullifierHexes: prove.nullifierHexes,
    newCommitmentHexes: prove.newCommitmentHexes,
    merkleRootHex: prove.merkleRoot,
    publicInputs,
    proofBytes: prove.proofBytes,
    epkHexes: prove.epkHexes ?? [],
    encryptedNotes: prove.encryptedNotes ?? [],
  });
  ok("send tx", txHash);
  await waitForTx(txHash).catch(() => undefined);

  const payeeCommitment = prove.newCommitmentHexes[0] ?? "0x0";
  const changeCommitment = prove.newCommitmentHexes[1] ?? "0x0";
  return {
    txHash,
    payeeLeafIndex: leafBefore,
    changeLeafIndex: leafBefore + 1,
    payeeCommitment,
    changeCommitment,
    payAmount,
    changeAmount,
    payeeNoteRandomness: payeeRcm,
    payeeSpendingPk: bobPk,
    bobSpendingSk: (await deriveSpendingKeysFromSeed(bobSeed)).spendingSk,
  };
}

async function runRelayerExit(
  relayer: Backend,
  noteCtx: Awaited<ReturnType<typeof runDeposit>>,
  recipient: string,
  relayerFeeStroops: number,
  depositorReader: string
) {
  if (!relayer.signer) {
    throw new Error("relayer-exit flow requires SDK signer for relayer account");
  }

  log("Prove relayer exit");
  const prove = await proveRelayerExit({
    note: noteCtx.note,
    spendingSk: noteCtx.spendingSk,
    reader: depositorReader,
    relayerFeeStroops: String(relayerFeeStroops),
  });

  const publicInputs = encodePublicInputs({
    merkleRootHex: prove.merkleRoot,
    nullifierHexes: prove.nullifierHexes,
    newCommitmentHexes: prove.newCommitmentHexes,
    publicAmount: noteCtx.amount.toString(),
    relayerFeeStroops: String(relayerFeeStroops),
  });

  log("Exit via relayer", `→ ${recipient.slice(0, 12)}…`);
  const txHash = await exitViaRelayer({
    relayer: relayer.signer,
    recipient,
    nullifierHexes: prove.nullifierHexes,
    merkleRootHex: prove.merkleRoot,
    publicInputs,
    proofBytes: prove.proofBytes,
  });
  ok("relayer exit tx", txHash);
  await waitForTx(txHash).catch(() => undefined);
  return txHash;
}

async function main() {
  const { flow, derivationIndex, amount } = parseArgs();

  console.log("zk-utxo e2e testnet");
  console.log(`  network: ${config.network}`);
  console.log(`  rpc:     ${config.rpcUrl}`);
  console.log(`  vault:   ${requireVaultId()}`);
  console.log(`  mock:    ${config.mockProof}`);
  console.log(`  flow:    ${flow}`);

  const backend = await resolveBackend();
  console.log(`  sign:    ${backend.mode}${backend.cliSource ? ` (${backend.cliSource})` : ""}`);
  log("Signer", backend.publicKey);

  await assertUtxoVault(backend.publicKey);

  const leafBefore = await getVaultLeafCount(backend.publicKey).catch(() =>
    backend.mode === "cli" ? cliLeafCount(backend.cliSource!) : 0
  );
  const rootBefore =
    backend.mode === "cli"
      ? await cliMerkleRoot(backend.cliSource!).catch(() => "n/a")
      : "n/a";
  console.log(`  leaf_count: ${leafBefore}, root: ${rootBefore.slice(0, 18)}…`);

  if (flow === "deposit") {
    await runDeposit(backend, derivationIndex, amount);
    console.log("\n✅ Deposit OK");
    return;
  }

  if (flow === "relayer-exit") {
    const bobSource = process.env.E2E_BOB_SOURCE ?? "bob";
    const relayerSource = process.env.E2E_RELAYER_SOURCE ?? "alice";
    const fee = Number(process.env.E2E_RELAYER_FEE_STROOPS ?? "100000");
    const relayer = await resolveBackendForSource(relayerSource);
    const bob = await resolveBackendForSource(bobSource);
    const noteCtx = await runDeposit(backend, derivationIndex, amount);
    await runRelayerExit(relayer, noteCtx, bob.publicKey, fee, backend.publicKey);
    console.log("\n✅ Deposit + relayer exit OK");
    return;
  }

  if (flow === "relayer-http") {
    const relayerUrl = process.env.RELAYER_URL ?? "http://127.0.0.1:8787";
    const bobSource = process.env.E2E_BOB_SOURCE ?? "bob";
    const fee = Number(process.env.E2E_RELAYER_FEE_STROOPS ?? "100000");
    const bob = await resolveBackendForSource(bobSource);
    const noteCtx = await runDeposit(backend, derivationIndex, amount);

    log("Prove relayer exit (HTTP)");
    const prove = await proveRelayerExit({
      note: noteCtx.note,
      spendingSk: noteCtx.spendingSk,
      reader: backend.publicKey,
      relayerFeeStroops: String(fee),
    });
    const publicInputs = encodePublicInputs({
      merkleRootHex: prove.merkleRoot,
      nullifierHexes: prove.nullifierHexes,
      newCommitmentHexes: prove.newCommitmentHexes,
      publicAmount: noteCtx.amount.toString(),
      relayerFeeStroops: String(fee),
    });
    log("POST /exit", relayerUrl);
    const txHash = await submitExitViaRelayerHttp({
      relayerUrl,
      recipient: bob.publicKey,
      relayerFeeStroops: fee,
      nullifierHexes: prove.nullifierHexes,
      merkleRootHex: prove.merkleRoot,
      publicInputs,
      proofBytes: prove.proofBytes,
    });
    ok("relayer http tx", txHash);
    console.log("\n✅ Deposit + relayer HTTP exit OK");
    return;
  }

  if (flow === "send" || flow === "full") {
    const aliceSource = process.env.E2E_ALICE_SOURCE ?? "alice";
    const alice = await resolveBackendForSource(aliceSource);
    const bobSeed = e2ePartySeed("bob");
    const { publicKey: bobPub } = deriveShieldedReceiveKeysFromSeed(bobSeed);
    const bobX25519Hex = bytesToHex0x(bobPub).slice(2);

    const depositAmount = flow === "full" ? 30_000_000n : 30_000_000n;
    const payAmount = flow === "full" ? 10_000_000n : 10_000_000n;
    const noteCtx = await runDeposit(
      alice,
      derivationIndex,
      depositAmount,
      e2ePartySeed("alice")
    );
    const sendResult = await runSend(alice, noteCtx, payAmount, bobX25519Hex);

    if (flow === "full") {
      const bobBackend = await resolveBackendForSource(process.env.E2E_BOB_SOURCE ?? "bob");
      log("Wait for payee note on-chain");
      const { leafIndex: payeeLeaf } = await waitForChainNote({
        reader: alice.publicKey,
        commitmentHex: sendResult.payeeCommitment,
        expectedLeafIndex: sendResult.payeeLeafIndex,
      });
      const payeeNote = makeNote({
        value: payAmount,
        commitmentHex: sendResult.payeeCommitment,
        leafIndex: payeeLeaf,
        noteRandomness: sendResult.payeeNoteRandomness,
        spendingPk: sendResult.payeeSpendingPk,
        received: true,
      });
      const bobNoteCtx = {
        note: payeeNote,
        spendingSk: sendResult.bobSpendingSk,
        amount: payAmount,
      };
      await runWithdraw(bobBackend, bobNoteCtx, bobBackend.publicKey, 0);
      console.log("\n✅ Full flow OK (deposit → send → bob withdraw)");
      return;
    }

    console.log("\n✅ Deposit + shielded send OK");
    return;
  }

  const noteCtx = await runDeposit(backend, derivationIndex, amount);

  if (flow === "withdraw") {
    await runWithdraw(backend, noteCtx, backend.publicKey, 0);
    console.log("\n✅ Deposit + withdraw OK");
    return;
  }

  await runWithdraw(backend, noteCtx, backend.publicKey, 0);
  console.log("\n✅ Full flow OK (deposit → withdraw)");
}

main().catch((err) => {
  console.error("\n❌ E2E failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
