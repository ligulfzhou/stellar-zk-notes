import type { Note } from "./note-types";
export type { Note, NoteStatus, StoredNoteVault } from "./note-types";
export { noteShieldedAddress, sumUnspentNotes } from "./note-types";

export async function createNote(params: {
  valueStroops: bigint;
  ownerPubkey: string;
  secret: string;
  nullifierSecret: string;
  commitmentHex: string;
  leafIndex: number;
  derivationIndex?: number;
}): Promise<Note> {
  return {
    id: crypto.randomUUID(),
    value: params.valueStroops,
    secret: params.secret,
    nullifierSecret: params.nullifierSecret,
    derivationIndex: params.derivationIndex,
    ownerPubkey: params.ownerPubkey,
    commitment: params.commitmentHex,
    leafIndex: params.leafIndex,
    status: "unspent",
    createdAt: Date.now(),
  };
}
