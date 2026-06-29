import { NextResponse } from "next/server";
import { formatError } from "@/lib/format-error";
import { sendTransactionXdrOnChain } from "@/server/soroban-rpc";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { xdr?: string };
    if (!body.xdr) {
      return NextResponse.json({ error: "xdr required" }, { status: 400 });
    }
    const hash = await sendTransactionXdrOnChain(body.xdr);
    return NextResponse.json({ hash });
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error) || "send failed" },
      { status: 500 }
    );
  }
}
