import { executeNoirField } from "./noir-runtime";

export async function computeCommitment(
  value: string,
  secret: string,
  nullifierSecret: string
): Promise<string> {
  return executeNoirField("note_hash", {
    value,
    secret,
    nullifier_secret: nullifierSecret,
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

/** Batch commitment for rescan — secrets never leave the browser. */
export async function computeCommitmentsBatch(
  items: Array<{
    id: string;
    value: string;
    secret: string;
    nullifierSecret: string;
  }>
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    items.map(async (item) => {
      out[item.id] = await computeCommitment(
        item.value,
        item.secret,
        item.nullifierSecret
      );
    })
  );
  return out;
}
