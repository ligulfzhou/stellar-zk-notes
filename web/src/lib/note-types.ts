import type { PasskeyVaultConfig } from "./passkey";

export type NoteStatus = "unspent" | "spent";

export interface Note {
  id: string;
  value: bigint;
  /** Per-note randomness (rcm) — sender-chosen for outputs, stored locally for spends. */
  noteRandomness: string;
  /** Spending public key bound in the commitment (owner). */
  spendingPk: string;
  commitment: string;
  leafIndex: number;
  status: NoteStatus;
  createdAt: number;
  /** Received via shielded send (decrypted from chain event). */
  received?: boolean;
}

export interface StoredNoteVault {
  version: 6;
  passkey: PasskeyVaultConfig | null;
  notes: Note[];
  /** Global Merkle leaf commitments (index = leaf slot). */
  chainCommitments: string[];
}

export function sumUnspentNotes(notes: Note[]): bigint {
  return notes
    .filter((n) => n.status === "unspent")
    .reduce((sum, n) => sum + n.value, 0n);
}

export function defaultVault(): StoredNoteVault {
  return {
    version: 6,
    passkey: null,
    notes: [],
    chainCommitments: [],
  };
}

export function hasPasskey(vault: StoredNoteVault): boolean {
  return Boolean(vault.passkey?.credentials.length);
}
