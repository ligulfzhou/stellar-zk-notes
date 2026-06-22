import { computeCommitment, computeNullifier } from "./commitment-client";
import {
  fieldHexListToBigInt,
  merkleWitness,
  merkleWitnessFromTreeState,
  type VaultTreeState,
} from "./merkle-witness-client";

export const MAX_ACTION_SLOTS = 4;

export type TransferWitnessPayload = {
  spend_value: string[];
  spend_secret: string[];
  spend_nullifier_secret: string[];
  spend_merkle_path: string[][];
  spend_path_indices: boolean[][];
  out_value: string[];
  out_secret: string[];
  out_nullifier_secret: string[];
  merkle_root: string;
  nullifier: string[];
  new_commitment: string[];
  public_amount: string;
};

/** @deprecated use TransferWitnessPayload */
export type SpendWitnessPayload = TransferWitnessPayload;

function hexToBigInt(hex: string): bigint {
  return BigInt(hex.startsWith("0x") ? hex : `0x${hex}`);
}

function normalizeHex(hex: string): string {
  return (hex.startsWith("0x") ? hex : `0x${hex}`).toLowerCase();
}

function fieldHexToDecimal(hex: string): string {
  return BigInt(hex.startsWith("0x") ? hex : `0x${hex}`).toString();
}

function pad4(values: string[]): string[] {
  const out = [...values];
  while (out.length < MAX_ACTION_SLOTS) out.push("0");
  return out.slice(0, MAX_ACTION_SLOTS);
}

function emptyMerklePath(): string[] {
  return Array(16).fill("0");
}

function emptyPathIndices(): boolean[] {
  return Array(16).fill(false);
}

async function buildMerkleWitness(params: {
  commitments: string[];
  leafCount: number;
  leafIndex: number;
  spendLeaf: bigint;
  treeState?: VaultTreeState | null;
}) {
  const hasGaps = params.commitments
    .slice(0, params.leafCount)
    .some((slot, i) => i < params.leafCount && !slot);

  if (hasGaps && params.treeState) {
    const { filled, zeros } = fieldHexListToBigInt(
      params.treeState.filled,
      params.treeState.zeros
    );
    const leafAt = (index: number) => {
      const slot = params.commitments[index];
      return slot ? hexToBigInt(slot) : undefined;
    };
    return merkleWitnessFromTreeState({
      leafCount: params.leafCount,
      targetIndex: params.leafIndex,
      targetLeaf: params.spendLeaf,
      filled,
      zeros,
      leafAt,
    });
  }

  const leaves: bigint[] = [];
  for (let i = 0; i < params.leafCount; i++) {
    const slot = params.commitments[i];
    if (!slot) throw new Error(`Missing commitment at leaf ${i}`);
    leaves.push(hexToBigInt(slot));
  }
  return merkleWitness(leaves, params.leafIndex);
}

async function buildInputSlot(params: {
  value: string;
  secret: string;
  nullifierSecret: string;
  leafIndex: number;
  leafCount: number;
  commitments: string[];
  noteCommitment?: string;
  treeState?: VaultTreeState | null;
  onChainMerkleRoot?: string;
}) {
  const spendCommitmentHex = await computeCommitment(
    params.value,
    params.secret,
    params.nullifierSecret
  );

  if (
    params.noteCommitment &&
    normalizeHex(params.noteCommitment) !== normalizeHex(spendCommitmentHex)
  ) {
    throw new Error(
      "Note secrets do not match commitment — unlock passkey or rescan"
    );
  }

  const nullifierHex = await computeNullifier(
    params.nullifierSecret,
    spendCommitmentHex
  );

  const spendLeaf = hexToBigInt(spendCommitmentHex);
  const { path, indices, root } = await buildMerkleWitness({
    commitments: params.commitments,
    leafCount: params.leafCount,
    leafIndex: params.leafIndex,
    spendLeaf,
    treeState: params.treeState,
  });

  if (params.onChainMerkleRoot) {
    const expected = normalizeHex(params.onChainMerkleRoot);
    const actual = "0x" + root.toString(16).padStart(64, "0").toLowerCase();
    if (expected !== actual) {
      throw new Error("Merkle root mismatch — Rescan from chain");
    }
  }

  return { path, indices, root, nullifierHex };
}

