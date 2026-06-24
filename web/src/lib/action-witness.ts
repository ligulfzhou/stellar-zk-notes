import {
  computeCommitmentV2,
  depositSecretFromHex,
  depositSecretToField,
  randomDepositSecret,
} from "./commitment-v2";
import { computeNullifier } from "./commitment-client";
import {
  fieldHexListToBigInt,
  merkleWitness,
  merkleWitnessFromTreeState,
  type VaultTreeState,
} from "./merkle-witness-client";
import { poolById } from "./pool-config";
import { deriveDepositSecretFromSeed } from "./root-seed";
import type { Note } from "./note-types";
import { usePasskeyStore } from "@/store/usePasskeyStore";

export const MAX_ACTION_SLOTS = 4;

export type TransferWitnessPayload = {
  spend_value: string[];
  spend_secret: string[];
  spend_nullifier_secret: string[];
  spend_deposit_secret: string[];
  spend_merkle_path: string[][];
  spend_path_indices: boolean[][];
  out_value: string[];
  out_secret: string[];
  out_nullifier_secret: string[];
  out_deposit_secret: string[];
  pool_id: string;
  merkle_root: string;
  nullifier: string[];
  new_commitment: string[];
  public_amount: string;
  relayer_fee: string;
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

function resolveDepositSecretBytes(note: Note, rootSeed: Uint8Array | null): Uint8Array {
  if (note.depositSecretHex) {
    return depositSecretFromHex(note.depositSecretHex);
  }
  if (note.derivationIndex !== undefined && rootSeed) {
    return deriveDepositSecretFromSeed(rootSeed, note.derivationIndex);
  }
  return new Uint8Array(32);
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
  depositSecret: Uint8Array;
  poolId: number;
  leafIndex: number;
  leafCount: number;
  commitments: string[];
  noteCommitment?: string;
  treeState?: VaultTreeState | null;
  onChainMerkleRoot?: string;
}) {
  const spendCommitmentHex = await computeCommitmentV2({
    valueStroops: BigInt(params.value),
    secret: params.secret,
    nullifierSecret: params.nullifierSecret,
    depositSecret: params.depositSecret,
    poolId: params.poolId,
  });

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

/** Build witness for pool exit (1-in, public_amount = pool join amount). */
export async function buildExitWitness(params: {
  poolId: number;
  value: string;
  secret: string;
  nullifierSecret: string;
  depositSecret: Uint8Array;
  relayerFeeStroops: string;
  leafIndex: number;
  leafCount: number;
  commitments: string[];
  onChainMerkleRoot?: string;
  treeState?: VaultTreeState | null;
  noteCommitment?: string;
}): Promise<TransferWitnessResult> {
  const joinAmount = poolById(params.poolId).stroops.toString();
  if (params.value !== joinAmount) {
    throw new Error("Exit note value must match pool denomination");
  }

  const slot = await buildInputSlot({
    value: params.value,
    secret: params.secret,
    nullifierSecret: params.nullifierSecret,
    depositSecret: params.depositSecret,
    poolId: params.poolId,
    leafIndex: params.leafIndex,
    leafCount: params.leafCount,
    commitments: params.commitments,
    noteCommitment: params.noteCommitment,
    treeState: params.treeState,
    onChainMerkleRoot: params.onChainMerkleRoot,
  });

  const witness: TransferWitnessPayload = {
    spend_value: pad4([params.value]),
    spend_secret: pad4([params.secret]),
    spend_nullifier_secret: pad4([params.nullifierSecret]),
    spend_deposit_secret: pad4([depositSecretToField(params.depositSecret)]),
    spend_merkle_path: [
      slot.path.map((p) => p.toString()),
      emptyMerklePath(),
      emptyMerklePath(),
      emptyMerklePath(),
    ],
    spend_path_indices: [
      slot.indices,
      emptyPathIndices(),
      emptyPathIndices(),
      emptyPathIndices(),
    ],
    out_value: pad4([]),
    out_secret: pad4([]),
    out_nullifier_secret: pad4([]),
    out_deposit_secret: pad4([]),
    pool_id: params.poolId.toString(),
    merkle_root: slot.root.toString(),
    nullifier: pad4([fieldHexToDecimal(slot.nullifierHex)]),
    new_commitment: pad4([]),
    public_amount: joinAmount,
    relayer_fee: params.relayerFeeStroops,
  };

  const merkleRootHex = "0x" + slot.root.toString(16).padStart(64, "0");
  return {
    witness,
    merkleRootHex,
    nullifierHexes: [slot.nullifierHex, "0x0", "0x0", "0x0"],
    newCommitmentHexes: ["0x0", "0x0", "0x0", "0x0"],
  };
}

export function depositSecretBytesForNote(note: Note): Uint8Array {
  const rootSeed = usePasskeyStore.getState().rootSeed;
  return resolveDepositSecretBytes(note, rootSeed);
}

/** Resolve deposit secret field for a note (passkey-derived or stored). */
export function depositSecretFieldForNote(note: Note): string {
  return depositSecretToField(depositSecretBytesForNote(note));
}

/** @deprecated use buildExitWitness */
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
  poolId?: number;
}): Promise<TransferWitnessResult> {
  const poolId = params.poolId ?? 0;
  return buildExitWitness({
    poolId,
    value: params.value,
    secret: params.secret,
    nullifierSecret: params.nullifierSecret,
    depositSecret: new Uint8Array(32),
    relayerFeeStroops: "0",
    leafIndex: params.leafIndex,
    leafCount: params.leafCount,
    commitments: params.commitments,
    onChainMerkleRoot: params.onChainMerkleRoot,
    treeState: params.treeState,
    noteCommitment: params.noteCommitment,
  });
}

export { randomDepositSecret };
