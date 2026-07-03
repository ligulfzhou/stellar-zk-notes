import type { PasskeyVaultConfig } from "./passkey";
import type { EncryptedMnemonic } from "./encrypted-secrets";

export type NoteStatus = "unspent" | "spent";

export interface Note {
  id: string;
  value: bigint;
  noteRandomness: string;
  /** Diversified recipient pk bound in commitment (equals spending_pk when d=0). */
  spendingPk: string;
  /** Payment address diversifier (0 = default / v2-compatible). */
  diversifier: string;
  commitment: string;
  leafIndex: number;
  status: NoteStatus;
  createdAt: number;
  received?: boolean;
}

export interface StoredNoteVault {
  version: 7;
  /** BIP39 mnemonic encrypted at rest (passkey PRF or password). */
  encryptedMnemonic: EncryptedMnemonic | null;
  /** Optional password-wrap salt when method=password. */
  passwordSalt: string | null;
  passkey: PasskeyVaultConfig | null;
  /** Next diversifier index for fresh receive addresses. */
  addressIndex: number;
  notes: Note[];
  chainCommitments: string[];
}

export function sumUnspentNotes(notes: Note[]): bigint {
  return notes
    .filter((n) => n.status === "unspent")
    .reduce((sum, n) => sum + n.value, 0n);
}

export function defaultVault(): StoredNoteVault {
  return {
    version: 7,
    encryptedMnemonic: null,
    passwordSalt: null,
    passkey: null,
    addressIndex: 1,
    notes: [],
    chainCommitments: [],
  };
}

export function hasWalletSecrets(vault: StoredNoteVault): boolean {
  return Boolean(vault.encryptedMnemonic);
}

/** @deprecated */
export function hasPasskey(vault: StoredNoteVault): boolean {
  return Boolean(vault.passkey?.credentials.length);
}
