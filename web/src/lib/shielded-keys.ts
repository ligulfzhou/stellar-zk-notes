import { randomBytes } from "@noble/ciphers/utils.js";
import { executeNoirField } from "./noir-runtime";
import { BN254_FR_MODULUS, bytesToFieldDecimal } from "./root-seed";

export const DOMAIN_SPENDING_PK = "1";
export const DOMAIN_NULLIFIER_KEY = "2";

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

/** zk1:<spending_pk_hex>#<x25519_hex> — pk for commitment, x25519 for encrypted delivery */
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

export function parseShieldedReceiveAddress(input: string): {
  spendingPkHex: string;
  spendingPk: string;
  x25519Hex: string;
} {
  const trimmed = input.trim();
  if (trimmed.startsWith("zk1:")) {
    const body = trimmed.slice(4);
    const [pkHex, encHex] = body.includes("#")
      ? body.split("#", 2)
      : [body, ""];
    if (!pkHex || pkHex.length !== 64) {
      throw new Error("Invalid zk1 spending pk — use zk1:<pk64>#<x25519_64>");
    }
    if (!encHex || encHex.length !== 64) {
      throw new Error("Missing x25519 delivery key — use zk1:<pk64>#<x25519_64>");
    }
    return {
      spendingPkHex: pkHex.toLowerCase(),
      spendingPk: fieldHexToDec(pkHex),
      x25519Hex: encHex.toLowerCase(),
    };
  }
  if (trimmed.startsWith("0x") && trimmed.length === 66) {
    const pkHex = trimmed.slice(2).toLowerCase();
    throw new Error("Include delivery key: zk1:<pk64>#<x25519_64>");
  }
  throw new Error("Enter zk1:<spending_pk>#<x25519> receive address");
}
