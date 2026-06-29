import { computeCommitment, computeNullifier } from "./commitment";
import { deriveSpendingPk } from "./shielded-keys";
import {
  fieldHexListToBigInt,
  merkleWitness,
  merkleWitnessFromTreeState,
  type VaultTreeState,
} from "./merkle-witness-client";
import type { Note } from "./note-types";

export const MAX_ACTION_SLOTS = 4;

export type UtxoWitnessPayload = {
  spend_value: string[];
  spend_note_randomness: string[];
  spend_spending_sk: string[];
  spend_merkle_path: string[][];
  spend_path_indices: boolean[][];
  out_value: string[];
  out_note_randomness: string[];
  out_recipient_pk: string[];
  merkle_root: string;
  nullifier: string[];
  new_commitment: string[];
  public_amount: string;
  relayer_fee: string;
};

export type UtxoWitnessResult = {
  witness: UtxoWitnessPayload;
  merkleRootHex: string;
  nullifierHexes: string[];
  newCommitmentHexes: string[];
};

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
  noteRandomness: string;
  spendingSk: string;
  leafIndex: number;
  leafCount: number;
  commitments: string[];
  noteCommitment?: string;
  treeState?: VaultTreeState | null;
  onChainMerkleRoot?: string;
}) {
  const spendingPk = await deriveSpendingPk(params.spendingSk);
  const spendCommitmentHex = await computeCommitment({
    valueStroops: BigInt(params.value),
    noteRandomness: params.noteRandomness,
    spendingPk,
  });

  if (
    params.noteCommitment &&
    normalizeHex(params.noteCommitment) !== normalizeHex(spendCommitmentHex)
  ) {
    throw new Error(
      "Note does not match commitment — unlock passkey or rescan"
    );
  }

  const nullifierHex = await computeNullifier({
    spendingSk: params.spendingSk,
    valueStroops: BigInt(params.value),
    noteRandomness: params.noteRandomness,
  });

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

  return { path, indices, root, nullifierHex, commitmentHex: spendCommitmentHex };
}

async function buildOutputCommitment(params: {
  value: string;
  noteRandomness: string;
  recipientPk: string;
}): Promise<string> {
  return computeCommitment({
    valueStroops: BigInt(params.value),
    noteRandomness: params.noteRandomness,
    spendingPk: params.recipientPk,
  });
}

export type SpendInput = {
  value: string;
  noteRandomness: string;
  spendingSk: string;
  leafIndex: number;
  noteCommitment?: string;
};

export type ShieldedOutput = {
  value: string;
  noteRandomness: string;
  recipientPk: string;
};

async function buildUtxoWitness(params: {
  inputs: SpendInput[];
  outputs: ShieldedOutput[];
  publicAmount: string;
  relayerFee: string;
  leafCount: number;
  commitments: string[];
  onChainMerkleRoot?: string;
  treeState?: VaultTreeState | null;
}): Promise<UtxoWitnessResult> {
  if (params.inputs.length === 0 || params.inputs.length > MAX_ACTION_SLOTS) {
    throw new Error("Need 1–4 input notes");
  }
  if (params.outputs.length > MAX_ACTION_SLOTS) {
    throw new Error("At most 4 outputs");
  }

  const inputSum = params.inputs.reduce((s, i) => s + BigInt(i.value), 0n);
  const outputSum = params.outputs.reduce((s, o) => s + BigInt(o.value), 0n);
  const publicAmount = BigInt(params.publicAmount);
  const relayerFee = BigInt(params.relayerFee);

  if (inputSum !== outputSum + publicAmount) {
    throw new Error("Balance mismatch in witness builder");
  }
  if (publicAmount > 0n && params.outputs.length > 0) {
    throw new Error("Withdraw/exit cannot create shielded outputs");
  }
  if (publicAmount === 0n && relayerFee !== 0n) {
    throw new Error("Shielded transfer requires relayer_fee=0");
  }
  if (relayerFee > publicAmount) {
    throw new Error("Relayer fee exceeds public amount");
  }

  const paths: string[][] = [];
  const indices: boolean[][] = [];
  const nullifierDecimals: string[] = [];
  let root: bigint | null = null;

  for (const input of params.inputs) {
    const slot = await buildInputSlot({
      ...input,
      leafCount: params.leafCount,
      commitments: params.commitments,
      treeState: params.treeState,
      onChainMerkleRoot: params.onChainMerkleRoot,
    });
    if (root !== null && root !== slot.root) {
      throw new Error("All inputs must share the same Merkle root");
    }
    root = slot.root;
    paths.push(slot.path.map((p) => p.toString()));
    indices.push(slot.indices);
    nullifierDecimals.push(fieldHexToDecimal(slot.nullifierHex));
  }

  while (paths.length < MAX_ACTION_SLOTS) {
    paths.push(emptyMerklePath());
    indices.push(emptyPathIndices());
    nullifierDecimals.push("0");
  }

  const outValues = pad4(params.outputs.map((o) => o.value));
  const outRcms = pad4(params.outputs.map((o) => o.noteRandomness));
  const outRecipientPks = pad4(params.outputs.map((o) => o.recipientPk));

  const newCommitmentHexes: string[] = [];
  for (const output of params.outputs) {
    newCommitmentHexes.push(
      await buildOutputCommitment({
        value: output.value,
        noteRandomness: output.noteRandomness,
        recipientPk: output.recipientPk,
      })
    );
  }
  while (newCommitmentHexes.length < MAX_ACTION_SLOTS) {
    newCommitmentHexes.push("0x0");
  }

  const witness: UtxoWitnessPayload = {
    spend_value: pad4(params.inputs.map((i) => i.value)),
    spend_note_randomness: pad4(params.inputs.map((i) => i.noteRandomness)),
    spend_spending_sk: pad4(params.inputs.map((i) => i.spendingSk)),
    spend_merkle_path: paths,
    spend_path_indices: indices,
    out_value: outValues,
    out_note_randomness: outRcms,
    out_recipient_pk: outRecipientPks,
    merkle_root: root!.toString(),
    nullifier: pad4(nullifierDecimals),
    new_commitment: pad4(
      newCommitmentHexes.map((h) =>
        h === "0x0" ? "0" : fieldHexToDecimal(h)
      )
    ),
    public_amount: params.publicAmount,
    relayer_fee: params.relayerFee,
  };

  const merkleRootHex = "0x" + root!.toString(16).padStart(64, "0");
  return {
    witness,
    merkleRootHex,
    nullifierHexes: witness.nullifier.map((n) =>
      n === "0" ? "0x0" : fieldDecToHex(n)
    ),
    newCommitmentHexes,
  };
}

