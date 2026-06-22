import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { x25519 } from "@noble/curves/ed25519.js";

/** BN254 scalar field order — must match Noir / Soroban. */
export const BN254_FR_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const NOTE_HKDF_SALT = new TextEncoder().encode("zk-notes-v1");
const SHIELDED_HKDF_SALT = new TextEncoder().encode("zk-notes-shielded-v1");

/** Normalize PRF output into a stable 32-byte root seed. */
export function rootSeedFromPrf(prfOutput: Uint8Array): Uint8Array {
  return hkdf(
    sha256,
    prfOutput,
    new TextEncoder().encode("zk-notes-passkey-root-v1"),
    new TextEncoder().encode("root"),
    32
  );
}

function bytesToFieldDecimal(seed: Uint8Array, info: string): string {
  const derived = hkdf(sha256, seed, NOTE_HKDF_SALT, new TextEncoder().encode(info), 32);
  let value = 0n;
  for (const byte of derived) {
    value = (value << 8n) + BigInt(byte);
  }
  return (value % BN254_FR_MODULUS).toString();
}

/** Deterministic deposit secret from root seed + monotonic index (enables rescan). */
export function deriveDepositSecretFromSeed(
  seed: Uint8Array,
  derivationIndex: number
): Uint8Array {
  if (derivationIndex < 0) {
    throw new Error("derivation index must be non-negative");
  }
  return hkdf(
    sha256,
    seed,
    NOTE_HKDF_SALT,
    new TextEncoder().encode(`zk-notes/deposit/${derivationIndex}`),
    32
  );
}

/** Deterministic note secrets from root seed + monotonic index. */
export function deriveNoteSecretsFromSeed(
  seed: Uint8Array,
  derivationIndex: number
): { secret: string; nullifierSecret: string } {
  if (derivationIndex < 0) {
    throw new Error("derivation index must be non-negative");
  }
  return {
    secret: bytesToFieldDecimal(seed, `zk-notes/secret/${derivationIndex}`),
    nullifierSecret: bytesToFieldDecimal(
      seed,
      `zk-notes/nullifier/${derivationIndex}`
    ),
  };
}

export type ShieldedReceiveKeys = {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
};

export function deriveShieldedReceiveKeysFromSeed(
  seed: Uint8Array
): ShieldedReceiveKeys {
  const scalar = hkdf(
    sha256,
    seed,
    SHIELDED_HKDF_SALT,
    new TextEncoder().encode("receive-sk"),
    32
  );
  const { secretKey, publicKey } = x25519.keygen(scalar);
  return { secretKey, publicKey };
}
