export type ExitJob = {
  txHash: string;
  poolId: number;
  nullifier: string;
  exitHash: string;
  encryptedExit: Uint8Array;
};

function x25519SecretFromHex(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export { x25519SecretFromHex };
