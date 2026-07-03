import type { Note } from "./note-types";
import { deriveSpendingSkFromSeed } from "./shielded-keys";

/** Resolve spending_sk from unlocked mnemonic master seed. */
export function resolveSpendingSk(masterSeed: Uint8Array | null): string {
  if (!masterSeed) {
    throw new Error("Unlock privacy wallet first");
  }
  return deriveSpendingSkFromSeed(masterSeed);
}

export async function resolveSpendingSkFromVault(): Promise<string> {
  const { useSecretsStore } = await import("@/store/useSecretsStore");
  const masterSeed = useSecretsStore.getState().requireSeed();
  return resolveSpendingSk(masterSeed);
}

export function assertNoteOwnedBySpendingPk(
  note: Note,
  spendingPk: string
): void {
  if (BigInt(note.spendingPk) !== BigInt(spendingPk)) {
    throw new Error("Note spending key mismatch — rescan or wrong wallet");
  }
}
