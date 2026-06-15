import { Account } from "@stellar/stellar-sdk";
import { formatError } from "./format-error";

export async function fetchStellarAccount(publicKey: string): Promise<Account> {
  const res = await fetch(
    `/api/stellar-account?address=${encodeURIComponent(publicKey)}`
  );
  const data = (await res.json()) as {
    exists?: boolean;
    accountId?: string;
    sequence?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? "Account lookup failed");
  }
  if (!data.exists || !data.sequence) {
    throw new Error("Account not found on testnet");
  }
  return new Account(data.accountId ?? publicKey, data.sequence);
}

export async function accountExistsViaApi(publicKey: string): Promise<boolean> {
  const res = await fetch(
    `/api/stellar-account?address=${encodeURIComponent(publicKey)}`
  );
  const data = (await res.json()) as { exists?: boolean; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "Account lookup failed");
  }
  return Boolean(data.exists);
}

export async function prepareTransactionViaApi(
  xdr: string
): Promise<{ xdr: string; latestLedger: number }> {
  const res = await fetch("/api/soroban/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xdr }),
  });
  const data = (await res.json()) as {
    xdr?: string;
    latestLedger?: number;
    error?: string;
  };
  if (!res.ok || !data.xdr || data.latestLedger == null) {
    throw new Error(data.error ?? "Transaction simulation failed");
  }
  return { xdr: data.xdr, latestLedger: data.latestLedger };
}

export async function sendTransactionViaApi(xdr: string): Promise<string> {
  const res = await fetch("/api/soroban/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xdr }),
  });
  const data = (await res.json()) as { hash?: string; error?: string };
  if (!res.ok || !data.hash) {
    throw new Error(data.error ?? "Transaction submit failed");
  }
  return data.hash;
}

export function isAccountNotFoundMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("account not found") ||
    lower.includes("could not find account")
  );
}
