import type { PasskeyVaultConfig } from "./passkey";
import { emptyPoolChainCommitments, POOL_COUNT } from "./pool-config";

export type NoteStatus = "unspent" | "spent";

export interface Note {
  id: string;
  value: bigint;
  /** Denomination pool (0 = 1 XLM, 1 = 10 XLM, 2 = 100 XLM). */
  poolId: number;
  /** Stored secrets for ECDH-received notes; derived notes recompute from passkey. */
  secret: string;
  nullifierSecret: string;
  /** Hex-encoded 32-byte deposit secret for commitment v2 (re-derivable from passkey). */
  depositSecretHex?: string;
  /** When set, secrets are re-derived from passkey root + this index. */
  derivationIndex?: number;
  ownerPubkey: string;
  commitment: string;
  leafIndex: number;
  status: NoteStatus;
  createdAt: number;
}

export interface StoredNoteVault {
  version: 4;
  passkey: PasskeyVaultConfig | null;
  nextDerivationIndex: number;
  notes: Note[];
  /** Per-pool Merkle leaf commitments (index = leaf slot). */
  poolChainCommitments: string[][];
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
    version: 4,
    passkey: null,
    nextDerivationIndex: 0,
    notes: [],
    poolChainCommitments: emptyPoolChainCommitments(),
  };
}

export function hasPasskey(vault: StoredNoteVault): boolean {
  return Boolean(vault.passkey?.credentials.length);
}

export function poolChainCommitmentsFor(
  vault: StoredNoteVault,
  poolId: number
): string[] {
  if (poolId < 0 || poolId >= POOL_COUNT) {
    throw new Error(`Invalid pool id ${poolId}`);
  }
  return vault.poolChainCommitments[poolId] ?? [];
}

/** Flattened commitments for a pool (defaults to pool 0 for legacy callers). */
export function chainCommitmentsForPool(
  vault: StoredNoteVault,
  poolId = 0
): string[] {
  return poolChainCommitmentsFor(vault, poolId);
}
