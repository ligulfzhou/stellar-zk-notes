import { NextResponse } from "next/server";
import { computeNullifier } from "@/server/commitment";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    spendingSk?: string;
    value?: string;
    noteRandomness?: string;
  };

  if (!body.spendingSk || !body.value || !body.noteRandomness) {
    return NextResponse.json(
      { error: "spendingSk, value, and noteRandomness required" },
      { status: 400 }
    );
  }

  try {
    const nullifier = await computeNullifier({
      spendingSk: body.spendingSk,
      valueStroops: BigInt(body.value),
      noteRandomness: body.noteRandomness,
    });
    return NextResponse.json({ nullifier });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "nullifier failed" },
      { status: 500 }
    );
  }
}
