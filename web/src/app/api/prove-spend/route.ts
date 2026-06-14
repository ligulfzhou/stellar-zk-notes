import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { merkleWitness } from "@/server/merkle";

const execFileAsync = promisify(execFile);

type ProveRequest = {
  mode: "shielded_send" | "withdraw";
  value: string;
  secret: string;
  nullifierSecret: string;
  leafIndex: number;
  /** All commitments in the on-chain tree (hex), in insertion order. */
  commitments: string[];
  newSecret?: string;
  newNullifierSecret?: string;
  nullifierSecretForSend?: string;
};

function hexToBigInt(hex: string): bigint {
  return BigInt(hex.startsWith("0x") ? hex : `0x${hex}`);
}

export async function POST(request: Request) {
  const body = (await request.json()) as ProveRequest;

  try {
    const leaves = body.commitments.map(hexToBigInt);
    const { path: merklePath, indices, root } = await merkleWitness(
      leaves,
      body.leafIndex
    );

    const nullifierRes = await execFileAsync(
      path.join(process.cwd(), "..", "scripts", "compute_nullifier.sh"),
      [
        body.nullifierSecret,
        body.commitments[body.leafIndex],
      ]
    );
    const nullifierHex = nullifierRes.stdout.trim();

    let newValue = "0";
    let newSecret = "0";
    let newNullifierSecret = "0";
    let newCommitmentHex = "0x0";
    let publicAmount = "0";
    let mode = "0";

    if (body.mode === "shielded_send") {
      newValue = body.value;
      newSecret = body.newSecret ?? "";
      newNullifierSecret = body.newNullifierSecret ?? "";
      if (!newSecret || !newNullifierSecret) {
        return NextResponse.json(
          { error: "newSecret and newNullifierSecret required for send" },
          { status: 400 }
        );
      }
      const commitRes = await execFileAsync(
        path.join(process.cwd(), "..", "scripts", "compute_commitment.sh"),
        [newValue, newSecret, newNullifierSecret]
      );
      newCommitmentHex = commitRes.stdout.trim();
      mode = "0";
      publicAmount = "0";
    } else {
      publicAmount = body.value;
      mode = "1";
      newCommitmentHex = "0x0";
    }

    const witnessPayload = {
      value: body.value,
      secret: body.secret,
      nullifier_secret: body.nullifierSecret,
      merkle_path: merklePath.map((p) => p.toString()),
      path_indices: indices,
      new_value: newValue,
      new_secret: newSecret,
      new_nullifier_secret: newNullifierSecret,
      merkle_root: root.toString(),
      nullifier: BigInt(nullifierHex).toString(),
      new_commitment: BigInt(newCommitmentHex).toString(),
      public_amount: publicAmount,
      mode,
    };

    const witnessScript = path.join(process.cwd(), "..", "scripts", "witness_spend.sh");
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "zk-notes-witness-"));
    const witnessPath = path.join(tmpDir, "witness.json");
    try {
      await writeFile(witnessPath, JSON.stringify(witnessPayload));
      await execFileAsync(witnessScript, [witnessPath]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }

    const artifactsDir = path.join(process.cwd(), "..", "artifacts", "spend_note");
    let proofHex: string | null = null;

    if (process.env.ZK_MOCK_PROOF === "true") {
      proofHex = "0x" + "ab".repeat(32);
    } else if (await hasBarretenberg()) {
      await execFileAsync(path.join(process.cwd(), "..", "scripts", "prove.sh"), []);
      // proof bytes path depends on bb output — client reads from artifacts
      proofHex = "generated";
    }

    return NextResponse.json({
      merkleRoot: "0x" + root.toString(16).padStart(64, "0"),
      nullifier: nullifierHex,
      newCommitment: newCommitmentHex,
      publicInputs: {
        merkle_root: witnessPayload.merkle_root,
        nullifier: witnessPayload.nullifier,
        new_commitment: witnessPayload.new_commitment,
        public_amount: witnessPayload.public_amount,
        mode: witnessPayload.mode,
      },
      witnessReady: true,
      proofReady: proofHex !== null,
      proofHex,
      mockProof: process.env.ZK_MOCK_PROOF === "true",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "prove failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function hasBarretenberg(): Promise<boolean> {
  try {
    await execFileAsync("which", ["bb"]);
    return true;
  } catch {
    return false;
  }
}
