#!/usr/bin/env node
/**
 * End-to-end testnet flow for zk-notes (no browser required).
 *
 * Usage:
 *   STELLAR_SOURCE=admin ./scripts/e2e_testnet.sh
 *   ./scripts/e2e_testnet.sh --flow phase-c
 */
import { execFileSync } from "node:child_process";
import {
  deriveDepositSecretFromSeed,
  deriveNoteSecretsFromSeed,
} from "../../web/src/lib/root-seed.ts";
import { POOLS, MIN_POOL_SIZE_TESTNET } from "../../web/src/lib/pool-config.ts";
import { config, env, requireVaultId } from "./config.ts";
import { e2ePartySeed, e2eRootSeed } from "./crypto.ts";
import { encodePublicInputs } from "./field.ts";
import { buildNoteSecrets, proveExit } from "./prove.ts";
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
  deposit,
  exitPool,
  getVaultLeafCount,
  joinPool,
  signerFromSecret,
  waitForTx,
  withdraw,
} from "./stellar.ts";

type Flow = "deposit" | "exit" | "all" | "phase-c" | "withdraw";

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

async function backendLeafCount(backend: Backend, poolId = 0): Promise<number> {
  if (backend.mode === "sdk" && backend.signer) {
    return getVaultLeafCount(backend.signer.publicKey, poolId);
  }
  return cliLeafCount(backend.cliSource!);
}

async function backendMerkleRoot(backend: Backend): Promise<string> {
  if (backend.mode === "sdk" && backend.signer) {
    return getVaultLeafCount(backend.signer.publicKey).then(() =>
      cliMerkleRoot(backend.cliSource ?? backend.publicKey)
    );
  }
  return cliMerkleRoot(backend.cliSource!);
}

