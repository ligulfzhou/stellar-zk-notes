import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

/** BN254 scalar field order — must match Noir / Soroban. */
export const BN254_FR_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const HKDF_SALT = new TextEncoder().encode("zk-notes-v1");

export function generateWalletMnemonic(): string {
  return generateMnemonic(wordlist, 128);
}

export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(normalizeMnemonic(mnemonic), wordlist);
}

function bytesToFieldDecimal(seed: Uint8Array, info: string): string {
  const derived = hkdf(sha256, seed, HKDF_SALT, new TextEncoder().encode(info), 32);
  let value = 0n;
  for (const byte of derived) {
    value = (value << 8n) + BigInt(byte);
  }
  return (value % BN254_FR_MODULUS).toString();
}

/** Deterministic note secrets from BIP39 mnemonic + monotonic index. */
export function deriveNoteSecrets(
  mnemonic: string,
  derivationIndex: number
): { secret: string; nullifierSecret: string } {
  if (derivationIndex < 0) {
    throw new Error("derivation index must be non-negative");
  }
  const seed = mnemonicToSeedSync(normalizeMnemonic(mnemonic));
  return {
    secret: bytesToFieldDecimal(seed, `zk-notes/secret/${derivationIndex}`),
    nullifierSecret: bytesToFieldDecimal(
      seed,
      `zk-notes/nullifier/${derivationIndex}`
    ),
  };
}

export function deriveNoteSecretsOrThrow(
  mnemonic: string | null | undefined,
  derivationIndex: number | undefined
): { secret: string; nullifierSecret: string } | null {
  if (!mnemonic || derivationIndex === undefined) {
    return null;
  }
  return deriveNoteSecrets(mnemonic, derivationIndex);
}
