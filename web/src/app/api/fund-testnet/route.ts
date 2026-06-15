import { NextResponse } from "next/server";
import { formatError } from "@/lib/format-error";
import { STELLAR_NETWORK } from "@/lib/config";

const FRIENDBOT_URL = "https://friendbot.stellar.org";

export async function POST(request: Request) {
  if (STELLAR_NETWORK.toLowerCase() === "mainnet") {
    return NextResponse.json(
      { error: "Testnet funding is not available on mainnet" },
      { status: 400 }
    );
  }

  try {
    const body = (await request.json()) as { address?: string };
    const address = body.address?.trim();
    if (!address?.startsWith("G") || address.length !== 56) {
      return NextResponse.json(
        { error: "Valid Stellar G… address required" },
        { status: 400 }
      );
    }

    const url = `${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`;
    const response = await fetch(url, { method: "GET" });
    const text = await response.text();

    if (!response.ok) {
      // Friendbot returns 400 if the account already exists — treat as success.
      if (text.toLowerCase().includes("already funded")) {
        return NextResponse.json({ funded: true, alreadyExisted: true });
      }
      return NextResponse.json(
        { error: `Friendbot failed (${response.status}): ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ funded: true, alreadyExisted: false });
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error) || "Friendbot request failed" },
      { status: 500 }
    );
  }
}
