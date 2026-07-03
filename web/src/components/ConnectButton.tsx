"use client";

import { useWalletStore } from "@/store/useWalletStore";

export function ConnectButton() {
  const { publicKey, connecting, connect, error, setTab } = useWalletStore();

  if (publicKey) {
    return (
      <button
        type="button"
        onClick={() => setTab("notes")}
        className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-200 transition hover:bg-emerald-500/20"
        title="Wallet account — open Notes"
      >
        {publicKey.slice(0, 8)}…{publicKey.slice(-8)}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void connect()}
        disabled={connecting}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-60"
      >
        {connecting ? "Opening…" : "Open wallet"}
      </button>
      {error ? <p className="max-w-xs text-right text-xs text-red-300">{error}</p> : null}
      <p className="max-w-xs text-right text-[10px] text-zinc-500">
        Local wallet — create or unlock in Notes
      </p>
    </div>
  );
}
