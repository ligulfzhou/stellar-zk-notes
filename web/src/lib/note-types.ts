import type { PasskeyVaultConfig } from "./passkey";

export type NoteStatus = "unspent" | "spent";

export interface Note {
  id: string;
  value: bigint;
  /** Stored secrets for ECDH-received notes; derived notes recompute from passkey. */
  secret: string;
  nullifierSecret: string;
  /** When set, secrets are re-derived from passkey root + this index. */
  derivationIndex?: number;
  ownerPubkey: string;
  commitment: string;
  leafIndex: number;
  status: NoteStatus;
  createdAt: number;
}

export interface StoredNoteVault {
  version: 3;
  passkey: PasskeyVaultConfig | null;
  nextDerivationIndex: number;
  notes: Note[];
  chainCommitments: string[];
}

export function noteShieldedAddress(note: Note): string {
  return note.ownerPubkey;
}

export function sumUnspentNotes(notes: Note[]): bigint {
  return notes
    .filter((n) => n.status === "unspent")
    .reduce((sum, n) => sum + n.value, 0n);
}

export function defaultVault(): StoredNoteVault {
  return {
    version: 3,
    passkey: null,
    nextDerivationIndex: 0,
    notes: [],
    chainCommitments: [],
  };
}

export function hasPasskey(vault: StoredNoteVault): boolean {
  return Boolean(vault.passkey?.credentials.length);
}
