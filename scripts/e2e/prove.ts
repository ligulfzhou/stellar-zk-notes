import { execFile } from "node:child_process";
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
  newCommitmentHex: string;
  publicInputs: {
    merkle_root: string;
    nullifier: string;
    new_commitment: string;
    public_amount: string;
    mode: string;
  };
  proofBytes: Uint8Array;
};

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

  const hasGaps = chain.commitments
    .slice(0, chain.leafCount)
    .some((slot, i) => i < chain.leafCount && !slot);

  const spendLeaf = hexToBigInt(spendCommitmentHex);
  let root: bigint;

  if (hasGaps && chain.treeState) {
    const { filled, zeros } = fieldHexListToBigInt(
      chain.treeState.filled,
      chain.treeState.zeros
    );
    const leafAt = (index: number) => {
      const slot = chain.commitments[index];
      return slot ? hexToBigInt(slot) : undefined;
    };
    ({ root } = await merkleWitnessFromTreeState({
      leafCount: chain.leafCount,
      targetIndex: params.leafIndex,
      targetLeaf: spendLeaf,
      filled,
      zeros,
      leafAt,
    }));
  } else {
    const leaves: bigint[] = [];
    for (let i = 0; i < chain.leafCount; i++) {
      const slot = chain.commitments[i];
      if (!slot) throw new Error(`Missing commitment at leaf ${i}`);
      leaves.push(hexToBigInt(slot));
    }
    ({ root } = await merkleWitness(leaves, params.leafIndex));
  }

  const onChainRoot = normalizeHex(chain.merkleRoot);
  const computedRoot =
    "0x" + root.toString(16).padStart(64, "0").toLowerCase();
  if (onChainRoot !== computedRoot) {
    if (!config.mockProof) {
      throw new Error(
        `Merkle root mismatch (on-chain ${onChainRoot}, computed ${computedRoot})`
      );
    }
    root = hexToBigInt(chain.merkleRoot);
  }

  let newCommitmentHex = "0x0";
  let publicAmount = "0";
  let mode = "0";

  if (params.mode === "shielded_send") {
    if (!params.newSecret || !params.newNullifierSecret) {
      throw new Error("newSecret and newNullifierSecret required for send");
    }
    newCommitmentHex = await computeCommitmentHex(
      params.value,
      params.newSecret,
      params.newNullifierSecret
    );
    mode = "0";
    publicAmount = "0";
  } else {
    publicAmount = params.value;
    mode = "1";
  }

  const merkleRootHex = "0x" + root.toString(16).padStart(64, "0");

  if (!config.mockProof) {
    const witnessPayload = {
      value: params.value,
      secret: params.secret,
      nullifier_secret: params.nullifierSecret,
      merkle_path: [] as string[],
      path_indices: [] as boolean[],
      new_value: params.mode === "shielded_send" ? params.value : "0",
      new_secret: params.newSecret ?? "0",
      new_nullifier_secret: params.newNullifierSecret ?? "0",
      merkle_root: root.toString(),
      nullifier: fieldHexToDecimal(nullifierHex),
      new_commitment: BigInt(newCommitmentHex).toString(),
      public_amount: publicAmount,
      mode,
    };
    const witnessScript = path.join(config.repoRoot, "scripts", "witness_spend.sh");
    const tmpDir = path.join(config.repoRoot, "web", ".e2e-witness");
    await import("node:fs/promises").then(({ mkdir, writeFile, rm }) =>
      mkdir(tmpDir, { recursive: true }).then(async () => {
        const witnessPath = path.join(tmpDir, "witness.json");
        await writeFile(witnessPath, JSON.stringify(witnessPayload));
        await execFileAsync(witnessScript, [witnessPath]);
        await rm(tmpDir, { recursive: true, force: true });
      })
    );
  }

  return {
    merkleRoot: merkleRootHex,
    nullifierHex,
    newCommitmentHex,
    publicInputs: {
      merkle_root: root.toString(),
      nullifier: fieldHexToDecimal(nullifierHex),
      new_commitment: BigInt(newCommitmentHex).toString(),
      public_amount: publicAmount,
      mode,
    },
    proofBytes: mockProofBytes(),
  };
}
