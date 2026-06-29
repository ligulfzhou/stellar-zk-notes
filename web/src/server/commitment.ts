import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptRoot = path.join(process.cwd(), "..", "scripts");

const DOMAIN_SPENDING_PK = "1";
const DOMAIN_NULLIFIER_KEY = "2";

async function executeNoirField(
  circuit: "note_hash" | "hash_pair",
  fields: Record<string, string>
): Promise<string> {
  const repoRoot = path.join(process.cwd(), "..");
  const circuitDir = path.join(repoRoot, "circuits", circuit);
  const proverToml = Object.entries(fields)
    .map(([k, v]) => `${k} = "${v}"`)
    .join("\n");
  const { writeFile, rm } = await import("node:fs/promises");
  const proverPath = path.join(circuitDir, "Prover.toml");
  await writeFile(proverPath, proverToml);
  try {
    const { stdout } = await execFileAsync("nargo", ["execute"], {
      cwd: circuitDir,
      env: { ...process.env, PATH: `${process.env.HOME}/.nargo/bin:${process.env.PATH}` },
    });
    const match = stdout.match(/Circuit output: (\d+)/);
    if (!match) throw new Error(`No output from ${circuit}`);
    return match[1]!;
  } finally {
    await rm(proverPath, { force: true });
  }
}

export async function deriveSpendingPk(spendingSk: string): Promise<string> {
  return executeNoirField("hash_pair", {
    left: spendingSk,
    right: DOMAIN_SPENDING_PK,
  });
}

async function deriveNullifierKey(spendingSk: string): Promise<string> {
  return executeNoirField("hash_pair", {
    left: spendingSk,
    right: DOMAIN_NULLIFIER_KEY,
  });
}

export async function computeCommitment(params: {
  valueStroops: bigint;
  noteRandomness: string;
  spendingPk: string;
}): Promise<string> {
  const hex = await executeNoirField("note_hash", {
    value: params.valueStroops.toString(),
    note_randomness: params.noteRandomness,
    spending_pk: params.spendingPk,
  });
  return "0x" + BigInt(hex).toString(16).padStart(64, "0");
}

export async function computeNullifier(params: {
  spendingSk: string;
  valueStroops: bigint;
  noteRandomness: string;
}): Promise<string> {
  const spendingPk = await deriveSpendingPk(params.spendingSk);
  const commitmentDec = await executeNoirField("note_hash", {
    value: params.valueStroops.toString(),
    note_randomness: params.noteRandomness,
    spending_pk: spendingPk,
  });
  const nk = await deriveNullifierKey(params.spendingSk);
  const nullifierDec = await executeNoirField("hash_pair", {
    left: nk,
    right: commitmentDec,
  });
  return "0x" + BigInt(nullifierDec).toString(16).padStart(64, "0");
}
