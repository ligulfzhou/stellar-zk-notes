/** Production builds must not use mock ZK proofs. */
export function isMockProofEnabled(): boolean {
  return process.env.ZK_MOCK_PROOF === "true";
}

/** Client-visible mock flag (mirrors ZK_MOCK_PROOF for browser proving). */
export function isMockProofClient(): boolean {
  return process.env.NEXT_PUBLIC_ZK_MOCK_PROOF === "true";
}

export function assertMockProofAllowed(): void {
  if (process.env.NODE_ENV === "production" && isMockProofEnabled()) {
    throw new Error(
      "ZK_MOCK_PROOF=true is forbidden when NODE_ENV=production. Deploy UltraHonk verifier and set ZK_MOCK_PROOF=false."
    );
  }
}

export function proofModeLabelClient(): "mock" | "real" {
  return isMockProofClient() ? "mock" : "real";
}
