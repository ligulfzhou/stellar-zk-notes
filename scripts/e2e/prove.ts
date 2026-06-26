import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  merkleWitness,
  merkleWitnessFromTreeState,
  fieldHexListToBigInt,
} from "../../web/src/server/merkle.ts";
import {
  buildChainState,
  buildChainStateForProve,
} from "../../web/src/server/chain-state.ts";
import { computeCommitmentV2, depositSecretToField } from "../../web/src/lib/commitment-v2.ts";
import { computeNullifier } from "../../web/src/lib/commitment-client.ts";
import { POOLS } from "../../web/src/lib/pool-config.ts";
import { config } from "./config.ts";
import { mockProofBytes } from "./field.ts";

const execFileAsync = promisify(execFile);

export type NoteSecrets = {
  secret: string;
  nullifierSecret: string;
  depositSecret: Uint8Array;
  commitmentHex: string;
  nullifierHex: string;
};

export type ProveResult = {
  merkleRoot: string;
  nullifierHex: string;
  nullifierHexes: string[];
  newCommitmentHex: string;
  newCommitmentHexes: string[];
  publicInputs: {
    pool_id: string;
    merkle_root: string;
    nullifier: string[];
    new_commitment: string[];
    public_amount: string;
    relayer_fee: string;
  };
  proofBytes: Uint8Array;
};

function pad4<T>(values: T[], fill: T): T[] {
  const out = [...values];
  while (out.length < 4) out.push(fill);
  return out.slice(0, 4);
}

function fieldHexToDecimal(hex: string): string {
  return BigInt(hex.startsWith("0x") ? hex : `0x${hex}`).toString();
}

function hexToBigInt(hex: string): bigint {
  return BigInt(hex.startsWith("0x") ? hex : `0x${hex}`);
}

function normalizeHex(hex: string): string {
  return (hex.startsWith("0x") ? hex : `0x${hex}`).toLowerCase();
}

export async function buildNoteSecrets(
  poolId: number,
  value: string,
  secret: string,
  nullifierSecret: string,
  depositSecret: Uint8Array
): Promise<NoteSecrets> {
  const commitmentHex = await computeCommitmentV2({
    valueStroops: BigInt(value),
    secret,
    nullifierSecret,
    depositSecret,
    poolId,
  });
  const nullifierHex = await computeNullifier(nullifierSecret, commitmentHex);
  return { secret, nullifierSecret, depositSecret, commitmentHex, nullifierHex };
}

async function buildMerkleWitness(params: {
  chain: Awaited<ReturnType<typeof buildChainState>>;
  poolId: number;
  leafIndex: number;
  spendLeaf: bigint;
}) {
  const poolCommitments = params.chain.poolCommitments[params.poolId] ?? [];
  const leafCount = params.chain.poolLeafCounts[params.poolId] ?? poolCommitments.length;
  const hasGaps = poolCommitments
    .slice(0, leafCount)
    .some((slot, i) => i < leafCount && !slot);

  if (hasGaps && params.chain.treeState) {
    const { filled, zeros } = fieldHexListToBigInt(
      params.chain.treeState.filled,
      params.chain.treeState.zeros
    );
    const leafAt = (index: number) => {
      if (index === params.leafIndex) {
        return params.spendLeaf;
      }
      const slot = poolCommitments[index];
      return slot ? hexToBigInt(slot) : undefined;
    };
    return merkleWitnessFromTreeState({
      leafCount,
      targetIndex: params.leafIndex,
      targetLeaf: params.spendLeaf,
      filled,
      zeros,
      leafAt,
    });
  }

  const leaves: bigint[] = [];
  for (let i = 0; i < leafCount; i++) {
    const slot = poolCommitments[i];
    if (!slot) throw new Error(`Missing commitment at leaf ${i}`);
    leaves.push(hexToBigInt(slot));
  }
  return merkleWitness(leaves, params.leafIndex);
}

const PROOF_BYTES = 456 * 32;

