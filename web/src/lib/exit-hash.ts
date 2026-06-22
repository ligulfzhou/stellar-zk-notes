import { executeNoirField } from "./noir-runtime";
import { ENCRYPTED_EXIT_MAX } from "./pool-config";

/** Poseidon2 hash of encrypted exit bytes (matches circuits/exit_hash). */
export async function computeExitHash(encrypted: Uint8Array): Promise<string> {
  if (encrypted.length === 0 || encrypted.length > ENCRYPTED_EXIT_MAX) {
    throw new Error(`Invalid encrypted exit length ${encrypted.length}`);
  }
  const bytes = Array.from({ length: ENCRYPTED_EXIT_MAX }, (_, i) =>
    i < encrypted.length ? encrypted[i]!.toString() : "0"
  );
  return executeNoirField("exit_hash", {
    bytes,
    len: encrypted.length.toString(),
  });
}
