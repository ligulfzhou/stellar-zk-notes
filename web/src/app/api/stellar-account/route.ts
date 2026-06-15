import { NextResponse } from "next/server";
import { formatError } from "@/lib/format-error";
import {
  accountExistsOnChain,
  isAccountNotFoundError,
  loadStellarAccount,
} from "@/server/soroban-rpc";

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address")?.trim();
  if (!address?.startsWith("G") || address.length !== 56) {
    return NextResponse.json(
      { error: "Valid Stellar G… address required" },
      { status: 400 }
    );
  }

  try {
    const account = await loadStellarAccount(address);
    return NextResponse.json({
      exists: true,
      accountId: account.accountId(),
      sequence: account.sequenceNumber(),
    });
  } catch (err) {
    if (isAccountNotFoundError(err)) {
      return NextResponse.json({ exists: false });
    }
    return NextResponse.json(
      { error: formatError(err) || "Account lookup failed" },
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
