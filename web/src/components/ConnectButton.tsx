"use client";

import { useEffect } from "react";
import {
  initWalletsKit,
  openWalletProfile,
  subscribeWalletAddress,
} from "@/lib/wallet";
import { useWalletStore } from "@/store/useWalletStore";

export function ConnectButton() {
  const { publicKey, connecting, connect } = useWalletStore();

  useEffect(() => {
    initWalletsKit();
    return subscribeWalletAddress((address) => {
      void useWalletStore.getState().onAccountChange(address ?? null);
    });
  }, []);

  if (publicKey) {
    return (
      <button
        type="button"
        onClick={() => void openWalletProfile()}
        className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-200 transition hover:bg-emerald-500/20"
        title="Wallet account"
      >
        {publicKey.slice(0, 8)}…{publicKey.slice(-8)}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void connect()}
      disabled={connecting}
      className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-60"
    >
      {connecting ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
