export type NoteStatus = "unspent" | "spent";

export interface Note {
  id: string;
  value: bigint;
  /** Legacy random secret; kept for notes created before mnemonic derivation. */
  secret: string;
  /** Legacy random secret; kept for notes created before mnemonic derivation. */
  nullifierSecret: string;
  /** When set, secrets are re-derived from wallet mnemonic + this index. */
  derivationIndex?: number;
  ownerPubkey: string;
  commitment: string;
  /** Index in the on-chain Merkle tree at deposit time. */
  leafIndex: number;
  status: NoteStatus;
  createdAt: number;
}

export interface StoredNoteVault {
  version: 2;
  /** BIP39 phrase stored locally (demo). Import on a new device to recover derived notes. */
  mnemonic: string | null;
  /** Optional PIN-encrypted mnemonic (preferred when set). */
  encryptedMnemonic?: import("./mnemonic-crypto").EncryptedMnemonic | null;
  /** Next free index for deriveNoteSecrets(mnemonic, index). */
  nextDerivationIndex: number;
  notes: Note[];
  /** Commitments in on-chain insertion order (single-user demo assumption). */
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
    version: 2,
    mnemonic: null,
    nextDerivationIndex: 0,
    notes: [],
    chainCommitments: [],
  };
}
