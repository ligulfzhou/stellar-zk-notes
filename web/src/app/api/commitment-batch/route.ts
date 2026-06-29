import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);
const script = path.join(process.cwd(), "..", "scripts", "compute_commitment.sh");

type BatchItem = {
  id: string;
  value: string;
  secret: string;
  nullifierSecret: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as { items?: BatchItem[] };
  const items = body.items ?? [];
  if (items.length === 0 || items.length > 64) {
    return NextResponse.json(
      { error: "items required (max 64)" },
      { status: 400 }
    );
  }

  try {
    const commitments: Record<string, string> = {};
    await Promise.all(
      items.map(async (item) => {
        const { stdout } = await execFileAsync(script, [
          item.value,
          item.secret,
          item.nullifierSecret,
        ]);
        commitments[item.id] = stdout.trim();
      })
    );
    return NextResponse.json({ commitments });
  } catch (error) {
    const message = error instanceof Error ? error.message : "batch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
