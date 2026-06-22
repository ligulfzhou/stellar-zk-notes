#!/usr/bin/env node
/**
 * End-to-end testnet flow for zk-notes (no browser required).
 *
 * Usage:
 *   STELLAR_SOURCE=admin ./scripts/e2e_testnet.sh
 *   ./scripts/e2e_testnet.sh --flow all
 */
import { execFileSync } from "node:child_process";
import { deriveNoteSecretsFromSeed, deriveShieldedReceiveKeysFromSeed, deriveDepositSecretFromSeed } from "../../web/src/lib/root-seed.ts";
import { encryptNoteForRecipient } from "../../web/src/lib/ecdh-delivery.ts";
import { POOLS, MIN_POOL_SIZE_TESTNET } from "../../web/src/lib/pool-config.ts";
import { config, env, requireVaultId } from "./config.ts";
import { e2ePartySeed, e2eRootSeed } from "./crypto.ts";
import { encodePublicInputs, randomFieldDecimal } from "./field.ts";
import { buildNoteSecrets, proveSpend } from "./prove.ts";
import {
  cliDeposit,
  cliLeafCount,
  cliMerkleRoot,
  cliPublicKey,
  cliRegisterShieldedKey,
  cliShieldedTransfer,
  cliWithdraw,
  proofToHex,
  publicInputsToHex,
} from "./stellar-cli.ts";
import {
  deposit,
  exitPool,
  getVaultLeafCount,
  getVaultMerkleRoot,
  joinPool,
  registerShieldedKey,
  shieldedTransfer,
  signerFromSecret,
  waitForTx,
  withdraw,
} from "./stellar.ts";

type Flow = "deposit" | "withdraw" | "send" | "all" | "alice-bob" | "phase-c";

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
  const amount = BigInt(env("E2E_AMOUNT_STROOPS", "1000000"));
  const derivationIndex = Number(
    env("E2E_DERIVATION_INDEX", String(Date.now() % 1_000_000))
  );
  return { flow, derivationIndex, amount };
}

