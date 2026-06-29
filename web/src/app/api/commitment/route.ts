import { NextResponse } from "next/server";
import { computeCommitment } from "@/server/commitment";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    value?: string;
    noteRandomness?: string;
    spendingPk?: string;
  };

  const { value, noteRandomness, spendingPk } = body;
  if (!value || !noteRandomness || !spendingPk) {
    return NextResponse.json(
      { error: "value, noteRandomness, and spendingPk are required" },
      { status: 400 }
    );
  }

  try {
    const commitment = await computeCommitment({
      valueStroops: BigInt(value),
      noteRandomness,
      spendingPk,
    });
    return NextResponse.json({ commitment });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "commitment failed" },
      { status: 500 }
    );
  }
}
