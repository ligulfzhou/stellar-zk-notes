import { NextResponse } from "next/server";
import { formatError } from "@/lib/format-error";
import { prepareTransactionXdr } from "@/server/soroban-rpc";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { xdr?: string };
    if (!body.xdr) {
      return NextResponse.json({ error: "xdr required" }, { status: 400 });
    }
    const prepared = await prepareTransactionXdr(body.xdr);
    return NextResponse.json(prepared);
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error) || "prepare failed" },
      { status: 500 }
    );
  }
}