async function generateRealProof(witnessPayload: Record<string, unknown>): Promise<Uint8Array> {
  const proveScript = path.join(config.repoRoot, "scripts", "prove_from_witness.sh");
  const proofFile = path.join(config.repoRoot, "artifacts", "pool_actions", "proof");
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "zk-e2e-witness-"));
  const witnessPath = path.join(tmpDir, "witness.json");
  try {
    await writeFile(witnessPath, JSON.stringify(witnessPayload));
    await execFileAsync(proveScript, [witnessPath], {
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.bb/bin:${process.env.HOME}/.nargo/bin:${process.env.PATH}`,
      },
      maxBuffer: 32 * 1024 * 1024,
    });
    const proof = await readFile(proofFile);
    if (proof.length !== PROOF_BYTES) {
      throw new Error(
        `Invalid proof size ${proof.length} (expected ${PROOF_BYTES}) — check bb prove output`
      );
    }
    return new Uint8Array(proof);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export async function proveExit(params: {
  poolId: number;
  value: string;
  secret: string;
  nullifierSecret: string;
  depositSecret: Uint8Array;
  leafIndex: number;
  commitmentHex: string;
  reader: string;
  relayerFeeStroops?: string;
}): Promise<ProveResult> {
  const chain = await buildChainStateForProve(params.reader, params.poolId);

  const onChainRoot = chain.poolMerkleRoots[params.poolId];
  if (!onChainRoot || !chain.poolLeafCounts[params.poolId]) {
    throw new Error("Could not read vault pool chain state");
  }

  const spendCommitmentHex = await computeCommitmentV2({
    valueStroops: BigInt(params.value),
    secret: params.secret,
    nullifierSecret: params.nullifierSecret,
    depositSecret: params.depositSecret,
    poolId: params.poolId,
  });
  if (normalizeHex(spendCommitmentHex) !== normalizeHex(params.commitmentHex)) {
    throw new Error("Note secrets do not match commitment");
  }

  const chainCommitAtLeaf =
    chain.poolCommitments[params.poolId]?.[params.leafIndex] ?? "";
  if (
    chainCommitAtLeaf &&
    normalizeHex(chainCommitAtLeaf) !== normalizeHex(spendCommitmentHex)
  ) {
    throw new Error(
      `Commitment at leaf ${params.leafIndex} does not match note ` +
        `(on-chain ${chainCommitAtLeaf}, note ${spendCommitmentHex})`
    );
  }

  const nullifierHex = await computeNullifier(
    params.nullifierSecret,
    spendCommitmentHex
  );

  const spendLeaf = hexToBigInt(spendCommitmentHex);
  const { path: merklePath, indices, root } = await buildMerkleWitness({
    chain,
    poolId: params.poolId,
    leafIndex: params.leafIndex,
    spendLeaf,
  });

  const onChainRootNorm = normalizeHex(onChainRoot);
  const computedRoot = "0x" + root.toString(16).padStart(64, "0").toLowerCase();
  if (onChainRootNorm !== computedRoot && !config.mockProof) {
    throw new Error(
      `Merkle root mismatch (on-chain ${onChainRootNorm}, computed ${computedRoot})`
    );
  }

  const publicAmount = POOLS[params.poolId]?.stroops.toString() ?? params.value;
  const relayerFee = params.relayerFeeStroops ?? "0";

  const merkleRootHex = "0x" + root.toString(16).padStart(64, "0");
  const witnessRoot =
    config.mockProof && onChainRootNorm !== computedRoot
      ? BigInt(onChainRoot).toString()
      : root.toString();

  const emptyPath = Array(16).fill("0");
  const emptyIdx = Array(16).fill(false);

  const witnessPayload = {
    spend_value: pad4([params.value], "0"),
    spend_secret: pad4([params.secret], "0"),
    spend_nullifier_secret: pad4([params.nullifierSecret], "0"),
    spend_deposit_secret: pad4([depositSecretToField(params.depositSecret)], "0"),
    spend_merkle_path: [merklePath.map((p) => p.toString()), emptyPath, emptyPath, emptyPath],
    spend_path_indices: [indices, emptyIdx, emptyIdx, emptyIdx],
    out_value: pad4([], "0"),
    out_secret: pad4([], "0"),
    out_nullifier_secret: pad4([], "0"),
    out_deposit_secret: pad4([], "0"),
    pool_id: params.poolId.toString(),
    merkle_root: witnessRoot,
    nullifier: pad4([fieldHexToDecimal(nullifierHex)], "0"),
    new_commitment: pad4([], "0"),
    public_amount: publicAmount,
    relayer_fee: relayerFee,
  };

  let proofBytes: Uint8Array;
  if (config.mockProof) {
    proofBytes = mockProofBytes();
  } else {
    proofBytes = await generateRealProof(witnessPayload);
  }

  const nullifierHexes = pad4([nullifierHex], "0x0");
  const newCommitmentHexes = pad4([], "0x0");

  return {
    merkleRoot: merkleRootHex,
    nullifierHex,
    nullifierHexes,
    newCommitmentHex: "0x0",
    newCommitmentHexes,
    publicInputs: {
      pool_id: params.poolId.toString(),
      merkle_root: witnessRoot,
      nullifier: witnessPayload.nullifier,
      new_commitment: witnessPayload.new_commitment,
      public_amount: publicAmount,
      relayer_fee: relayerFee,
    },
    proofBytes,
  };
}

/** @deprecated use proveExit */
export const proveSpend = proveExit;
