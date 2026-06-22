"use client";

import { MIN_POOL_SIZE_TESTNET } from "@/lib/pool-config";

export type PrivacyStrength = "unknown" | "weak" | "medium" | "strong";

export function privacyStrength(poolLeafCount: number | null): PrivacyStrength {
  if (poolLeafCount === null) return "unknown";
  if (poolLeafCount < 10) return "weak";
  if (poolLeafCount < 100) return "medium";
  return "strong";
}

const STYLES: Record<
  Exclude<PrivacyStrength, "unknown">,
  { label: string; className: string }
> = {
  weak: {
    label: "Weak privacy",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  },
  medium: {
    label: "Medium privacy",
    className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-100",
  },
  strong: {
    label: "Strong privacy",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  },
};

export function PrivacyBadge({
  poolLeafCount,
  poolLabel,
}: {
  poolLeafCount: number | null;
  poolLabel?: string;
}) {
  const strength = privacyStrength(poolLeafCount);
  if (strength === "unknown") {
    return (
      <span className="inline-flex items-center rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-zinc-400">
        Pool size unknown
      </span>
    );
  }

  const style = STYLES[strength];
  const countLabel =
    poolLeafCount === null
      ? "—"
      : `${poolLeafCount} note${poolLeafCount === 1 ? "" : "s"}`;

  return (
    <span
      className={`inline-flex flex-wrap items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${style.className}`}
      title={
        strength === "weak"
          ? `Need ${MIN_POOL_SIZE_TESTNET}+ notes to spend; 10+ recommended`
          : strength === "medium"
            ? "100+ notes recommended before claiming strong anonymity"
            : "Large anonymity set for this pool"
      }
    >
      <span className="font-medium">{style.label}</span>
      <span className="opacity-80">
        · {poolLabel ? `${poolLabel}: ` : ""}
        {countLabel}
      </span>
    </span>
  );
}
