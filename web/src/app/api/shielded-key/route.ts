import { NextResponse } from "next/server";
import { formatError } from "@/lib/format-error";
import { getVaultShieldedKey } from "@/server/soroban-vault";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const owner = params.get("owner")?.trim();
  const reader = params.get("reader")?.trim();

  if (!owner?.startsWith("G") || owner.length !== 56) {
    return NextResponse.json(
      { error: "Valid Stellar G… owner address required" },
      { status: 400 }
    );
  }
  if (!reader?.startsWith("G") || reader.length !== 56) {
    return NextResponse.json(
      { error: "Valid Stellar G… reader address required" },
      { status: 400 }
    );
  }

  try {
    const receivePubkeyHex = await getVaultShieldedKey(reader, owner);
    return NextResponse.json({ receivePubkeyHex });
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error) || "shielded key lookup failed" },
      { status: 500 }
    );
  }
}
