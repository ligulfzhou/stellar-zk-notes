import { POOLS, poolById } from "./pool-config";

/** One join transaction (single fixed-denomination note). */
export type JoinSlot = {
  poolId: number;
  label: string;
  stroops: bigint;
};

export type JoinDecomposition = {
  totalXlm: number;
  slots: JoinSlot[];
  summary: Array<{ poolId: number; label: string; count: number }>;
};

const DENOMS = [
  { xlm: 100, poolId: 2 },
  { xlm: 10, poolId: 1 },
  { xlm: 1, poolId: 0 },
] as const;

export const MAX_BATCH_JOIN_SLOTS = 50;

export function parseJoinAmountXlm(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const xlm = Number(trimmed);
  if (!Number.isFinite(xlm) || xlm <= 0 || !Number.isInteger(xlm)) {
    return null;
  }
  return xlm;
}

export function decomposeJoinAmount(xlmWhole: number): JoinDecomposition | { error: string } {
  if (!Number.isInteger(xlmWhole) || xlmWhole <= 0) {
    return { error: "Enter a positive whole number of XLM" };
  }

  let remainder = xlmWhole;
  const summary: JoinDecomposition["summary"] = [];
  const slots: JoinSlot[] = [];

  for (const { xlm, poolId } of DENOMS) {
    const count = Math.floor(remainder / xlm);
    if (count === 0) continue;
    const pool = poolById(poolId);
    summary.push({ poolId, label: pool.label, count });
    for (let i = 0; i < count; i++) {
      slots.push({ poolId, label: pool.label, stroops: pool.stroops });
    }
    remainder -= count * xlm;
  }

  if (slots.length === 0) {
    return { error: "Amount must be at least 1 XLM" };
  }
  if (slots.length > MAX_BATCH_JOIN_SLOTS) {
    return {
      error: `Too many notes (${slots.length}) — max ${MAX_BATCH_JOIN_SLOTS} deposits per batch`,
    };
  }

  return { totalXlm: xlmWhole, slots, summary };
}

export function formatJoinSummary(decomposition: JoinDecomposition): string {
  const parts = decomposition.summary.map((s) => `${s.count}×${s.label}`);
  const txCount = decomposition.slots.length;
  return `${decomposition.totalXlm} XLM = ${parts.join(" + ")} (${txCount} note${txCount === 1 ? "" : "s"}, ${txCount} tx${txCount === 1 ? "" : "s"})`;
}