async function backendExit(
  backend: Backend,
  params: {
    poolId: number;
    recipient: string;
    relayer: string;
    relayerFeeStroops: number;
    nullifierHexes: string[];
    merkleRootHex: string;
    publicInputs: Uint8Array;
    proofBytes: Uint8Array;
  }
) {
  if (backend.mode === "sdk" && backend.signer) {
    return exitPool({
      signer: backend.signer,
      poolId: params.poolId,
      recipient: params.recipient,
      relayer: params.relayer,
      relayerFeeStroops: params.relayerFeeStroops,
      nullifierHexes: params.nullifierHexes,
      merkleRootHex: params.merkleRootHex,
      publicInputs: params.publicInputs,
      proofBytes: params.proofBytes,
    });
  }
  const pool = POOLS[params.poolId] ?? POOLS[0]!;
  return cliWithdraw({
    source: backend.cliSource!,
    recipient: params.recipient,
    amountStroops: pool.stroops,
    nullifierHex: params.nullifierHexes[0]!,
    merkleRootHex: params.merkleRootHex,
    publicInputsHex: publicInputsToHex(params.publicInputs),
    proofHex: proofToHex(params.proofBytes),
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

async function seedPoolToMinSize(
  backend: Backend,
  poolId: number,
  baseDerivationIndex: number,
  partySeed: Uint8Array
) {
  let leafCount = await getVaultLeafCount(backend.publicKey, poolId).catch(() => 0);
  const joinNotes: Awaited<ReturnType<typeof runJoin>>[] = [];

  for (let i = 0; i < Math.max(MIN_POOL_SIZE_TESTNET - leafCount, 1); i++) {
    joinNotes.push(
      await runJoin(backend, poolId, baseDerivationIndex + i, partySeed)
    );
    leafCount = await getVaultLeafCount(backend.publicKey, poolId);
  }

  while (leafCount < MIN_POOL_SIZE_TESTNET) {
    joinNotes.push(
      await runJoin(
        backend,
        poolId,
        baseDerivationIndex + joinNotes.length + 10,
        partySeed
      )
    );
    leafCount = await getVaultLeafCount(backend.publicKey, poolId);
  }

  ok("pool leaf count", String(leafCount));
  return joinNotes;
}

async function runExitFromNote(
  backend: Backend,
  noteCtx: {
    note: Awaited<ReturnType<typeof buildNoteSecrets>>;
    leafIndex: number;
    amount: bigint;
    poolId: number;
    secret: string;
    nullifierSecret: string;
    depositSecret: Uint8Array;
  },
  params: { recipient: string; relayer: string; relayerFeeStroops: number }
) {
  log("Prove exit");
  const prove = await proveExit({
    poolId: noteCtx.poolId,
    value: noteCtx.amount.toString(),
    secret: noteCtx.secret,
    nullifierSecret: noteCtx.nullifierSecret,
    depositSecret: noteCtx.depositSecret,
    leafIndex: noteCtx.leafIndex,
    commitmentHex: noteCtx.note.commitmentHex,
    reader: backend.publicKey,
    relayerFeeStroops: String(params.relayerFeeStroops),
  });
  ok("merkle root", prove.merkleRoot);

  const pool = POOLS[noteCtx.poolId] ?? POOLS[0]!;
  const publicInputs = encodePublicInputs({
    poolId: noteCtx.poolId,
    merkleRootHex: prove.merkleRoot,
    nullifierHexes: prove.nullifierHexes,
    newCommitmentHexes: ["0x0", "0x0", "0x0", "0x0"],
    publicAmount: pool.stroops.toString(),
    relayerFeeStroops: String(params.relayerFeeStroops),
  });

  log("Exit pool", `→ ${params.recipient.slice(0, 12)}…`);
  const txHash = await backendExit(backend, {
    poolId: noteCtx.poolId,
    recipient: params.recipient,
    relayer: params.relayer,
    relayerFeeStroops: params.relayerFeeStroops,
    nullifierHexes: prove.nullifierHexes,
    merkleRootHex: prove.merkleRoot,
    publicInputs,
    proofBytes: prove.proofBytes,
  });
  ok("exit tx", txHash);
  if (backend.mode === "sdk") {
    await waitForTx(txHash).catch(() => undefined);
  }
  return txHash;
}

async function runPhaseC(
  alice: Backend,
  bob: Backend,
  poolId: number,
  baseDerivationIndex: number
) {
  const aliceSeed = e2ePartySeed("alice");
  const joinNotes = await seedPoolToMinSize(
    alice,
    poolId,
    baseDerivationIndex,
    aliceSeed
  );

  const spendNote = joinNotes[0]!;
  const relayerFeeStroops = 100_000;

  await runExitFromNote(alice, spendNote, {
    recipient: bob.publicKey,
    relayer: alice.publicKey,
    relayerFeeStroops,
  });

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

  return {
    note,
    leafIndex,
    amount,
    poolId: 0,
    derivationIndex,
    secret,
    nullifierSecret,
    depositSecret: new Uint8Array(32),
  };
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
    console.log("\n✅ Phase C flow OK (join → exit → audit)");
    return;
  }

  const backend = await resolveBackend();
  console.log(`  sign:    ${backend.mode}${backend.cliSource ? ` (${backend.cliSource})` : ""}`);
  log("Signer", backend.publicKey);

  const leafBefore = await backendLeafCount(backend).catch(() => 0);
  const rootBefore = await backendMerkleRoot(backend).catch(() => "n/a");
  console.log(`  leaf_count: ${leafBefore}, root: ${rootBefore.slice(0, 18)}…`);

  if (flow === "deposit") {
    await runDeposit(backend, derivationIndex, amount);
    console.log("\n✅ Deposit OK");
    return;
  }

  if (flow === "withdraw" || flow === "exit") {
    const noteCtx = await runDeposit(backend, derivationIndex, amount);
    await runExitFromNote(backend, noteCtx, {
      recipient: backend.publicKey,
      relayer: backend.publicKey,
      relayerFeeStroops: 0,
    });
    console.log("\n✅ Deposit + Exit OK");
    return;
  }

  const noteCtx = await runDeposit(backend, derivationIndex, amount);
  await runExitFromNote(backend, noteCtx, {
    recipient: backend.publicKey,
    relayer: backend.publicKey,
    relayerFeeStroops: 0,
  });
  console.log("\n✅ Full flow OK (deposit → exit)");
}

main().catch((err) => {
  console.error("\n❌ E2E failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
