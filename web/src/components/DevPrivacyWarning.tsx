"use client";

import { PRIVACY_MODE } from "@/lib/config";
import { usesDirectSubmit } from "@/lib/stellar";

export function DevPrivacyWarning() {
  if (PRIVACY_MODE !== "dev" || !usesDirectSubmit()) return null;

  return (
    <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
      <strong>Dev privacy mode:</strong> transactions submit directly from your wallet
      (your G… address is visible on-chain). Set{" "}
      <code className="text-amber-50">NEXT_PUBLIC_PRIVACY_MODE=strict</code> and{" "}
      <code className="text-amber-50">NEXT_PUBLIC_RELAYER_URL</code> for relayer
      submission.
    </div>
  );
}
