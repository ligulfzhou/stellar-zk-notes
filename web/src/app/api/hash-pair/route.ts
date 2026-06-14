import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

export async function POST(request: Request) {
  const body = (await request.json()) as { left?: string; right?: string };
  if (!body.left || !body.right) {
    return NextResponse.json({ error: "left and right required" }, { status: 400 });
  }
  const script = path.join(process.cwd(), "..", "scripts", "hash_pair.sh");
  try {
    const { stdout } = await execFileAsync(script, [body.left, body.right]);
    return NextResponse.json({ hash: stdout.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "hash failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
