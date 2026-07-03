import { randomBytes } from "@noble/ciphers/utils.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { executeNoirField } from "./noir-runtime";
import { encodeShieldedAddress } from "./shielded-address";
import { deriveShieldedReceiveKeysFromSeed } from "./root-seed";
import { BN254_FR_MODULUS, bytesToFieldDecimal } from "./root-seed";

export const DOMAIN_SPENDING_PK = "1";
export const DOMAIN_NULLIFIER_KEY = "2";
export const DOMAIN_INCOMING_VIEWING = "3";

const IVK_INFO = new TextEncoder().encode("incoming-viewing-key");

export function deriveSpendingSkFromSeed(seed: Uint8Array): string {
  return bytesToFieldDecimal(seed, "zk-utxo/spending-sk");
}

export async function deriveSpendingPk(spendingSk: string): Promise<string> {
  return executeNoirField("hash_pair", {
    left: spendingSk,
    right: DOMAIN_SPENDING_PK,
  });
}

export async function deriveNullifierKey(spendingSk: string): Promise<string> {
  return executeNoirField("hash_pair", {
    left: spendingSk,
    right: DOMAIN_NULLIFIER_KEY,
  });
}

/** Viewing key for scan-only wallets (cannot spend). */
export function deriveIncomingViewingKeyHex(masterSeed: Uint8Array): string {
  const derived = hkdf(sha256, masterSeed, new Uint8Array(), IVK_INFO, 32);
  return [...derived].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** d=0 → spending_pk (v2 compatible); d>0 diversifies payment address. */
export async function diversifiedRecipientPk(
  spendingPk: string,
  diversifier: string
): Promise<string> {
  if (BigInt(diversifier) === 0n) return spendingPk;
  return executeNoirField("hash_pair", {
    left: spendingPk,
    right: diversifier,
  });
}

export async function deriveSpendingKeysFromSeed(seed: Uint8Array): Promise<{
  spendingSk: string;
  spendingPk: string;
  spendingPkHex: string;
}> {
  const spendingSk = deriveSpendingSkFromSeed(seed);
  const spendingPk = await deriveSpendingPk(spendingSk);
  return {
    spendingSk,
    spendingPk,
    spendingPkHex: fieldDecToHex(spendingPk),
  };
}

export type ShieldedReceiveBundle = {
  diversifier: string;
  spendingPk: string;
  recipientPk: string;
  recipientPkHex: string;
  x25519Hex: string;
  address: string;
  incomingViewingKeyHex: string;
};

export async function deriveShieldedReceiveBundle(
  masterSeed: Uint8Array,
  diversifier: string | bigint
): Promise<ShieldedReceiveBundle> {
  const d =
    typeof diversifier === "bigint" ? diversifier.toString() : diversifier;
  const { spendingPk } = await deriveSpendingKeysFromSeed(masterSeed);
  const recipientPk = await diversifiedRecipientPk(spendingPk, d);
  const { publicKey } = deriveShieldedReceiveKeysFromSeed(masterSeed, d);
  const x25519Hex = [...publicKey]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return {
    diversifier: d,
    spendingPk,
    recipientPk,
    recipientPkHex: fieldDecToHex(recipientPk),
    x25519Hex,
    address: encodeShieldedAddress({
      diversifier: d,
      recipientPk,
      x25519Hex,
    }),
    incomingViewingKeyHex: deriveIncomingViewingKeyHex(masterSeed),
  };
}

export function randomNoteRandomness(): string {
  const bytes = randomBytes(32);
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }
  return (value % BN254_FR_MODULUS).toString();
}

export function fieldDecToHex(value: string): string {
  if (value === "0") return "0".repeat(64);
  return BigInt(value).toString(16).padStart(64, "0");
}

export function fieldHexToDec(hex: string): string {
  const h = hex.startsWith("0x") ? hex : `0x${hex}`;
  return BigInt(h).toString();
}

/** @deprecated Legacy zk1 hex format — use zkstellar bech32 addresses. */
export function formatShieldedReceiveAddress(
  spendingPkHex: string,
  x25519Hex: string
): string {
  const pk = spendingPkHex.replace(/^0x/i, "").toLowerCase();
  const enc = x25519Hex.replace(/^0x/i, "").toLowerCase();
  if (pk.length !== 64 || enc.length !== 64) {
    throw new Error("Invalid key length for shielded address");
  }
  return `zk1:${pk}#${enc}`;
}

/** @deprecated */
export function parseShieldedReceiveAddress(input: string): {
  spendingPkHex: string;
  spendingPk: string;
  x25519Hex: string;
  diversifier: string;
} {
  const trimmed = input.trim();
  if (trimmed.startsWith("zk1:")) {
    const body = trimmed.slice(4);
    const [pkHex, encHex] = body.includes("#")
      ? body.split("#", 2)
      : [body, ""];
    if (!pkHex || pkHex.length !== 64) {
      throw new Error("Invalid zk1 spending pk");
    }
    if (!encHex || encHex.length !== 64) {
      throw new Error("Missing x25519 delivery key");
    }
    return {
      spendingPkHex: pkHex.toLowerCase(),
      spendingPk: fieldHexToDec(pkHex),
      x25519Hex: encHex.toLowerCase(),
      diversifier: "0",
    };
  }
  throw new Error("Enter zkstellar shielded address");
}
