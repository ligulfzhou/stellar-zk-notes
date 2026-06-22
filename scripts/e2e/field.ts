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
  nullifierHexes: string[];
  newCommitmentHexes: string[];
  publicAmount: string;
}): Uint8Array {
  const pad = (hexes: string[]) => {
    const out = [...hexes];
    while (out.length < 4) out.push("0x0");
    return out.slice(0, 4);
  };
  const chunks = [
    fieldHexToBytes32(params.merkleRootHex),
    ...pad(params.nullifierHexes).map(fieldHexToBytes32),
    ...pad(params.newCommitmentHexes).map(fieldHexToBytes32),
    fieldDecToBytes32(params.publicAmount),
  ];
  const out = new Uint8Array(320);
  chunks.forEach((chunk, i) => out.set(chunk, i * 32));
  return out;
}

export function mockProofBytes(): Uint8Array {
  return new Uint8Array(32).fill(0xab);
}

export function proofBytesFromHex(hex: string | null | undefined): Uint8Array {
  if (!hex || hex === "generated") return mockProofBytes();
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  const lines = normalized.split(/\s+/).filter(Boolean);
  const hexLine = lines.find((line) => /^[0-9a-f]+$/i.test(line) && line.length >= 64) ?? normalized;
  if (!hexLine) return mockProofBytes();
  const bytes = new Uint8Array(hexLine.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hexLine.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
