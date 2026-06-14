import type { Note } from "./note-types";
import { deriveNoteSecretsOrThrow } from "./mnemonic";
import { loadVault } from "./note-store";

/** Resolve spend secrets: derived from mnemonic when possible, else legacy stored values. */
export function resolveNoteSecrets(note: Note, mnemonic: string | null): {
  secret: string;
  nullifierSecret: string;
  source: "derived" | "legacy";
} {
  const derived = deriveNoteSecretsOrThrow(mnemonic, note.derivationIndex);
  if (derived) {
    return { ...derived, source: "derived" };
  }
  return {
    secret: note.secret,
    nullifierSecret: note.nullifierSecret,
    source: "legacy",
  };
}

export async function resolveNoteSecretsFromVault(note: Note) {
  const vault = await loadVault();
  return resolveNoteSecrets(note, vault.mnemonic);
}
