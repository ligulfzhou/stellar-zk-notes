import { isMockProofClient } from "./proof-config";
import {
  mockProofHex,
  PROOF_BYTES,
  proveSpendInBrowser,
  type ProveOptions,
  type ProveProgressCallback,
} from "./prover-client";
import type { TransferWitnessPayload } from "./action-witness";

export type ProveSpendResult = {
  merkleRoot: string;
  nullifierHexes: string[];
  newCommitmentHexes: string[];
  publicInputs: Record<string, string | string[]>;
  proofHex: string | null;
  proofReady: boolean;
  mockProof: boolean;
  provedLocally: boolean;
};

function fieldDecToHex(value: string): string {
  if (value === "0") return "0x0";
  return "0x" + BigInt(value).toString(16).padStart(64, "0");
}

function resultFromWitness(
  witness: TransferWitnessPayload,
  proofHex: string,
  mockProof: boolean,
  provedLocally: boolean
): ProveSpendResult {
  return {
    merkleRoot: fieldDecToHex(witness.merkle_root),
    nullifierHexes: witness.nullifier.map(fieldDecToHex),
    newCommitmentHexes: witness.new_commitment.map(fieldDecToHex),
    publicInputs: {
      merkle_root: witness.merkle_root,
      nullifier: witness.nullifier,
      new_commitment: witness.new_commitment,
      public_amount: witness.public_amount,
    },
    proofHex,
    proofReady: true,
    mockProof,
    provedLocally,
  };
}

async function proveWitnessOnServer(
  witness: TransferWitnessPayload
): Promise<ProveSpendResult> {
  const res = await fetch("/api/prove-witness", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ witness }),
  });
  const data = (await res.json()) as ProveSpendResult & { error?: string };
  if (!res.ok || !data.merkleRoot || !data.publicInputs) {
    throw new Error(data.error ?? "Prove witness failed");
  }
  if (!isMockProofClient() && (!data.proofHex || !data.proofReady)) {
    throw new Error(
      data.error ??
        "Server could not generate Real ZK proof (install bb: ./scripts/install_zk_tools.sh). Browser proving is preferred."
    );
  }
  return { ...data, provedLocally: false };
}

export async function proveWitness(
  witness: TransferWitnessPayload,
  _meta?: Record<string, unknown>,
  onProgress?: ProveProgressCallback,
  options?: ProveOptions
): Promise<ProveSpendResult> {
  const signal = options?.signal;
  const mockProof = isMockProofClient();

  if (mockProof) {
    return resultFromWitness(witness, mockProofHex(), true, true);
  }

  if (typeof window !== "undefined") {
    try {
      const proofHex = await proveSpendInBrowser(witness, onProgress, signal);
      if (proofHex.length !== 2 + PROOF_BYTES * 2) {
        throw new Error(`Browser returned invalid proof length`);
      }
      return resultFromWitness(witness, proofHex, false, true);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      console.warn("Browser prove failed, falling back to server:", error);
      onProgress?.("proving", "Falling back to server prover…");
      try {
        return await proveWitnessOnServer(witness);
      } catch (serverErr) {
        throw new Error(
          `Browser ZK proof failed (${detail}). Server fallback also failed: ${serverErr instanceof Error ? serverErr.message : serverErr}`
        );
      }
    }
  }

  return proveWitnessOnServer(witness);
}
