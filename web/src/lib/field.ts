/** Convert a field hex string (0x...) to 32-byte commitment for Soroban BytesN<32>. */
export function fieldHexToBytes32(hex: string): Uint8Array {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  const padded = normalized.padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function fieldDecToBytes32(value: string): Uint8Array {
  const hex = BigInt(value).toString(16).padStart(64, "0");
  return fieldHexToBytes32(`0x${hex}`);
}

export function randomField(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return BigInt(`0x${hex}`).toString();
}

export function stroopsFromXlm(amount: string): bigint {
  const trimmed = amount.trim();
  if (!trimmed) return BigInt(0);
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0000000").slice(0, 7);
  return BigInt(whole || "0") * BigInt(10_000_000) + BigInt(fracPadded);
}
