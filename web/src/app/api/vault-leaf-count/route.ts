import { NextResponse } from "next/server";
import { formatError } from "@/lib/format-error";
import { getVaultLeafCount } from "@/server/soroban-vault";

export async function GET(request: Request) {
  const reader = new URL(request.url).searchParams.get("reader")?.trim();
  if (!reader?.startsWith("G") || reader.length !== 56) {
    return NextResponse.json(
      { error: "Valid Stellar G… reader address required" },
      { status: 400 }
    );
  }
  try {
    const leafCount = await getVaultLeafCount(reader);
    return NextResponse.json({ leafCount });
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error) || "leaf count failed" },
      { status: 500 }
    );
  }
}