export type TransferWitnessResult = {
  witness: TransferWitnessPayload;
  merkleRootHex: string;
  nullifierHexes: string[];
  newCommitmentHexes: string[];
};

/** Build witness for shielded send (1-4 inputs, 1-4 outputs). */
export async function buildTransferWitness(params: {
  inputs: Array<{
    value: string;
    secret: string;
    nullifierSecret: string;
    leafIndex: number;
    commitment?: string;
  }>;
  outputs: Array<{
    value: string;
    secret: string;
    nullifierSecret: string;
  }>;
  leafCount: number;
  commitments: string[];
  onChainMerkleRoot?: string;
  treeState?: VaultTreeState | null;
}): Promise<TransferWitnessResult> {
  if (params.inputs.length === 0 || params.inputs.length > MAX_ACTION_SLOTS) {
    throw new Error(`Need 1-${MAX_ACTION_SLOTS} input notes`);
  }
  if (params.outputs.length === 0 || params.outputs.length > MAX_ACTION_SLOTS) {
    throw new Error(`Need 1-${MAX_ACTION_SLOTS} outputs`);
  }

  const inSum = params.inputs.reduce((a, n) => a + BigInt(n.value), 0n);
  const outSum = params.outputs.reduce((a, o) => a + BigInt(o.value), 0n);
  if (inSum !== outSum) {
    throw new Error("Input sum must equal output sum");
  }

  const spendValues: string[] = [];
  const spendSecrets: string[] = [];
  const spendNullifierSecrets: string[] = [];
  const merklePaths: string[][] = [];
  const pathIndices: boolean[][] = [];
  const nullifierDecimals: string[] = [];
  let merkleRootHex = "0x0";

  for (let i = 0; i < params.inputs.length; i++) {
    const note = params.inputs[i]!;
    const slot = await buildInputSlot({
      ...note,
      leafCount: params.leafCount,
      commitments: params.commitments,
      treeState: params.treeState,
      onChainMerkleRoot: i === 0 ? params.onChainMerkleRoot : undefined,
    });
    spendValues.push(note.value);
    spendSecrets.push(note.secret);
    spendNullifierSecrets.push(note.nullifierSecret);
    merklePaths.push(slot.path.map((p) => p.toString()));
    pathIndices.push(slot.indices);
    nullifierDecimals.push(fieldHexToDecimal(slot.nullifierHex));
    merkleRootHex = "0x" + slot.root.toString(16).padStart(64, "0");
  }

  const nullifierHexes: string[] = [];
  for (const dec of nullifierDecimals) {
    nullifierHexes.push("0x" + BigInt(dec).toString(16).padStart(64, "0"));
  }

  const outValues: string[] = [];
  const outSecrets: string[] = [];
  const outNullifierSecrets: string[] = [];
  const newCommitmentHexes: string[] = [];

  for (const out of params.outputs) {
    const nc = await computeCommitment(out.value, out.secret, out.nullifierSecret);
    outValues.push(out.value);
    outSecrets.push(out.secret);
    outNullifierSecrets.push(out.nullifierSecret);
    newCommitmentHexes.push(nc);
  }

  const witness: TransferWitnessPayload = {
    spend_value: pad4(spendValues),
    spend_secret: pad4(spendSecrets),
    spend_nullifier_secret: pad4(spendNullifierSecrets),
    spend_merkle_path: [
      ...merklePaths,
      ...Array(MAX_ACTION_SLOTS - merklePaths.length).fill(emptyMerklePath()),
    ].slice(0, MAX_ACTION_SLOTS),
    spend_path_indices: [
      ...pathIndices,
      ...Array(MAX_ACTION_SLOTS - pathIndices.length).fill(emptyPathIndices()),
    ].slice(0, MAX_ACTION_SLOTS),
    out_value: pad4(outValues),
    out_secret: pad4(outSecrets),
    out_nullifier_secret: pad4(outNullifierSecrets),
    merkle_root: BigInt(merkleRootHex).toString(),
    nullifier: pad4(nullifierDecimals),
    new_commitment: pad4(newCommitmentHexes.map((h) => BigInt(h).toString())),
    public_amount: "0",
  };

  return {
    witness,
    merkleRootHex,
    nullifierHexes: pad4(nullifierHexes).map((h) => (h === "0x0" ? "0x0" : h)),
    newCommitmentHexes: pad4(newCommitmentHexes),
  };
}

