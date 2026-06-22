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
import { buildChainState } from "../../web/src/server/chain-state.ts";
import { config } from "./config.ts";
import {
  computeCommitmentHex,
  computeNullifierHex,
} from "./crypto.ts";
import { mockProofBytes } from "./field.ts";

const execFileAsync = promisify(execFile);

export type NoteSecrets = {
  secret: string;
  nullifierSecret: string;
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
    merkle_root: string;
    nullifier: string[];
    new_commitment: string[];
    public_amount: string;
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
  value: string,
  secret: string,
  nullifierSecret: string
): Promise<NoteSecrets> {
  const commitmentHex = await computeCommitmentHex(value, secret, nullifierSecret);
  const nullifierHex = await computeNullifierHex(nullifierSecret, commitmentHex);
  return { secret, nullifierSecret, commitmentHex, nullifierHex };
}

async function buildMerkleWitness(params: {
  chain: Awaited<ReturnType<typeof buildChainState>>;
  leafIndex: number;
  spendLeaf: bigint;
}) {
  const { chain, leafIndex, spendLeaf } = params;
  const hasGaps = chain.commitments
    .slice(0, chain.leafCount!)
    .some((slot, i) => i < chain.leafCount! && !slot);

  if (hasGaps && chain.treeState) {
    const { filled, zeros } = fieldHexListToBigInt(
      chain.treeState.filled,
      chain.treeState.zeros
    );
    const leafAt = (index: number) => {
      const slot = chain.commitments[index];
      return slot ? hexToBigInt(slot) : undefined;
    };
    return merkleWitnessFromTreeState({
      leafCount: chain.leafCount!,
      targetIndex: leafIndex,
      targetLeaf: spendLeaf,
      filled,
      zeros,
      leafAt,
    });
  }

  const leaves: bigint[] = [];
  for (let i = 0; i < chain.leafCount!; i++) {
    const slot = chain.commitments[i];
    if (!slot) throw new Error(`Missing commitment at leaf ${i}`);
    leaves.push(hexToBigInt(slot));
  }
  return merkleWitness(leaves, leafIndex);
}

const PROOF_BYTES = 456 * 32;

async function generateRealProof(witnessPayload: Record<string, unknown>): Promise<Uint8Array> {
  const proveScript = path.join(config.repoRoot, "scripts", "prove_from_witness.sh");
  const proofFile = path.join(config.repoRoot, "artifacts", "transfer_actions", "proof");
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

export async function proveSpend(params: {
  mode: "shielded_send" | "withdraw";
  value: string;
  secret: string;
  nullifierSecret: string;
  leafIndex: number;
  commitmentHex: string;
  reader: string;
  newSecret?: string;
  newNullifierSecret?: string;
}): Promise<ProveResult> {
  const chain = await buildChainState(
    params.reader,
    [],
    [{ leafIndex: params.leafIndex, commitment: params.commitmentHex }]
  );

  if (!chain.merkleRoot || !chain.leafCount) {
    throw new Error("Could not read vault chain state");
  }

  const spendCommitmentHex = await computeCommitmentHex(
    params.value,
    params.secret,
    params.nullifierSecret
  );
  if (normalizeHex(spendCommitmentHex) !== normalizeHex(params.commitmentHex)) {
    throw new Error("Note secrets do not match commitment");
  }

  const nullifierHex = await computeNullifierHex(
    params.nullifierSecret,
    spendCommitmentHex
  );

  const spendLeaf = hexToBigInt(spendCommitmentHex);
  const { path: merklePath, indices, root } = await buildMerkleWitness({
    chain,
    leafIndex: params.leafIndex,
    spendLeaf,
  });

  const onChainRoot = normalizeHex(chain.merkleRoot);
  const computedRoot =
    "0x" + root.toString(16).padStart(64, "0").toLowerCase();
  if (onChainRoot !== computedRoot) {
    if (!config.mockProof) {
      throw new Error(
        `Merkle root mismatch (on-chain ${onChainRoot}, computed ${computedRoot})`
      );
    }
  }

  let newCommitmentHex = "0x0";
  let publicAmount = "0";
  let newSecret = "0";
  let newNullifierSecret = "0";

  if (params.mode === "shielded_send") {
    if (!params.newSecret || !params.newNullifierSecret) {
      throw new Error("newSecret and newNullifierSecret required for send");
    }
    newSecret = params.newSecret;
    newNullifierSecret = params.newNullifierSecret;
    newCommitmentHex = await computeCommitmentHex(
      params.value,
      newSecret,
      newNullifierSecret
    );
    publicAmount = "0";
  } else {
    publicAmount = params.value;
  }

  const merkleRootHex = "0x" + root.toString(16).padStart(64, "0");
  const witnessRoot = config.mockProof && onChainRoot !== computedRoot
    ? BigInt(chain.merkleRoot).toString()
    : root.toString();

  const emptyPath = Array(16).fill("0");
  const emptyIdx = Array(16).fill(false);

  const witnessPayload = {
    spend_value: pad4([params.value], "0"),
    spend_secret: pad4([params.secret], "0"),
    spend_nullifier_secret: pad4([params.nullifierSecret], "0"),
    spend_merkle_path: [merklePath.map((p) => p.toString()), emptyPath, emptyPath, emptyPath],
    spend_path_indices: [indices, emptyIdx, emptyIdx, emptyIdx],
    out_value: pad4(params.mode === "shielded_send" ? [params.value] : [], "0"),
    out_secret: pad4(params.mode === "shielded_send" ? [newSecret] : [], "0"),
    out_nullifier_secret: pad4(params.mode === "shielded_send" ? [newNullifierSecret] : [], "0"),
    merkle_root: witnessRoot,
    nullifier: pad4([fieldHexToDecimal(nullifierHex)], "0"),
    new_commitment: pad4(
      params.mode === "shielded_send" ? [BigInt(newCommitmentHex).toString()] : [],
      "0"
    ),
    public_amount: publicAmount,
  };

  let proofBytes: Uint8Array;
  if (config.mockProof) {
    proofBytes = mockProofBytes();
  } else {
    proofBytes = await generateRealProof(witnessPayload);
  }

  const nullifierHexes = pad4([nullifierHex], "0x0");
  const newCommitmentHexes = pad4(
    params.mode === "shielded_send" ? [newCommitmentHex] : [],
    "0x0"
  );

  return {
    merkleRoot: merkleRootHex,
    nullifierHex,
    nullifierHexes,
    newCommitmentHex,
    newCommitmentHexes,
    publicInputs: {
      merkle_root: witnessRoot,
      nullifier: witnessPayload.nullifier,
      new_commitment: witnessPayload.new_commitment,
      public_amount: publicAmount,
    },
    proofBytes,
  };
}
