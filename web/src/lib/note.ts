import type { Note } from "./note-types";
export type { Note, NoteStatus, StoredNoteVault } from "./note-types";
export { noteShieldedAddress, sumUnspentNotes, hasPasskey } from "./note-types";

export async function createNote(params: {
  valueStroops: bigint;
  poolId?: number;
  ownerPubkey: string;
  secret: string;
  nullifierSecret: string;
  depositSecretHex?: string;
  commitmentHex: string;
  leafIndex: number;
  derivationIndex?: number;
}): Promise<Note> {
  return {
    id: crypto.randomUUID(),
    value: params.valueStroops,
    poolId: params.poolId ?? 0,
    secret: params.secret,
    nullifierSecret: params.nullifierSecret,
    depositSecretHex: params.depositSecretHex,
    derivationIndex: params.derivationIndex,
    ownerPubkey: params.ownerPubkey,
    commitment: params.commitmentHex,
    leafIndex: params.leafIndex,
    status: "unspent",
    createdAt: Date.now(),
  };
}
