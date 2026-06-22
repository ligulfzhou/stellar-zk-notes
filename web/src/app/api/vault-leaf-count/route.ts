import { NextResponse } from "next/server";
import { formatError } from "@/lib/format-error";
import { getVaultLeafCount } from "@/server/soroban-vault";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const reader = url.searchParams.get("reader")?.trim();
  const poolId = Number(url.searchParams.get("poolId") ?? "0");
  if (!reader?.startsWith("G") || reader.length !== 56) {
    return NextResponse.json(
      { error: "Valid Stellar G… reader address required" },
      { status: 400 }
    );
  }
  if (!Number.isInteger(poolId) || poolId < 0 || poolId > 2) {
    return NextResponse.json({ error: "poolId must be 0, 1, or 2" }, { status: 400 });
  }
  try {
    const leafCount = await getVaultLeafCount(reader, poolId);
    return NextResponse.json({ leafCount, poolId });
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error) || "leaf count failed" },
      { status: 500 }
    );
  }
}
