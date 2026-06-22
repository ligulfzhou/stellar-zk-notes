import { Account } from "@stellar/stellar-sdk";
import { STELLAR_NETWORK } from "./config";

type StellarAccountResponse = {
  exists?: boolean;
  accountId?: string;
  sequence?: string;
  nativeBalance?: string | null;
  error?: string;
};

export type StellarAccountInfo = {
  exists: boolean;
  accountId: string;
  sequence: string;
  nativeBalance: string | null;
};

const inflightLookups = new Map<string, Promise<StellarAccountInfo>>();

async function lookupStellarAccount(
  publicKey: string
): Promise<StellarAccountInfo> {
  const pending = inflightLookups.get(publicKey);
  if (pending) return pending;

  const promise = (async () => {
    const res = await fetch(
      `/api/stellar-account?address=${encodeURIComponent(publicKey)}`
    );
    const data = (await res.json()) as StellarAccountResponse;
    if (!res.ok) {
      throw new Error(data.error ?? "Account lookup failed");
    }
    return {
      exists: Boolean(data.exists),
      accountId: data.accountId ?? publicKey,
      sequence: data.sequence ?? "",
      nativeBalance: data.nativeBalance ?? null,
    };
  })().finally(() => {
    inflightLookups.delete(publicKey);
  });

  inflightLookups.set(publicKey, promise);
  return promise;
}

function accountNotFoundMessage(): string {
  if (STELLAR_NETWORK.toLowerCase() !== "mainnet") {
    return "Account not found on testnet — create and fund it at https://lab.stellar.org/account/create, then reconnect";
  }
  return "Account not found on network";
}

export async function fetchStellarAccountInfo(
  publicKey: string
): Promise<StellarAccountInfo> {
  return lookupStellarAccount(publicKey);
}

export async function fetchStellarAccount(publicKey: string): Promise<Account> {
  const info = await lookupStellarAccount(publicKey);
  if (!info.exists || !info.sequence) {
    throw new Error(accountNotFoundMessage());
  }
  return new Account(info.accountId, info.sequence);
}

export async function accountExistsViaApi(publicKey: string): Promise<boolean> {
  const info = await lookupStellarAccount(publicKey);
  return info.exists;
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
