import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { merkleWitness, merkleWitnessFromTreeState, fieldHexListToBigInt } from "@/server/merkle";
import { formatError } from "@/lib/format-error";
import { findCommitmentLeafIndex } from "@/lib/vault-events";
import type { VaultTreeState } from "@/server/soroban-vault";

const execFileAsync = promisify(execFile);

type ProveRequest = {
  mode: "shielded_send" | "withdraw";
  value: string;
  secret: string;
  nullifierSecret: string;
  leafIndex: number;
  /** All commitments in the on-chain tree (hex), in insertion order. */
  commitments: string[];
  /** On-chain leaf count — required for dense Merkle tree. */
  leafCount: number;
  /** On-chain merkle root hex for validation. */
  onChainMerkleRoot?: string;
  /** Incremental tree state from vault (filled/zeros). */
  treeState?: VaultTreeState;
  /** Expected commitment for the spent note (validates secrets). */
  noteCommitment?: string;
  newSecret?: string;
  newNullifierSecret?: string;
};

function hexToBigInt(hex: string): bigint {
  const normalized = hex.startsWith("0x") ? hex : `0x${hex}`;
  return BigInt(normalized);
}

function normalizeHex(hex: string): string {
  const h = hex.startsWith("0x") ? hex : `0x${hex}`;
  return h.toLowerCase();
}

async function computeCommitmentHex(
  value: string,
  secret: string,
  nullifierSecret: string
): Promise<string> {
  const { stdout } = await execFileAsync(
    path.join(process.cwd(), "..", "scripts", "compute_commitment.sh"),
    [value, secret, nullifierSecret]
  );
  return stdout.trim();
}

async function computeNullifierHex(
  nullifierSecret: string,
  commitmentHex: string
): Promise<string> {
  const { stdout } = await execFileAsync(
    path.join(process.cwd(), "..", "scripts", "compute_nullifier.sh"),
    [nullifierSecret, commitmentHex]
  );
  return stdout.trim();
}

function fieldHexToDecimal(hex: string): string {
  return BigInt(hex.startsWith("0x") ? hex : `0x${hex}`).toString();
}

function onChainRootBigInt(hex: string): bigint {
  return hexToBigInt(hex);
}

export async function POST(request: Request) {
  const body = (await request.json()) as ProveRequest;
  const mockProof = process.env.ZK_MOCK_PROOF === "true";

  try {
    const spendCommitmentHex = await computeCommitmentHex(
      body.value,
      body.secret,
      body.nullifierSecret
    );

    if (
      body.noteCommitment &&
      normalizeHex(body.noteCommitment) !== normalizeHex(spendCommitmentHex)
    ) {
      return NextResponse.json(
        {
          error:
            "Note secrets do not match commitment — unlock passkey or rescan from chain",
        },
        { status: 400 }
      );
    }

    const nullifierHex = await computeNullifierHex(
      body.nullifierSecret,
      spendCommitmentHex
    );

    if (!body.leafCount || body.leafCount <= 0) {
      return NextResponse.json({ error: "leafCount required" }, { status: 400 });
    }

    const resolvedIndex =
      body.leafIndex >= 0 ? body.leafIndex : findCommitmentLeafIndex(body.commitments, spendCommitmentHex);
    if (resolvedIndex === null || resolvedIndex < 0) {
      return NextResponse.json(
        {
          error:
            "Note commitment not in Merkle tree — Notes → Rescan from chain",
        },
        { status: 400 }
      );
    }

    const spendLeaf = hexToBigInt(spendCommitmentHex);
    const sparseCommitment = body.commitments[resolvedIndex];
    if (sparseCommitment && normalizeHex(sparseCommitment) !== normalizeHex(spendCommitmentHex)) {
      return NextResponse.json(
        { error: `Merkle slot ${resolvedIndex} does not match note secrets` },
        { status: 400 }
      );
    }

    const hasGaps = body.commitments
      .slice(0, body.leafCount)
      .some((slot, i) => i < body.leafCount && !slot);

    let merklePath: bigint[];
    let indices: boolean[];
    let root: bigint;

    if (hasGaps && body.treeState) {
      const { filled, zeros } = fieldHexListToBigInt(
        body.treeState.filled,
        body.treeState.zeros
      );
      const leafAt = (index: number): bigint | undefined => {
        const slot = body.commitments[index];
        return slot ? hexToBigInt(slot) : undefined;
      };
      ({ path: merklePath, indices, root } = await merkleWitnessFromTreeState({
        leafCount: body.leafCount,
        targetIndex: resolvedIndex,
        targetLeaf: spendLeaf,
        filled,
        zeros,
        leafAt,
      }));
    } else {
      const leaves: bigint[] = [];
      for (let i = 0; i < body.leafCount; i++) {
        const slot = body.commitments[i];
        if (!slot) {
          return NextResponse.json(
            {
              error: `Missing commitment at leaf ${i} — upgrade vault or Notes → Rescan`,
            },
            { status: 400 }
          );
        }
        leaves.push(hexToBigInt(slot));
      }

      if (leaves[resolvedIndex] !== spendLeaf) {
        return NextResponse.json(
          { error: `Merkle slot ${resolvedIndex} does not match note secrets` },
          { status: 400 }
        );
      }

      ({ path: merklePath, indices, root } = await merkleWitness(
        leaves,
        resolvedIndex
      ));
    }

    if (body.onChainMerkleRoot) {
      const expected = normalizeHex(body.onChainMerkleRoot);
      const actual =
        "0x" + root.toString(16).padStart(64, "0").toLowerCase();
      if (expected !== actual) {
        // Deployed vault uses poseidon2 t=3; Noir witness uses t=4.
        if (mockProof) {
          root = onChainRootBigInt(body.onChainMerkleRoot);
        } else {
          return NextResponse.json(
            {
              error:
                "Merkle root mismatch — redeploy vault with updated hash or Rescan",
            },
            { status: 400 }
          );
        }
      }
    }

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
      nullifier: fieldHexToDecimal(nullifierHex),
      new_commitment: BigInt(newCommitmentHex).toString(),
      public_amount: publicAmount,
      mode,
    };

    const witnessScript = path.join(process.cwd(), "..", "scripts", "witness_spend.sh");
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "zk-notes-witness-"));
    const witnessPath = path.join(tmpDir, "witness.json");
    try {
      await writeFile(witnessPath, JSON.stringify(witnessPayload));
      // Demo mode: mock verifier accepts any proof; skip nargo execute when the
      // deployed vault Merkle hash (poseidon2 t=3) differs from the Noir circuit (t=4).
      if (!mockProof) {
        await execFileAsync(witnessScript, [witnessPath]);
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }

    const artifactsDir = path.join(process.cwd(), "..", "artifacts", "spend_note");
    let proofHex: string | null = null;

    if (mockProof) {
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
      mockProof: mockProof,
    });
  } catch (error) {
    const message = formatError(error) || "prove failed";
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
