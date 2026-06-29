import type { ProvePhase } from "@/lib/prover-client";

const PHASE_LABELS: Record<ProvePhase, string> = {
  init: "Loading prover WASM…",
  witness: "Executing circuit…",
  proving: "Generating UltraHonk proof…",
  verify: "Verifying proof locally…",
  done: "Proof ready",
};

type Props = {
  phase: ProvePhase | null;
  detail?: string | null;
  onCancel?: () => void;
};

export function ProveProgress({ phase, detail, onCancel }: Props) {
  if (!phase) return null;

  const label = detail ?? (phase in PHASE_LABELS ? PHASE_LABELS[phase] : phase);
  const isLongRunning = phase === "proving";
  const canCancel = onCancel && phase !== "done";

  return (
    <div className="mt-3 flex items-start gap-3 rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2">
      <span
        className={`mt-0.5 inline-block h-3 w-3 shrink-0 rounded-full border-2 border-violet-400 border-t-transparent ${
          isLongRunning ? "animate-spin" : ""
        }`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-violet-200">{label}</p>
        {isLongRunning ? (
          <p className="mt-1 text-xs text-zinc-500">
            Proving runs locally in your browser — secrets never leave this device.
            This may take 10–60 seconds. Cancel stops before submit (WASM may finish in background).
          </p>
        ) : null}
      </div>
      {canCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 text-xs text-zinc-400 hover:text-zinc-200"
        >
          Cancel
        </button>
      ) : null}
    </div>
  );
}
