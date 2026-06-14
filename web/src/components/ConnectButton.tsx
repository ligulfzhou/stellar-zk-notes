"use client";

import { useWalletStore } from "@/store/useWalletStore";

export function ConnectButton() {
  const { publicKey, connecting, connect } = useWalletStore();

  if (publicKey) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-200">
        {publicKey.slice(0, 8)}…{publicKey.slice(-8)}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void connect()}
      disabled={connecting}
      className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-60"
    >
      {connecting ? "Connecting…" : "Connect Freighter"}
    </button>
  );
}
