import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { formatError } from "@/lib/format-error";
import { assertMockProofAllowed, isMockProofEnabled } from "@/lib/proof-config";
import type { TransferWitnessPayload } from "@/lib/action-witness";

const execFileAsync = promisify(execFile);
const PROOF_BYTES = 456 * 32;

function fieldDecToHex(value: string): string {
  if (value === "0") return "0x0";
  return "0x" + BigInt(value).toString(16).padStart(64, "0");
}

async function hasBarretenberg(): Promise<boolean> {
  try {
    await execFileAsync("which", ["bb"]);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    assertMockProofAllowed();
  } catch (error) {
    return NextResponse.json({ error: formatError(error) }, { status: 503 });
  }

  const body = (await request.json()) as { witness?: TransferWitnessPayload };
  const witness = body.witness;
  if (!witness?.merkle_root || !witness.nullifier?.length) {
    return NextResponse.json({ error: "witness object required" }, { status: 400 });
  }

  const mockProof = isMockProofEnabled();

  try {
    const repoRoot = path.join(process.cwd(), "..");
    const proveScript = path.join(repoRoot, "scripts", "prove_from_witness.sh");
    const proofFile = path.join(repoRoot, "artifacts", "transfer_actions", "proof");
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "zk-notes-witness-"));
    const witnessPath = path.join(tmpDir, "witness.json");
    let proofHex: string | null = null;

    try {
      await writeFile(witnessPath, JSON.stringify(witness));
      if (mockProof) {
        proofHex = "0x" + "ab".repeat(32);
      } else if (await hasBarretenberg()) {
        await execFileAsync(proveScript, [witnessPath], {
          env: {
            ...process.env,
            PATH: `${process.env.HOME}/.bb/bin:${process.env.HOME}/.nargo/bin:${process.env.PATH}`,
          },
          maxBuffer: 32 * 1024 * 1024,
        });
        const proofBuf = await readFile(proofFile);
        if (proofBuf.length !== PROOF_BYTES) {
          throw new Error(
            `Invalid proof size ${proofBuf.length} (expected ${PROOF_BYTES})`
          );
        }
        proofHex = "0x" + proofBuf.toString("hex");
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }

    const merkleRootHex = fieldDecToHex(witness.merkle_root);
    const nullifierHexes = witness.nullifier.map(fieldDecToHex);
    const newCommitmentHexes = witness.new_commitment.map(fieldDecToHex);

    return NextResponse.json({
      merkleRoot: merkleRootHex,
      nullifierHexes,
      newCommitmentHexes,
      publicInputs: {
        merkle_root: witness.merkle_root,
        nullifier: witness.nullifier,
        new_commitment: witness.new_commitment,
        public_amount: witness.public_amount,
      },
      witnessReady: true,
      proofReady: proofHex !== null,
      proofHex,
      mockProof,
    });
  } catch (error) {
    return NextResponse.json(
      { error: formatError(error) || "prove witness failed" },
      { status: 500 }
    );
  }
}
