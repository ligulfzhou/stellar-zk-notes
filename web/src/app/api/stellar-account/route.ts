import { Account } from "@stellar/stellar-sdk";
import { NextResponse } from "next/server";
import { formatError } from "@/lib/format-error";
import { HORIZON_URL, STELLAR_NETWORK } from "@/lib/config";
import {
  accountExistsOnChain,
  isAccountNotFoundError,
  loadStellarAccount,
} from "@/server/soroban-rpc";

const FETCH_TIMEOUT_MS = 12_000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function fetchNativeBalance(publicKey: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${HORIZON_URL}/accounts/${publicKey}`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      balances?: Array<{ asset_type?: string; balance?: string }>;
    };
    const native = data.balances?.find((b) => b.asset_type === "native");
    return native?.balance ?? null;
  } catch {
    return null;
  }
}

async function loadAccountFromHorizon(publicKey: string): Promise<Account> {
  const res = await fetchWithTimeout(`${HORIZON_URL}/accounts/${publicKey}`);
  if (res.status === 404) {
    throw new Error("Account not found");
  }
  if (!res.ok) {
    throw new Error(`Horizon HTTP ${res.status}`);
  }
  const data = (await res.json()) as { id?: string; sequence?: string };
  if (!data.id || !data.sequence) {
    throw new Error("Invalid Horizon account response");
  }
  return new Account(data.id, data.sequence);
}

async function resolveAccount(publicKey: string): Promise<Account> {
  try {
    return await loadStellarAccount(publicKey);
  } catch (err) {
    if (isAccountNotFoundError(err)) throw err;
    // Soroban RPC can fail when bundled in dev — fall back to Horizon for sequence.
    return loadAccountFromHorizon(publicKey);
  }
}

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address")?.trim();
  if (!address?.startsWith("G") || address.length !== 56) {
    return NextResponse.json(
      { error: "Valid Stellar G… address required" },
      { status: 400 }
    );
  }

  try {
    const account = await resolveAccount(address);
    const nativeBalance = await fetchNativeBalance(address);
    return NextResponse.json({
      exists: true,
      accountId: account.accountId(),
      sequence: account.sequenceNumber(),
      nativeBalance,
      network: STELLAR_NETWORK,
    });
  } catch (err) {
    if (isAccountNotFoundError(err)) {
      return NextResponse.json({ exists: false });
    }
    const message = formatError(err) || "Account lookup failed";
    const hint =
      message.includes("fetch failed") || message.includes("Timeout")
        ? "Check network access to Soroban RPC / Horizon, or set NEXT_PUBLIC_SOROBAN_RPC_URL and HORIZON_URL in web/.env.local"
        : undefined;
    return NextResponse.json(
      { error: hint ? `${message} — ${hint}` : message },
      { status: 500 }
    );
  }
}

export async function HEAD(request: Request) {
  const address = new URL(request.url).searchParams.get("address")?.trim();
  if (!address) {
    return new NextResponse(null, { status: 400 });
  }
  const exists = await accountExistsOnChain(address).catch(() => false);
  return new NextResponse(null, { status: exists ? 200 : 404 });
}
