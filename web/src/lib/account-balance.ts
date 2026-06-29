import { fetchStellarAccountInfo } from "./soroban-client";

export async function fetchPublicXlmBalance(publicKey: string): Promise<string | null> {
  try {
    const info = await fetchStellarAccountInfo(publicKey);
    if (!info.exists) return null;
    return info.nativeBalance;
  } catch {
    return null;
  }
}
