import type { Note } from "./note-types";
import { deriveNoteSecretsFromSeed } from "./root-seed";
import { usePasskeyStore } from "@/store/usePasskeyStore";

/** Resolve spend secrets from passkey root or stored payment-import values. */
export function resolveNoteSecrets(
  note: Note,
  rootSeed: Uint8Array | null
): {
  secret: string;
  nullifierSecret: string;
  source: "derived" | "imported";
} {
  if (note.derivationIndex !== undefined) {
    if (!rootSeed) {
      throw new Error("Unlock passkey first");
    }
    const derived = deriveNoteSecretsFromSeed(rootSeed, note.derivationIndex);
    return { ...derived, source: "derived" };
  }
  return {
    secret: note.secret,
    nullifierSecret: note.nullifierSecret,
    source: "imported",
  };
}

export async function resolveNoteSecretsFromVault(note: Note) {
  const rootSeed = usePasskeyStore.getState().rootSeed;
  return resolveNoteSecrets(note, rootSeed);
}
