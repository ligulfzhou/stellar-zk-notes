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

export function randomFieldDecimal(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(`0x${hex}`).toString();
}

export function encodePublicInputs(params: {
  merkleRootHex: string;
  nullifierHex: string;
  newCommitmentHex: string;
  publicAmount: string;
  mode: string;
}): Uint8Array {
  const chunks = [
    fieldHexToBytes32(params.merkleRootHex),
    fieldHexToBytes32(params.nullifierHex),
    fieldHexToBytes32(params.newCommitmentHex),
    fieldDecToBytes32(params.publicAmount),
    fieldDecToBytes32(params.mode),
  ];
  const out = new Uint8Array(160);
  chunks.forEach((chunk, i) => out.set(chunk, i * 32));
  return out;
}

export function mockProofBytes(): Uint8Array {
  return new Uint8Array(32).fill(0xab);
}
