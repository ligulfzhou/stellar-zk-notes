/** Mock proof bytes for demo with MockVerifier on testnet. */
export function mockProofBytes(): Uint8Array {
  return new Uint8Array(32).fill(0xab);
}

export function proofBytesFromHex(hex: string | null | undefined): Uint8Array {
  if (!hex || hex === "generated") return mockProofBytes();
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes.length > 0 ? bytes : mockProofBytes();
}
