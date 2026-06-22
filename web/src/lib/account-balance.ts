export async function fetchPublicXlmBalance(publicKey: string): Promise<string | null> {
  const res = await fetch(
    `/api/stellar-account?address=${encodeURIComponent(publicKey)}`
  );
  const data = (await res.json()) as {
    nativeBalance?: string | null;
    exists?: boolean;
    error?: string;
  };
  if (!res.ok || !data.exists) return null;
  return data.nativeBalance ?? null;
}
