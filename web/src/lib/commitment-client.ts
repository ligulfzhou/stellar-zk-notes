export async function computeCommitment(
  value: string,
  secret: string,
  nullifierSecret: string
): Promise<string> {
  const res = await fetch("/api/commitment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value, secret, nullifierSecret }),
  });
  const data = (await res.json()) as { commitment?: string; error?: string };
  if (!res.ok || !data.commitment) {
    throw new Error(data.error ?? "commitment failed");
  }
  return data.commitment;
}

export async function computeNullifier(
  nullifierSecret: string,
  commitment: string
): Promise<string> {
  const res = await fetch("/api/nullifier", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nullifierSecret, commitment }),
  });
  const data = (await res.json()) as { nullifier?: string; error?: string };
  if (!res.ok || !data.nullifier) {
    throw new Error(data.error ?? "nullifier failed");
  }
  return data.nullifier;
}
