import type { Note } from "./note-types";
import { deriveSpendingSkFromSeed } from "./shielded-keys";

/** Resolve spending_sk from passkey root seed (v2 Sapling-style). */
export function resolveSpendingSk(rootSeed: Uint8Array | null): string {
  if (!rootSeed) {
    throw new Error("Unlock passkey first");
  }
  return deriveSpendingSkFromSeed(rootSeed);
}

export async function resolveSpendingSkFromVault(): Promise<string> {
  const { usePasskeyStore } = await import("@/store/usePasskeyStore");
  const rootSeed = usePasskeyStore.getState().requireSeed();
  return resolveSpendingSk(rootSeed);
}

export function assertNoteOwnedBySpendingPk(
  note: Note,
  spendingPk: string
): void {
  if (BigInt(note.spendingPk) !== BigInt(spendingPk)) {
    throw new Error("Note spending key mismatch — rescan or wrong wallet");
  }
}
