import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "./config.ts";

const execFileAsync = promisify(execFile);

function script(name: string): string {
  return path.join(config.repoRoot, "scripts", name);
}

export async function computeCommitmentHex(
  value: string,
  secret: string,
  nullifierSecret: string
): Promise<string> {
  const { stdout } = await execFileAsync(script("compute_commitment.sh"), [
    value,
    secret,
    nullifierSecret,
  ]);
  return stdout.trim();
}

export async function computeNullifierHex(
  nullifierSecret: string,
  commitmentHex: string
): Promise<string> {
  const { stdout } = await execFileAsync(script("compute_nullifier.sh"), [
    nullifierSecret,
    commitmentHex,
  ]);
  return stdout.trim();
}

/** Deterministic test root seed (not passkey — stable across runs). */
export function e2eRootSeed(): Uint8Array {
  const bytes = new Uint8Array(32);
  const label = "zk-notes-e2e-test-root-v1";
  for (let i = 0; i < 32; i++) {
    bytes[i] = label.charCodeAt(i % label.length) ^ i;
  }
  return bytes;
}
