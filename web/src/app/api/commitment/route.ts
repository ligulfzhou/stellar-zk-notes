import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

export async function POST(request: Request) {
  const body = (await request.json()) as {
    value?: string;
    secret?: string;
    nullifierSecret?: string;
  };

  const { value, secret, nullifierSecret } = body;
  if (!value || !secret || !nullifierSecret) {
    return NextResponse.json(
      { error: "value, secret, and nullifierSecret are required" },
      { status: 400 }
    );
  }

  const script = path.join(process.cwd(), "..", "scripts", "compute_commitment.sh");

  try {
    const { stdout } = await execFileAsync(script, [
      value,
      secret,
      nullifierSecret,
    ]);
    const commitment = stdout.trim();
    if (!commitment.startsWith("0x")) {
      return NextResponse.json(
        { error: "Failed to compute commitment", detail: stdout },
        { status: 500 }
      );
    }
    return NextResponse.json({ commitment });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
