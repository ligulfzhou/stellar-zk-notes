import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { x25519 } from "@noble/curves/ed25519.js";

/** BN254 scalar field order — must match Noir / Soroban. */
export const BN254_FR_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const NOTE_HKDF_SALT = new TextEncoder().encode("zk-notes-v1");
const SHIELDED_HKDF_SALT = new TextEncoder().encode("zk-notes-shielded-v1");

export function bytesToFieldDecimal(seed: Uint8Array, info: string): string {
  const derived = hkdf(sha256, seed, NOTE_HKDF_SALT, new TextEncoder().encode(info), 32);
  let value = 0n;
  for (const byte of derived) {
    value = (value << 8n) + BigInt(byte);
  }
  return (value % BN254_FR_MODULUS).toString();
}

export function deriveSpendingSkDecimal(shieldedMaster: Uint8Array): string {
  return bytesToFieldDecimal(shieldedMaster, "zk-utxo/spending-sk");
}

export type ShieldedReceiveKeys = {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
};

export function deriveShieldedReceiveKeys(
  shieldedMaster: Uint8Array,
  diversifier: string | bigint = "0"
): ShieldedReceiveKeys {
  const d =
    typeof diversifier === "bigint" ? diversifier.toString() : diversifier;
  const scalar = hkdf(
    sha256,
    shieldedMaster,
    SHIELDED_HKDF_SALT,
    new TextEncoder().encode(`receive-sk/${d}`),
    32
  );
  const { secretKey, publicKey } = x25519.keygen(scalar);
  return { secretKey, publicKey };
}

export function deriveIncomingViewingKeyHex(shieldedMaster: Uint8Array): string {
  const derived = hkdf(
    sha256,
    shieldedMaster,
    new Uint8Array(),
    new TextEncoder().encode("incoming-viewing-key"),
    32
  );
  return [...derived].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fieldDecToHex(value: string): string {
  if (value === "0") return "0".repeat(64);
  return BigInt(value).toString(16).padStart(64, "0");
}

export function fieldHexToDec(hex: string): string {
  const h = hex.startsWith("0x") ? hex : `0x${hex}`;
  return BigInt(h).toString();
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
