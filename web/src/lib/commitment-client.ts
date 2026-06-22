import {
  computeCommitmentV2,
  depositSecretFromHex,
  depositSecretToHex,
} from "./commitment-v2";
import { executeNoirField } from "./noir-runtime";
import { deriveDepositSecretFromSeed } from "./root-seed";

/** @deprecated Phase B — use computeCommitmentV2 */
export async function computeCommitment(
  value: string,
  secret: string,
  nullifierSecret: string
): Promise<string> {
  const zeroDeposit = new Uint8Array(32);
  return computeCommitmentV2({
    valueStroops: BigInt(value),
    secret,
    nullifierSecret,
    depositSecret: zeroDeposit,
    poolId: 0,
  });
}

export async function computeNullifier(
  nullifierSecret: string,
  commitment: string
): Promise<string> {
  const commitmentDec = BigInt(
    commitment.startsWith("0x") ? commitment : `0x${commitment}`
  ).toString();
  return executeNoirField("hash_pair", {
    left: nullifierSecret,
    right: commitmentDec,
  });
}

/** Batch commitment v2 for rescan — secrets never leave the browser. */
export async function computeCommitmentsV2Batch(
  items: Array<{
    id: string;
    value: string;
    secret: string;
    nullifierSecret: string;
    depositSecret: Uint8Array;
    poolId: number;
  }>
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    items.map(async (item) => {
      out[item.id] = await computeCommitmentV2({
        valueStroops: BigInt(item.value),
        secret: item.secret,
        nullifierSecret: item.nullifierSecret,
        depositSecret: item.depositSecret,
        poolId: item.poolId,
      });
    })
  );
  return out;
}

export {
  computeCommitmentV2,
  depositSecretFromHex,
  depositSecretToHex,
};
