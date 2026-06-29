import type { Note } from "./note-types";

export type SelectableNote = Pick<Note, "id" | "value" | "status">;

export function selectNotesForAmount(
  notes: SelectableNote[],
  target: bigint
): { inputs: SelectableNote[]; change: bigint } {
  const unspent = notes
    .filter((n) => n.status === "unspent")
    .sort((a, b) => (a.value > b.value ? -1 : a.value < b.value ? 1 : 0));

  const exact = unspent.find((n) => n.value === target);
  if (exact) {
    return { inputs: [exact], change: 0n };
  }

  let sum = 0n;
  const picked: SelectableNote[] = [];
  for (const note of unspent) {
    if (sum >= target) break;
    picked.push(note);
    sum += note.value;
  }

  if (sum < target) {
    throw new Error("Insufficient shielded balance");
  }

  return { inputs: picked, change: sum - target };
}

export function computeChange(
  inputs: SelectableNote[],
  outputsTotal: bigint
): bigint {
  const sum = inputs.reduce((acc, n) => acc + n.value, 0n);
  if (sum < outputsTotal) {
    throw new Error("Inputs do not cover outputs");
  }
  return sum - outputsTotal;
}
