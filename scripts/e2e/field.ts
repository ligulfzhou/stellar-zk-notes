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

export function encodePublicInputs(params: {
  merkleRootHex: string;
  nullifierHexes: string[];
  newCommitmentHexes: string[];
  publicAmount: string;
  relayerFeeStroops?: string;
}): Uint8Array {
  const pad = (hexes: string[]) => {
    const out = [...hexes];
    while (out.length < 4) out.push("0x0");
    return out.slice(0, 4);
  };
  const relayerFee = params.relayerFeeStroops ?? "0";
  const chunks = [
    fieldHexToBytes32(params.merkleRootHex),
    ...pad(params.nullifierHexes).map(fieldHexToBytes32),
    ...pad(params.newCommitmentHexes).map(fieldHexToBytes32),
    fieldDecToBytes32(params.publicAmount),
    fieldDecToBytes32(relayerFee),
  ];
  const out = new Uint8Array(352);
  chunks.forEach((chunk, i) => out.set(chunk, i * 32));
  return out;
}

export function mockProofBytes(): Uint8Array {
  return new Uint8Array(32).fill(0xab);
}

export function publicInputsToHex(publicInputs: Uint8Array): string {
  return Buffer.from(publicInputs).toString("hex");
}

export function proofToHex(proof: Uint8Array): string {
  return Buffer.from(proof).toString("hex");
}
