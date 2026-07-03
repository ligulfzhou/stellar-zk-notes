import { bech32m } from "@scure/base";
import { STELLAR_NETWORK } from "./config";
import { fieldDecToHex, fieldHexToDec } from "./shielded-keys";

export const ADDRESS_VERSION = 1;
export const DIVERSIFIER_BYTES = 11;
const PAYLOAD_LEN = 1 + DIVERSIFIER_BYTES + 32 + 32;

export type DecodedShieldedAddress = {
  diversifier: string;
  recipientPk: string;
  recipientPkHex: string;
  x25519Hex: string;
};

function hrp(): string {
  return STELLAR_NETWORK.toLowerCase() === "mainnet" ? "zkstellar" : "zkstellar";
}

function diversifierToBytes(diversifier: bigint): Uint8Array {
  if (diversifier < 0n) throw new Error("diversifier must be non-negative");
  const max = (1n << BigInt(DIVERSIFIER_BYTES * 8)) - 1n;
  if (diversifier > max) throw new Error("diversifier out of range");
  const out = new Uint8Array(DIVERSIFIER_BYTES);
  let v = diversifier;
  for (let i = DIVERSIFIER_BYTES - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function bytesToDiversifier(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const byte of bytes) {
    v = (v << 8n) + BigInt(byte);
  }
  return v;
}

function fieldHexToBytes32(hex: string): Uint8Array {
  const h = hex.replace(/^0x/i, "").toLowerCase();
  if (h.length !== 64) throw new Error("field hex must be 32 bytes");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytes32ToFieldHex(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error("expected 32 bytes");
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Encode unified shielded receive address (bech32m). */
export function encodeShieldedAddress(params: {
  diversifier: bigint | string;
  recipientPk: string;
  x25519Hex: string;
}): string {
  const d =
    typeof params.diversifier === "string"
      ? BigInt(params.diversifier)
      : params.diversifier;
  const recipientPkHex = fieldDecToHex(params.recipientPk);
  const x25519 = params.x25519Hex.replace(/^0x/i, "").toLowerCase();
  if (x25519.length !== 64) {
    throw new Error("x25519 must be 32-byte hex");
  }

  const payload = new Uint8Array(PAYLOAD_LEN);
  payload[0] = ADDRESS_VERSION;
  payload.set(diversifierToBytes(d), 1);
  payload.set(fieldHexToBytes32(recipientPkHex), 1 + DIVERSIFIER_BYTES);
  payload.set(fieldHexToBytes32(x25519), 1 + DIVERSIFIER_BYTES + 32);

  // 76-byte payload exceeds Bitcoin's default bech32 90-char limit; zkstellar needs ~138.
  return bech32m.encode(hrp(), bech32m.toWords(payload), false);
}

export function decodeShieldedAddress(address: string): DecodedShieldedAddress {
  const trimmed = address.trim().toLowerCase();
  let decoded: { prefix: string; bytes: Uint8Array };
  try {
    decoded = bech32m.decodeToBytes(trimmed);
  } catch {
    throw new Error("Invalid shielded address encoding");
  }
  if (decoded.prefix !== hrp()) {
    throw new Error(`Expected ${hrp()} address for this network`);
  }
  const payload = decoded.bytes;
  if (payload.length !== PAYLOAD_LEN) {
    throw new Error("Invalid shielded address length");
  }
  if (payload[0] !== ADDRESS_VERSION) {
    throw new Error("Unsupported shielded address version");
  }

  const diversifier = bytesToDiversifier(
    payload.slice(1, 1 + DIVERSIFIER_BYTES)
  ).toString();
  const recipientPkHex = bytes32ToFieldHex(
    payload.slice(1 + DIVERSIFIER_BYTES, 1 + DIVERSIFIER_BYTES + 32)
  );
  const x25519Hex = bytes32ToFieldHex(
    payload.slice(1 + DIVERSIFIER_BYTES + 32)
  );

  return {
    diversifier,
    recipientPk: fieldHexToDec(recipientPkHex),
    recipientPkHex,
    x25519Hex,
  };
}

export function isShieldedAddress(input: string): boolean {
  try {
    decodeShieldedAddress(input);
    return true;
  } catch {
    return false;
  }
}
