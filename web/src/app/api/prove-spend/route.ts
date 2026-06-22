import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { merkleWitness, merkleWitnessFromTreeState, fieldHexListToBigInt } from "@/server/merkle";
import { formatError } from "@/lib/format-error";
import { findCommitmentLeafIndex } from "@/lib/vault-events";
import { assertMockProofAllowed, isMockProofEnabled } from "@/lib/proof-config";
import type { VaultTreeState } from "@/server/soroban-vault";

const execFileAsync = promisify(execFile);
const PROOF_BYTES = 456 * 32;

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

export async function POST(request: Request) {
  try {
    assertMockProofAllowed();
  } catch (error) {
    return NextResponse.json({ error: formatError(error) }, { status: 503 });
  }

  const body = (await request.json()) as ProveRequest;
  const mockProof = isMockProofEnabled();

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
        return NextResponse.json(
          {
            error:
              "Merkle root mismatch — Rescan from chain or retry after sync",
          },
          { status: 400 }
        );
      }
    }

    let newCommitmentHex = "0x0";
    let publicAmount = "0";
    let newSecret = "0";
    let newNullifierSecret = "0";

    if (body.mode === "shielded_send") {
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
        [body.value, newSecret, newNullifierSecret]
      );
      newCommitmentHex = commitRes.stdout.trim();
      publicAmount = "0";
    } else {
      publicAmount = body.value;
    }

    const pad4 = <T,>(values: T[], fill: T) => {
      const out = [...values];
      while (out.length < 4) out.push(fill);
      return out.slice(0, 4);
    };

    const emptyPath = Array(16).fill("0");
    const emptyIdx = Array(16).fill(false);

    const witnessPayload = {
      spend_value: pad4([body.value], "0"),
      spend_secret: pad4([body.secret], "0"),
      spend_nullifier_secret: pad4([body.nullifierSecret], "0"),
      spend_merkle_path: [merklePath.map((p) => p.toString()), emptyPath, emptyPath, emptyPath],
      spend_path_indices: [indices, emptyIdx, emptyIdx, emptyIdx],
      out_value: pad4(body.mode === "shielded_send" ? [body.value] : [], "0"),
      out_secret: pad4(body.mode === "shielded_send" ? [newSecret] : [], "0"),
      out_nullifier_secret: pad4(body.mode === "shielded_send" ? [newNullifierSecret] : [], "0"),
      merkle_root: root.toString(),
      nullifier: pad4([fieldHexToDecimal(nullifierHex)], "0"),
      new_commitment: pad4(
        body.mode === "shielded_send" ? [BigInt(newCommitmentHex).toString()] : [],
        "0"
      ),
      public_amount: publicAmount,
    };

    const repoRoot = path.join(process.cwd(), "..");
    const proveScript = path.join(repoRoot, "scripts", "prove_from_witness.sh");
    const proofFile = path.join(repoRoot, "artifacts", "transfer_actions", "proof");
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "zk-notes-witness-"));
    const witnessPath = path.join(tmpDir, "witness.json");
    let proofHex: string | null = null;

    try {
      await writeFile(witnessPath, JSON.stringify(witnessPayload));
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
      } else {
        return NextResponse.json(
          { error: "Barretenberg (bb) required for real proofs" },
          { status: 503 }
        );
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }

    const nullifierHexes = pad4([nullifierHex], "0x0");
    const newCommitmentHexes = pad4(
      body.mode === "shielded_send" ? [newCommitmentHex] : [],
      "0x0"
    );

    return NextResponse.json({
      merkleRoot: "0x" + root.toString(16).padStart(64, "0"),
      nullifier: nullifierHex,
      nullifierHexes,
      newCommitment: newCommitmentHex,
      newCommitmentHexes,
      publicInputs: {
        merkle_root: witnessPayload.merkle_root,
        nullifier: witnessPayload.nullifier,
        new_commitment: witnessPayload.new_commitment,
        public_amount: witnessPayload.public_amount,
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
