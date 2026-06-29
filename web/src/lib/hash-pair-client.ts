import { executeNoirField } from "./noir-runtime";

/** Client-side Poseidon2 pair hash (Noir hash_pair circuit — no server round-trip). */
export async function hashPair(left: bigint, right: bigint): Promise<bigint> {
  const hex = await executeNoirField("hash_pair", {
    left: left.toString(),
    right: right.toString(),
  });
  return BigInt(hex);
}
