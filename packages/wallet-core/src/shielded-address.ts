import { bech32m } from "@scure/base";
import { fieldDecToHex, fieldHexToDec } from "./shielded.js";

export const ADDRESS_VERSION = 1;
export const DIVERSIFIER_BYTES = 11;
export const SHIELDED_ADDRESS_HRP = "zkstellar";
const PAYLOAD_LEN = 1 + DIVERSIFIER_BYTES + 32 + 32;

export type DecodedShieldedAddress = {
  diversifier: string;
  recipientPk: string;
  recipientPkHex: string;
  x25519Hex: string;
};

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
  return bech32m.encode(SHIELDED_ADDRESS_HRP, bech32m.toWords(payload), false);
}

export function decodeShieldedAddress(address: string): DecodedShieldedAddress {
  const trimmed = address.trim().toLowerCase();
  const decoded = bech32m.decodeToBytes(trimmed);
  if (decoded.prefix !== SHIELDED_ADDRESS_HRP) {
    throw new Error(`Expected ${SHIELDED_ADDRESS_HRP} address`);
  }
  const payload = decoded.bytes;
  if (payload.length !== PAYLOAD_LEN || payload[0] !== ADDRESS_VERSION) {
    throw new Error("Invalid shielded address");
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
