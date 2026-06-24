import { PROOF_BYTES } from "./prover-client";

/** Mock proof bytes for demo with MockVerifier on testnet. */
export function mockProofBytes(): Uint8Array {
  return new Uint8Array(32).fill(0xab);
}

export function isMockProofBytes(bytes: Uint8Array): boolean {
  return bytes.length === 32 && bytes.every((b) => b === 0xab);
}

export function proofBytesFromHex(hex: string | null | undefined): Uint8Array {
  if (!hex || hex === "generated") {
    throw new Error(
      "Missing ZK proof. Browser proving may have failed — check the console, run `cd web && npm run sync:circuits`, and restart the dev server."
    );
  }
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  if (bytes.length === 0) {
    throw new Error("Empty proof hex");
  }
  if (bytes.length !== PROOF_BYTES) {
    if (isMockProofBytes(bytes)) {
      throw new Error(
        "Mock proof cannot be used with Real ZK verifier. Set NEXT_PUBLIC_ZK_MOCK_PROOF=true only with MockVerifier deploy, or fix browser proving (sync circuits + restart dev server)."
      );
    }
    throw new Error(
      `Invalid proof size ${bytes.length} bytes (expected ${PROOF_BYTES}). Regenerate proof or redeploy verifier VK.`
    );
  }
  return bytes;
}
