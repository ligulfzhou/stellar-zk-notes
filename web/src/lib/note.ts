import type { Note } from "./note-types";
export type { Note, NoteStatus, StoredNoteVault } from "./note-types";
export { sumUnspentNotes, hasPasskey } from "./note-types";

export async function createNote(params: {
  valueStroops: bigint;
  noteRandomness: string;
  spendingPk: string;
  diversifier?: string;
  commitmentHex: string;
  leafIndex: number;
  received?: boolean;
}): Promise<Note> {
  return {
    id: crypto.randomUUID(),
    value: params.valueStroops,
    noteRandomness: params.noteRandomness,
    spendingPk: params.spendingPk,
    diversifier: params.diversifier ?? "0",
    commitment: params.commitmentHex,
    leafIndex: params.leafIndex,
    status: "unspent",
    createdAt: Date.now(),
    received: params.received,
  };
}
