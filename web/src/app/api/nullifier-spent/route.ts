import { NextResponse } from "next/server";
import { formatError } from "@/lib/format-error";
import { isNullifierSpentOnChain as checkSpent } from "@/lib/vault-events";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      nullifierHex?: string;
      reader?: string;
    };
    if (!body.nullifierHex || !body.reader) {
      return NextResponse.json(
        { error: "nullifierHex and reader required" },
        { status: 400 }
      );
    }
    const spent = await checkSpent(body.nullifierHex, body.reader);
    return NextResponse.json({ spent });
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error) || "nullifier spent check failed" },
      { status: 500 }
    );
  }
}
