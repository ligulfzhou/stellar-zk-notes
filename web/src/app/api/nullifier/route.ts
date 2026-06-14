import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

export async function POST(request: Request) {
  const body = (await request.json()) as {
    nullifierSecret?: string;
    commitment?: string;
  };
  if (!body.nullifierSecret || !body.commitment) {
    return NextResponse.json(
      { error: "nullifierSecret and commitment required" },
      { status: 400 }
    );
  }
  const script = path.join(process.cwd(), "..", "scripts", "compute_nullifier.sh");
  try {
    const { stdout } = await execFileAsync(script, [
      body.nullifierSecret,
      body.commitment,
    ]);
    return NextResponse.json({ nullifier: stdout.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "nullifier failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
