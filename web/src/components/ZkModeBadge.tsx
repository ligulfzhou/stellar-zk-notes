"use client";

import { proofModeLabelClient } from "@/lib/proof-config";

export function ZkModeBadge() {
  const mode = proofModeLabelClient();
  const real = mode === "real";
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
        real
          ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
          : "bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/30"
      }`}
      title={
        real
          ? "UltraHonk proofs generated in your browser"
          : "Demo mode — mock 32-byte proofs"
      }
    >
      ZK {mode}
    </span>
  );
}
