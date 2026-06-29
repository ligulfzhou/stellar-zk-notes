import { executeNoirField } from "./noir-runtime";
import { BN254_FR_MODULUS } from "./root-seed";

export function randomDepositSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function depositSecretToField(depositSecret: Uint8Array): string {
  let value = 0n;
  for (const byte of depositSecret) {
    value = (value << 8n) + BigInt(byte);
  }
  return (value % BN254_FR_MODULUS).toString();
}

export function depositSecretToHex(depositSecret: Uint8Array): string {
  return (
    "0x" +
    [...depositSecret].map((b) => b.toString(16).padStart(2, "0")).join("")
  );
}

export function depositSecretFromHex(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function computeCommitmentV2(params: {
  valueStroops: bigint;
  secret: string;
  nullifierSecret: string;
  depositSecret: Uint8Array;
  poolId: number;
}): Promise<string> {
  return executeNoirField("note_hash", {
    value: params.valueStroops.toString(),
    secret: params.secret,
    nullifier_secret: params.nullifierSecret,
    deposit_secret: depositSecretToField(params.depositSecret),
    pool_id: params.poolId.toString(),
  });
}
