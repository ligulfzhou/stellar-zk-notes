"use client";

import { useEffect } from "react";
import { ConnectButton } from "@/components/ConnectButton";
import { DashboardPanel } from "@/components/DashboardPanel";
import { DepositPanel } from "@/components/DepositPanel";
import { NotesPanel } from "@/components/NotesPanel";
import { SendPanel } from "@/components/SendPanel";
import { WithdrawPanel } from "@/components/WithdrawPanel";
import { useWalletStore } from "@/store/useWalletStore";

const tabs = [
  { id: "dashboard", label: "Dashboard" },
  { id: "deposit", label: "Deposit" },
  { id: "send", label: "Send" },
  { id: "withdraw", label: "Withdraw" },
  { id: "notes", label: "Notes" },
] as const;

export function WalletApp() {
  const { activeTab, setTab, hydrate, error } = useWalletStore();

  useEffect(() => {
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
          <ConnectButton />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {error ? (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

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
        {activeTab === "deposit" && <DepositPanel />}
        {activeTab === "send" && <SendPanel />}
        {activeTab === "withdraw" && <WithdrawPanel />}
        {activeTab === "notes" && <NotesPanel />}
      </main>
    </div>
  );
}