function fieldDecToHex(value: string): string {
  if (value === "0") return "0x0";
  return "0x" + BigInt(value).toString(16).padStart(64, "0");
}

export async function buildShieldedTransferWitness(params: {
  inputs: SpendInput[];
  outputs: ShieldedOutput[];
  leafCount: number;
  commitments: string[];
  onChainMerkleRoot?: string;
  treeState?: VaultTreeState | null;
}): Promise<UtxoWitnessResult> {
  return buildUtxoWitness({
    ...params,
    publicAmount: "0",
    relayerFee: "0",
  });
}

export async function buildWithdrawWitness(params: {
  inputs: SpendInput[];
  leafCount: number;
  commitments: string[];
  onChainMerkleRoot?: string;
  treeState?: VaultTreeState | null;
}): Promise<UtxoWitnessResult> {
  const amount = params.inputs
    .reduce((s, i) => s + BigInt(i.value), 0n)
    .toString();
  return buildUtxoWitness({
    inputs: params.inputs,
    outputs: [],
    publicAmount: amount,
    relayerFee: "0",
    leafCount: params.leafCount,
    commitments: params.commitments,
    onChainMerkleRoot: params.onChainMerkleRoot,
    treeState: params.treeState,
  });
}

export async function buildRelayerExitWitness(params: {
  inputs: SpendInput[];
  relayerFeeStroops: string;
  leafCount: number;
  commitments: string[];
  onChainMerkleRoot?: string;
  treeState?: VaultTreeState | null;
}): Promise<UtxoWitnessResult> {
  const amount = params.inputs
    .reduce((s, i) => s + BigInt(i.value), 0n)
    .toString();
  return buildUtxoWitness({
    inputs: params.inputs,
    outputs: [],
    publicAmount: amount,
    relayerFee: params.relayerFeeStroops,
    leafCount: params.leafCount,
    commitments: params.commitments,
    onChainMerkleRoot: params.onChainMerkleRoot,
    treeState: params.treeState,
  });
}

export async function buildSingleNoteWithdrawWitness(params: {
  note: Note;
  spendingSk: string;
  leafCount: number;
  commitments: string[];
  onChainMerkleRoot?: string;
  treeState?: VaultTreeState | null;
}): Promise<UtxoWitnessResult> {
  return buildWithdrawWitness({
    inputs: [
      {
        value: params.note.value.toString(),
        noteRandomness: params.note.noteRandomness,
        spendingSk: params.spendingSk,
        leafIndex: params.note.leafIndex,
        noteCommitment: params.note.commitment,
      },
    ],
    leafCount: params.leafCount,
    commitments: params.commitments,
    onChainMerkleRoot: params.onChainMerkleRoot,
    treeState: params.treeState,
  });
}

export async function buildSingleNoteRelayerExitWitness(params: {
  note: Note;
  spendingSk: string;
  relayerFeeStroops: string;
  leafCount: number;
  commitments: string[];
  onChainMerkleRoot?: string;
  treeState?: VaultTreeState | null;
}): Promise<UtxoWitnessResult> {
  return buildRelayerExitWitness({
    inputs: [
      {
        value: params.note.value.toString(),
        noteRandomness: params.note.noteRandomness,
        spendingSk: params.spendingSk,
        leafIndex: params.note.leafIndex,
        noteCommitment: params.note.commitment,
      },
    ],
    relayerFeeStroops: params.relayerFeeStroops,
    leafCount: params.leafCount,
    commitments: params.commitments,
    onChainMerkleRoot: params.onChainMerkleRoot,
    treeState: params.treeState,
  });
}

export const buildExitWitness = buildSingleNoteRelayerExitWitness;