async function resolveBackendForSource(sourceName: string): Promise<Backend> {
  if (process.env.STELLAR_SECRET) {
    throw new Error(
      `STELLAR_SECRET is set — use STELLAR_SOURCE=alice,bob for multi-account flow`
    );
  }
  try {
    const secret = execFileSync("stellar", ["keys", "secret", sourceName], {
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
    const publicKey = await cliPublicKey(sourceName);
    return { mode: "cli", publicKey, cliSource: sourceName };
  }
}

async function resolveBackend(): Promise<Backend> {
  if (process.env.STELLAR_SECRET) {
    const signer = signerFromSecret(process.env.STELLAR_SECRET);
    return { mode: "sdk", publicKey: signer.publicKey, signer };
  }

  const sources = env("STELLAR_SOURCE", "admin").split(",").map((s) => s.trim());
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

function log(step: string, detail?: string) {
  console.log(`\n==> ${step}${detail ? `: ${detail}` : ""}`);
}

function ok(label: string, value: string) {
  console.log(`    ✓ ${label}: ${value.slice(0, 20)}…`);
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

async function backendLeafCount(backend: Backend): Promise<number> {
  if (backend.mode === "sdk" && backend.signer) {
    return getVaultLeafCount(backend.signer.publicKey);
  }
  return cliLeafCount(backend.cliSource!);
}

async function backendMerkleRoot(backend: Backend): Promise<string> {
  if (backend.mode === "sdk" && backend.signer) {
    return getVaultMerkleRoot(backend.signer.publicKey);
  }
  return cliMerkleRoot(backend.cliSource!);
}

async function backendWithdraw(
  backend: Backend,
  params: {
    amount: bigint;
    nullifierHex: string;
    merkleRootHex: string;
    publicInputs: Uint8Array;
    proofBytes: Uint8Array;
  }
) {
  if (backend.mode === "sdk" && backend.signer) {
    return withdraw({
      signer: backend.signer,
      recipient: backend.publicKey,
      amountStroops: params.amount,
      nullifierHex: params.nullifierHex,
      merkleRootHex: params.merkleRootHex,
      publicInputs: params.publicInputs,
      proofBytes: params.proofBytes,
    });
  }
  return cliWithdraw({
    source: backend.cliSource!,
    recipient: backend.publicKey,
    amountStroops: params.amount,
    nullifierHex: params.nullifierHex,
    merkleRootHex: params.merkleRootHex,
    publicInputsHex: publicInputsToHex(params.publicInputs),
    proofHex: proofToHex(params.proofBytes),
  });
}

async function backendRegisterShieldedKey(
  backend: Backend,
  receivePubkeyBytes: Uint8Array
) {
  const hex =
    "0x" + Buffer.from(receivePubkeyBytes).toString("hex").padStart(64, "0");
  if (backend.mode === "sdk" && backend.signer) {
    return registerShieldedKey({
      signer: backend.signer,
      receivePubkeyBytes,
    });
  }
  return cliRegisterShieldedKey({
    source: backend.cliSource!,
    owner: backend.publicKey,
    receivePubkeyHex: hex,
  });
}

async function backendSend(
  backend: Backend,
  params: {
    poolId?: number;
    nullifierHexes: string[];
    newCommitmentHexes: string[];
    merkleRootHex: string;
    publicInputs: Uint8Array;
    proofBytes: Uint8Array;
    epkBytes: Uint8Array[];
    encryptedNoteBytes: Uint8Array[];
  }
) {
  if (backend.mode === "sdk" && backend.signer) {
    return shieldedTransfer({
      signer: backend.signer,
      poolId: params.poolId,
      ...params,
    });
  }
  return cliShieldedTransfer({
    source: backend.cliSource!,
    nullifierHexes: params.nullifierHexes,
    newCommitmentHexes: params.newCommitmentHexes,
    merkleRootHex: params.merkleRootHex,
    publicInputsHex: publicInputsToHex(params.publicInputs),
    proofHex: proofToHex(params.proofBytes),
    epkHexes: params.epkBytes.map(
      (b) => "0x" + Buffer.from(b).toString("hex").padStart(64, "0")
    ),
    encryptedNoteHexes: params.encryptedNoteBytes.map((b) =>
      Buffer.from(b).toString("hex")
    ),
  });
}

async function runJoin(
  backend: Backend,
  poolId: number,
  derivationIndex: number,
  partySeed: Uint8Array = e2eRootSeed()
) {
  const pool = POOLS[poolId] ?? POOLS[0]!;
  const { secret, nullifierSecret } = deriveNoteSecretsFromSeed(
    partySeed,
    derivationIndex
  );
  const depositSecret = deriveDepositSecretFromSeed(partySeed, derivationIndex);
  const note = await buildNoteSecrets(
    poolId,
    pool.stroops.toString(),
    secret,
    nullifierSecret,
    depositSecret
  );

  log("Join pool", `${pool.label} → vault ${requireVaultId().slice(0, 8)}…`);
  if (backend.mode === "sdk" && backend.signer) {
    const { txHash, leafIndex } = await joinPool({
      signer: backend.signer,
      poolId,
      commitmentHex: note.commitmentHex,
    });
    ok("join tx", txHash);
    ok("leaf index", String(leafIndex));
    await waitForTx(txHash).catch(() => undefined);
    return {
      note,
      leafIndex,
      amount: pool.stroops,
      poolId,
      derivationIndex,
      secret,
      nullifierSecret,
      depositSecret,
    };
  }
  throw new Error("phase-c join requires SDK signer (STELLAR_SOURCE with secret)");
}

async function runPhaseC(
  alice: Backend,
  bob: Backend,
  poolId: number,
  baseDerivationIndex: number
) {
  const aliceSeed = e2ePartySeed("alice");
  const bobSeed = e2ePartySeed("bob");
  const bobReceivePubkey = deriveShieldedReceiveKeysFromSeed(bobSeed).publicKey;
  const pool = POOLS[poolId] ?? POOLS[0]!;

  let leafCount = await getVaultLeafCount(alice.publicKey, poolId).catch(() => 0);
  const joinsNeeded = Math.max(0, MIN_POOL_SIZE_TESTNET - leafCount);
  const joinNotes: Awaited<ReturnType<typeof runJoin>>[] = [];

  for (let i = 0; i < Math.max(joinsNeeded, 1); i++) {
    const ctx = await runJoin(
      alice,
      poolId,
      baseDerivationIndex + i,
      aliceSeed
    );
    joinNotes.push(ctx);
    leafCount = await getVaultLeafCount(alice.publicKey, poolId);
  }

  while (leafCount < MIN_POOL_SIZE_TESTNET) {
    const ctx = await runJoin(
      alice,
      poolId,
      baseDerivationIndex + joinNotes.length + 10,
      aliceSeed
    );
    joinNotes.push(ctx);
    leafCount = await getVaultLeafCount(alice.publicKey, poolId);
  }
  ok("pool leaf count", String(leafCount));

  const spendNote = joinNotes[0]!;
  const newSecret = randomFieldDecimal();
  const newNullifierSecret = randomFieldDecimal();
  const newDepositSecret = deriveDepositSecretFromSeed(bobSeed, 99);

  log("Alice proves shielded send → Bob (zk1, no on-chain register)");
  const prove = await proveSpend({
    mode: "shielded_send",
    poolId,
    value: spendNote.amount.toString(),
    secret: spendNote.secret,
    nullifierSecret: spendNote.nullifierSecret,
    depositSecret: spendNote.depositSecret,
    leafIndex: spendNote.leafIndex,
    commitmentHex: spendNote.note.commitmentHex,
    reader: alice.publicKey,
    newSecret,
    newNullifierSecret,
    newDepositSecret,
  });
  ok("new commitment", prove.newCommitmentHex);

  const leafBase = await getVaultLeafCount(alice.publicKey, poolId);
  const enc = encryptNoteForRecipient(bobReceivePubkey, {
    value: spendNote.amount.toString(),
    secret: newSecret,
    nullifierSecret: newNullifierSecret,
    commitment: prove.newCommitmentHex,
    leafIndex: leafBase,
  });

  const publicInputs = encodePublicInputs({
    poolId,
    merkleRootHex: prove.merkleRoot,
    nullifierHexes: prove.nullifierHexes,
    newCommitmentHexes: prove.newCommitmentHexes,
    publicAmount: "0",
  });

  log("Alice submits shielded transfer");
  if (!alice.signer) throw new Error("SDK signer required");
  const sendTx = await shieldedTransfer({
    signer: alice.signer,
    poolId,
    nullifierHexes: prove.nullifierHexes,
    newCommitmentHexes: prove.newCommitmentHexes,
    merkleRootHex: prove.merkleRoot,
    publicInputs,
    proofBytes: prove.proofBytes,
    epkBytes: [enc.epk],
    encryptedNoteBytes: [enc.encrypted],
  });
  ok("send tx", sendTx);
  await waitForTx(sendTx).catch(() => undefined);

  const bobLeafIndex = (await getVaultLeafCount(bob.publicKey, poolId)) - 1;
  const bobNote = await buildNoteSecrets(
    poolId,
    spendNote.amount.toString(),
    newSecret,
    newNullifierSecret,
    newDepositSecret
  );

  const relayerFeeStroops = 100_000;

  log("Bob proves exit");
  const bobExit = await proveSpend({
    mode: "exit",
    poolId,
    value: spendNote.amount.toString(),
    secret: newSecret,
    nullifierSecret: newNullifierSecret,
    depositSecret: newDepositSecret,
    leafIndex: bobLeafIndex,
    commitmentHex: bobNote.commitmentHex,
    reader: bob.publicKey,
    relayerFeeStroops: String(relayerFeeStroops),
  });

  const exitInputs = encodePublicInputs({
    poolId,
    merkleRootHex: bobExit.merkleRoot,
    nullifierHexes: bobExit.nullifierHexes,
    newCommitmentHexes: ["0x0", "0x0", "0x0", "0x0"],
    publicAmount: pool.stroops.toString(),
    relayerFeeStroops: String(relayerFeeStroops),
  });

  log("Bob submits exit_pool");
  if (!bob.signer) throw new Error("SDK signer required");
  const exitTx = await exitPool({
    signer: bob.signer,
    poolId,
    recipient: bob.publicKey,
    relayer: alice.publicKey,
    relayerFeeStroops,
    nullifierHexes: bobExit.nullifierHexes,
    merkleRootHex: bobExit.merkleRoot,
    publicInputs: exitInputs,
    proofBytes: bobExit.proofBytes,
  });
  ok("exit tx", exitTx);
  await waitForTx(exitTx).catch(() => undefined);

  log("Privacy audit");
  execFileSync(
    "npx",
    ["tsx", "scripts/e2e/privacy-audit.ts", "--vault", requireVaultId()],
    { cwd: config.repoRoot, stdio: "inherit" }
  );
}

async function runDeposit(
  backend: Backend,
  derivationIndex: number,
  amount: bigint,
  partySeed: Uint8Array = e2eRootSeed()
) {
  const { secret, nullifierSecret } = deriveNoteSecretsFromSeed(
    partySeed,
    derivationIndex
  );
  const note = await buildNoteSecrets(
    0,
    amount.toString(),
    secret,
    nullifierSecret,
    new Uint8Array(32)
  );

  log("Deposit", `${Number(amount) / 1e7} XLM → vault ${requireVaultId().slice(0, 8)}…`);
  const { txHash, leafIndex } = await backendDeposit(
    backend,
    amount,
    note.commitmentHex
  );
  ok("deposit tx", txHash);
  ok("leaf index", String(leafIndex));
  if (backend.mode === "sdk") {
    await waitForTx(txHash).catch(() => undefined);
  }

  return { note, leafIndex, amount, derivationIndex, secret, nullifierSecret };
}

async function runWithdraw(
  backend: Backend,
  noteCtx: Awaited<ReturnType<typeof runDeposit>>
) {
  log("Prove spend (withdraw)");
  const prove = await proveSpend({
    mode: "exit",
    poolId: 0,
    value: noteCtx.amount.toString(),
    secret: noteCtx.secret,
    nullifierSecret: noteCtx.nullifierSecret,
    depositSecret: new Uint8Array(32),
    leafIndex: noteCtx.leafIndex,
    commitmentHex: noteCtx.note.commitmentHex,
    reader: backend.publicKey,
    relayerFeeStroops: "0",
  });
  ok("merkle root", prove.merkleRoot);

  const publicInputs = encodePublicInputs({
    poolId: 0,
    merkleRootHex: prove.merkleRoot,
    nullifierHexes: prove.nullifierHexes,
    newCommitmentHexes: ["0x0", "0x0", "0x0", "0x0"],
    publicAmount: prove.publicInputs.public_amount,
  });

  log("Withdraw", `→ ${backend.publicKey.slice(0, 12)}…`);
  const txHash = await backendWithdraw(backend, {
    amount: noteCtx.amount,
    nullifierHex: prove.nullifierHex,
    merkleRootHex: prove.merkleRoot,
    publicInputs,
    proofBytes: prove.proofBytes,
  });
  ok("withdraw tx", txHash);
  return txHash;
}

async function runSend(
  backend: Backend,
  noteCtx: Awaited<ReturnType<typeof runDeposit>>
) {
  const newSecret = randomFieldDecimal();
  const newNullifierSecret = randomFieldDecimal();

  log("Prove spend (shielded send)");
  const prove = await proveSpend({
    mode: "shielded_send",
    poolId: 0,
    value: noteCtx.amount.toString(),
    secret: noteCtx.secret,
    nullifierSecret: noteCtx.nullifierSecret,
    depositSecret: new Uint8Array(32),
    leafIndex: noteCtx.leafIndex,
    commitmentHex: noteCtx.note.commitmentHex,
    reader: backend.publicKey,
    newSecret,
    newNullifierSecret,
    newDepositSecret: new Uint8Array(32),
  });
  ok("new commitment", prove.newCommitmentHex);

  const leafCount = await backendLeafCount(backend);
  const newLeafIndex = leafCount;
  const receivePubkey = deriveShieldedReceiveKeysFromSeed(e2eRootSeed()).publicKey;
  const enc = encryptNoteForRecipient(receivePubkey, {
    value: noteCtx.amount.toString(),
    secret: newSecret,
    nullifierSecret: newNullifierSecret,
    commitment: prove.newCommitmentHex,
    leafIndex: newLeafIndex,
  });

  const publicInputs = encodePublicInputs({
    poolId: 0,
    merkleRootHex: prove.merkleRoot,
    nullifierHexes: prove.nullifierHexes,
    newCommitmentHexes: prove.newCommitmentHexes,
    publicAmount: "0",
  });

  log("Shielded transfer", "action bundle");
  const txHash = await backendSend(backend, {
    nullifierHexes: prove.nullifierHexes,
    newCommitmentHexes: prove.newCommitmentHexes,
    merkleRootHex: prove.merkleRoot,
    publicInputs,
    proofBytes: prove.proofBytes,
    epkBytes: [enc.epk],
    encryptedNoteBytes: [enc.encrypted],
  });
  ok("send tx", txHash);

  const leafCountAfter = await backendLeafCount(backend);
  return {
    txHash,
    newLeafIndex: leafCountAfter - 1,
    newSecret,
    newNullifierSecret,
    amount: noteCtx.amount,
  };
}

async function runAliceBob(
  alice: Backend,
  bob: Backend,
  derivationIndex: number,
  amount: bigint
) {
  const bobSeed = e2ePartySeed("bob");
  const bobReceivePubkey = deriveShieldedReceiveKeysFromSeed(bobSeed).publicKey;

  log("Bob registers shielded key", bob.publicKey.slice(0, 12) + "…");
  const regTx = await backendRegisterShieldedKey(bob, bobReceivePubkey);
  ok("register tx", regTx);
  if (bob.mode === "sdk") {
    await waitForTx(regTx).catch(() => undefined);
  }

  const aliceNote = await runDeposit(
    alice,
    derivationIndex,
    amount,
    e2ePartySeed("alice")
  );

  const newSecret = randomFieldDecimal();
  const newNullifierSecret = randomFieldDecimal();

  log("Alice proves shielded send → Bob");
  const prove = await proveSpend({
    mode: "shielded_send",
    poolId: 0,
    value: aliceNote.amount.toString(),
    secret: aliceNote.secret,
    nullifierSecret: aliceNote.nullifierSecret,
    depositSecret: new Uint8Array(32),
    leafIndex: aliceNote.leafIndex,
    commitmentHex: aliceNote.note.commitmentHex,
    reader: alice.publicKey,
    newSecret,
    newNullifierSecret,
    newDepositSecret: new Uint8Array(32),
  });
  ok("new commitment", prove.newCommitmentHex);

  const leafCount = await backendLeafCount(alice);
  const newLeafIndex = leafCount;
  const enc = encryptNoteForRecipient(bobReceivePubkey, {
    value: aliceNote.amount.toString(),
    secret: newSecret,
    nullifierSecret: newNullifierSecret,
    commitment: prove.newCommitmentHex,
    leafIndex: newLeafIndex,
  });

  const publicInputs = encodePublicInputs({
    poolId: 0,
    merkleRootHex: prove.merkleRoot,
    nullifierHexes: prove.nullifierHexes,
    newCommitmentHexes: prove.newCommitmentHexes,
    publicAmount: "0",
  });

  log("Alice submits shielded transfer");
  const sendTx = await backendSend(alice, {
    nullifierHexes: prove.nullifierHexes,
    newCommitmentHexes: prove.newCommitmentHexes,
    merkleRootHex: prove.merkleRoot,
    publicInputs,
    proofBytes: prove.proofBytes,
    epkBytes: [enc.epk],
    encryptedNoteBytes: [enc.encrypted],
  });
  ok("send tx", sendTx);
  if (alice.mode === "sdk") {
    await waitForTx(sendTx).catch(() => undefined);
  }

  const leafCountAfter = await backendLeafCount(bob);
  const bobLeafIndex = leafCountAfter - 1;

  log("Bob proves withdraw");
  const bobNote = await buildNoteSecrets(
    0,
    aliceNote.amount.toString(),
    newSecret,
    newNullifierSecret,
    new Uint8Array(32)
  );
  const bobWithdraw = await proveSpend({
    mode: "exit",
    poolId: 0,
    value: aliceNote.amount.toString(),
    secret: newSecret,
    nullifierSecret: newNullifierSecret,
    depositSecret: new Uint8Array(32),
    leafIndex: bobLeafIndex,
    commitmentHex: bobNote.commitmentHex,
    reader: bob.publicKey,
    relayerFeeStroops: "0",
  });

  const withdrawInputs = encodePublicInputs({
    poolId: 0,
    merkleRootHex: bobWithdraw.merkleRoot,
    nullifierHexes: bobWithdraw.nullifierHexes,
    newCommitmentHexes: ["0x0", "0x0", "0x0", "0x0"],
    publicAmount: bobWithdraw.publicInputs.public_amount,
  });

  log("Bob withdraws", `→ ${bob.publicKey.slice(0, 12)}…`);
  const withdrawTx = await backendWithdraw(bob, {
    amount: aliceNote.amount,
    nullifierHex: bobWithdraw.nullifierHex,
    merkleRootHex: bobWithdraw.merkleRoot,
    publicInputs: withdrawInputs,
    proofBytes: bobWithdraw.proofBytes,
  });
  ok("withdraw tx", withdrawTx);
}

async function main() {
  const { flow, derivationIndex, amount } = parseArgs();

  console.log("zk-notes e2e testnet");
  console.log(`  network: ${config.network}`);
  console.log(`  rpc:     ${config.rpcUrl}`);
  console.log(`  vault:   ${requireVaultId()}`);
  console.log(`  mock:    ${config.mockProof}`);
  if (!config.mockProof) {
    console.log(`  zk:      real UltraHonk (requires bb + --real-zk deploy)`);
  }
  console.log(`  flow:    ${flow}`);

  if (flow === "phase-c") {
    const aliceSource = env("E2E_ALICE_SOURCE", "alice");
    const bobSource = env("E2E_BOB_SOURCE", "bob");
    const poolId = Number(env("E2E_POOL_ID", "0"));
    log("Resolve signers", `${aliceSource} → ${bobSource}`);
    const alice = await resolveBackendForSource(aliceSource);
    const bob = await resolveBackendForSource(bobSource);
    console.log(`  alice: ${alice.publicKey}`);
    console.log(`  bob:   ${bob.publicKey}`);
    await runPhaseC(alice, bob, poolId, derivationIndex);
    console.log("\n✅ Phase C flow OK (join → send → exit → audit)");
    return;
  }

  if (flow === "alice-bob") {
    const aliceSource = env("E2E_ALICE_SOURCE", "alice");
    const bobSource = env("E2E_BOB_SOURCE", "bob");
    log("Resolve signers", `${aliceSource} → ${bobSource}`);
    const alice = await resolveBackendForSource(aliceSource);
    const bob = await resolveBackendForSource(bobSource);
    console.log(`  alice: ${alice.publicKey}`);
    console.log(`  bob:   ${bob.publicKey}`);
    await runAliceBob(alice, bob, derivationIndex, amount);
    console.log("\n✅ Alice→Bob flow OK (deposit → send → withdraw)");
    return;
  }

  const backend = await resolveBackend();
  console.log(`  sign:    ${backend.mode}${backend.cliSource ? ` (${backend.cliSource})` : ""}`);
  log("Signer", backend.publicKey);

  const receivePubkey = deriveShieldedReceiveKeysFromSeed(e2eRootSeed()).publicKey;
  if (flow === "all" || flow === "send") {
    log("Register shielded key", "for G… → zk1 lookup");
    const regTx = await backendRegisterShieldedKey(backend, receivePubkey);
    ok("register tx", regTx);
    if (backend.mode === "sdk") {
      await waitForTx(regTx).catch(() => undefined);
    }
  }

  const leafBefore = await backendLeafCount(backend).catch(() => 0);
  const rootBefore = await backendMerkleRoot(backend).catch(() => "n/a");
  console.log(`  leaf_count: ${leafBefore}, root: ${rootBefore.slice(0, 18)}…`);

  if (flow === "deposit") {
    await runDeposit(backend, derivationIndex, amount);
    console.log("\n✅ Deposit OK");
    return;
  }

  if (flow === "withdraw") {
    const noteCtx = await runDeposit(backend, derivationIndex, amount);
    await runWithdraw(backend, noteCtx);
    console.log("\n✅ Deposit + Withdraw OK");
    return;
  }

  if (flow === "send") {
    const noteCtx = await runDeposit(backend, derivationIndex, amount);
    await runSend(backend, noteCtx);
    console.log("\n✅ Deposit + Shielded send OK");
    return;
  }

  const noteA = await runDeposit(backend, derivationIndex, amount);
  const sendResult = await runSend(backend, noteA);

  const noteB = await buildNoteSecrets(
    0,
    sendResult.amount.toString(),
    sendResult.newSecret,
    sendResult.newNullifierSecret,
    new Uint8Array(32)
  );
  const withdrawCtx = {
    note: noteB,
    leafIndex: sendResult.newLeafIndex,
    amount: sendResult.amount,
    derivationIndex,
    secret: sendResult.newSecret,
    nullifierSecret: sendResult.newNullifierSecret,
  };
  await runWithdraw(backend, withdrawCtx);

  console.log("\n✅ Full flow OK (deposit → send → withdraw)");
}

main().catch((err) => {
  console.error("\n❌ E2E failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