/** Build witness for 1-in withdraw to public address. */
export async function buildWithdrawWitness(params: {
  value: string;
  secret: string;
  nullifierSecret: string;
  leafIndex: number;
  leafCount: number;
  commitments: string[];
  onChainMerkleRoot?: string;
  treeState?: VaultTreeState | null;
  noteCommitment?: string;
}): Promise<TransferWitnessResult> {
  const slot = await buildInputSlot(params);

  const witness: TransferWitnessPayload = {
    spend_value: pad4([params.value]),
    spend_secret: pad4([params.secret]),
    spend_nullifier_secret: pad4([params.nullifierSecret]),
    spend_merkle_path: [slot.path.map((p) => p.toString()), emptyMerklePath(), emptyMerklePath(), emptyMerklePath()],
    spend_path_indices: [slot.indices, emptyPathIndices(), emptyPathIndices(), emptyPathIndices()],
    out_value: pad4([]),
    out_secret: pad4([]),
    out_nullifier_secret: pad4([]),
    merkle_root: slot.root.toString(),
    nullifier: pad4([fieldHexToDecimal(slot.nullifierHex)]),
    new_commitment: pad4([]),
    public_amount: params.value,
  };

  const merkleRootHex = "0x" + slot.root.toString(16).padStart(64, "0");
  return {
    witness,
    merkleRootHex,
    nullifierHexes: [slot.nullifierHex, "0x0", "0x0", "0x0"],
    newCommitmentHexes: ["0x0", "0x0", "0x0", "0x0"],
  };
}

/** @deprecated use buildTransferWitness / buildWithdrawWitness */
export async function buildSpendWitness(params: {
  mode: "shielded_send" | "withdraw";
  value: string;
  secret: string;
  nullifierSecret: string;
  leafIndex: number;
  leafCount: number;
  commitments: string[];
  onChainMerkleRoot?: string;
  treeState?: VaultTreeState | null;
  noteCommitment?: string;
  newSecret?: string;
  newNullifierSecret?: string;
}): Promise<{
  witness: TransferWitnessPayload;
  merkleRootHex: string;
  nullifierHex: string;
  nullifier1Hex: string;
  newCommitmentHex: string;
  newCommitment1Hex: string;
}> {
  if (params.mode === "withdraw") {
    const r = await buildWithdrawWitness(params);
    return {
      witness: r.witness,
      merkleRootHex: r.merkleRootHex,
      nullifierHex: r.nullifierHexes[0]!,
      nullifier1Hex: "0x0",
      newCommitmentHex: "0x0",
      newCommitment1Hex: "0x0",
    };
  }
  if (!params.newSecret || !params.newNullifierSecret) {
    throw new Error("newSecret and newNullifierSecret required for send");
  }
  const r = await buildTransferWitness({
    inputs: [
      {
        value: params.value,
        secret: params.secret,
        nullifierSecret: params.nullifierSecret,
        leafIndex: params.leafIndex,
        commitment: params.noteCommitment,
      },
    ],
    outputs: [
      {
        value: params.value,
        secret: params.newSecret,
        nullifierSecret: params.newNullifierSecret,
      },
    ],
    leafCount: params.leafCount,
    commitments: params.commitments,
    onChainMerkleRoot: params.onChainMerkleRoot,
    treeState: params.treeState,
  });
  return {
    witness: r.witness,
    merkleRootHex: r.merkleRootHex,
    nullifierHex: r.nullifierHexes[0]!,
    nullifier1Hex: "0x0",
    newCommitmentHex: r.newCommitmentHexes[0]!,
    newCommitment1Hex: "0x0",
  };
}

/** @deprecated use buildTransferWitness */
export const buildSpendWitness2x2 = buildTransferWitness;
