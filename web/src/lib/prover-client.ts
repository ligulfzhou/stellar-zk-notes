import type { InputMap } from "@noir-lang/noirc_abi";
import type { TransferWitnessPayload } from "./action-witness";

export const PROOF_BYTES = 456 * 32;

export type ProvePhase =
  | "init"
  | "witness"
  | "proving"
  | "verify"
  | "done";

export type ProveProgressCallback = (phase: ProvePhase, detail?: string) => void;

export type ProveOptions = {
  signal?: AbortSignal;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Proof generation cancelled", "AbortError");
  }
}


function witnessToNoirInputs(witness: TransferWitnessPayload): InputMap {
  return {
    spend_value: witness.spend_value,
    spend_secret: witness.spend_secret,
    spend_nullifier_secret: witness.spend_nullifier_secret,
    spend_merkle_path: witness.spend_merkle_path,
    spend_path_indices: witness.spend_path_indices,
    out_value: witness.out_value,
    out_secret: witness.out_secret,
    out_nullifier_secret: witness.out_nullifier_secret,
    merkle_root: witness.merkle_root,
    nullifier: witness.nullifier,
    new_commitment: witness.new_commitment,
    public_amount: witness.public_amount,
  };
}

function proofToHex(proof: Uint8Array): string {
  if (proof.length !== PROOF_BYTES) {
    throw new Error(`Invalid proof size ${proof.length} (expected ${PROOF_BYTES})`);
  }
  let hex = "";
  for (let i = 0; i < proof.length; i++) {
    hex += proof[i]!.toString(16).padStart(2, "0");
  }
  return "0x" + hex;
}

/** Generate UltraHonk proof in the browser (secrets never leave the device). */
export async function proveSpendInBrowser(
  witness: TransferWitnessPayload,
  onProgress?: ProveProgressCallback,
  signal?: AbortSignal
): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("Browser proving requires a client environment");
  }

  throwIfAborted(signal);
  onProgress?.("init", "Loading prover…");
  const [{ Noir }, { UltraHonkBackend }] = await Promise.all([
    import("@noir-lang/noir_js"),
    import("@aztec/bb.js"),
  ]);
  const { loadSpendCircuit, ensureBrowserWasm } = await import("./noir-runtime");
  await ensureBrowserWasm();

  throwIfAborted(signal);
  onProgress?.("witness", "Executing circuit…");
  const circuit = await loadSpendCircuit();
  const noir = new Noir(circuit);
  const { witness: compressedWitness } = await noir.execute(
    witnessToNoirInputs(witness)
  );

  throwIfAborted(signal);
  onProgress?.("proving", "Generating UltraHonk proof (may take 10–60s)…");
  const backend = new UltraHonkBackend(circuit.bytecode, { threads: 1 });
  try {
    const { proof, publicInputs } = await backend.generateProof(compressedWitness, {
      keccak: true,
    });

    throwIfAborted(signal);
    onProgress?.("verify", "Verifying proof locally…");
    const valid = await backend.verifyProof({ proof, publicInputs }, { keccak: true });
    if (!valid) {
      throw new Error("Local proof verification failed");
    }

    onProgress?.("done");
    return proofToHex(proof);
  } finally {
    await backend.destroy();
  }
}

export function mockProofHex(): string {
  return "0x" + "ab".repeat(32);
}
