import { executeNoirField } from "./noir-runtime";
import {
  deriveNullifierKey,
  deriveSpendingPk,
  diversifiedRecipientPk,
} from "./shielded-keys";

/** v2 Sapling-style commitment: poseidon2(value, note_randomness, spending_pk) */
export async function computeCommitment(params: {
  valueStroops: bigint;
  noteRandomness: string;
  spendingPk: string;
}): Promise<string> {
  return executeNoirField("note_hash", {
    value: params.valueStroops.toString(),
    note_randomness: params.noteRandomness,
    spending_pk: params.spendingPk,
  });
}

/** Nullifier requires owner spending_sk — sender without sk cannot compute this. */
export async function computeNullifier(params: {
  spendingSk: string;
  valueStroops: bigint;
  noteRandomness: string;
  diversifier?: string;
}): Promise<string> {
  const d = params.diversifier ?? "0";
  const spendingPk = await deriveSpendingPk(params.spendingSk);
  const recipientPk = await diversifiedRecipientPk(spendingPk, d);
  const commitment = await computeCommitment({
    valueStroops: params.valueStroops,
    noteRandomness: params.noteRandomness,
    spendingPk: recipientPk,
  });
  const nk = await deriveNullifierKey(params.spendingSk);
  return executeNoirField("hash_pair", {
    left: nk,
    right: BigInt(commitment).toString(),
  });
}
