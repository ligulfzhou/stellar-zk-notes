"use client";

import { useEffect } from "react";
import { ConnectButton } from "@/components/ConnectButton";
import { DashboardPanel } from "@/components/DashboardPanel";
import { JoinPanel } from "@/components/JoinPanel";
import { NotesPanel } from "@/components/NotesPanel";
import { SendPanel } from "@/components/SendPanel";
import { ExitPanel } from "@/components/ExitPanel";
import { PasskeyUnlockBanner } from "@/components/PasskeyUnlockBanner";
import { DevPrivacyWarning } from "@/components/DevPrivacyWarning";
import { ZkModeBadge } from "@/components/ZkModeBadge";
import { useWalletStore } from "@/store/useWalletStore";
import { initWalletsKit } from "@/lib/wallet";

const tabs = [
  { id: "dashboard", label: "Dashboard" },
  { id: "join", label: "Join pool" },
  { id: "send", label: "Send" },
  { id: "exit", label: "Exit" },
  { id: "notes", label: "Notes" },
] as const;

export function WalletApp() {
  const { activeTab, setTab, hydrate, error } = useWalletStore();

  useEffect(() => {
    initWalletsKit();
    void hydrate();
  }, [hydrate]);

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-zinc-100">
      <header className="border-b border-white/10 bg-[#0f1524]/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-violet-300">
              Stellar Hacks ZK
            </p>
            <h1 className="text-xl font-semibold">zk-notes</h1>
          </div>
          <div className="flex items-center gap-3">
            <ZkModeBadge />
            <ConnectButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {error ? (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <PasskeyUnlockBanner />
        <DevPrivacyWarning />

        <nav className="mb-8 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              className={`rounded-full px-4 py-2 text-sm transition ${
                activeTab === tab.id
                  ? "bg-violet-600 text-white"
                  : "bg-white/5 text-zinc-300 hover:bg-white/10"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === "dashboard" && <DashboardPanel />}
        {activeTab === "join" && <JoinPanel />}
        {activeTab === "send" && <SendPanel />}
        {activeTab === "exit" && <ExitPanel />}
        {activeTab === "notes" && <NotesPanel />}
      </main>
    </div>
  );
}
