"use client";

import { useEffect, useState } from "react";
import {
  eventToActivityLabel,
  scanIncomingEncryptedNotes,
} from "@/lib/incoming-scanner";
import { getVaultLeafCount } from "@/lib/stellar";
import {
  fetchVaultChainEvents,
  rebuildChainCommitments,
} from "@/lib/vault-events";
import { getWalletMnemonic, hasEncryptedMnemonic, loadVault } from "@/lib/note-store";
import { persistFullVault, useWalletStore } from "@/store/useWalletStore";

export function DashboardPanel() {
  const { publicKey, notes, chainCommitments, shieldedBalance, refreshNotes } =
    useWalletStore();
  const [chainLeafCount, setChainLeafCount] = useState<number | null>(null);
  const [activity, setActivity] = useState<string[]>([]);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const unspent = notes.filter((n) => n.status === "unspent").length;
  const inSync =
    chainLeafCount === null
      ? null
      : chainCommitments.length === chainLeafCount;

  useEffect(() => {
    void (async () => {
      if (!publicKey) return;
      try {
        const [count, events] = await Promise.all([
          getVaultLeafCount(publicKey),
          fetchVaultChainEvents(),
        ]);
        setChainLeafCount(count);
        setActivity(
          events
            .slice(-8)
            .reverse()
            .map((e) => eventToActivityLabel(e))
        );
      } catch {
        setChainLeafCount(null);
      }
    })();
  }, [publicKey, notes.length, chainCommitments.length]);

  async function handleSync() {
    if (!publicKey) return;
    setSyncStatus("Syncing…");
    try {
      const encrypted = await hasEncryptedMnemonic();
      const mnemonic = await getWalletMnemonic();
      const vault = await loadVault();
      if (!mnemonic) {
        setSyncStatus(
          encrypted
            ? "Unlock recovery phrase in Notes (PIN) first"
            : "Import recovery phrase first"
        );
        return;
      }
      const events = await fetchVaultChainEvents();
      const chain = rebuildChainCommitments(events);
      const incoming = await scanIncomingEncryptedNotes({
        mnemonic,
        ownerPubkey: publicKey,
        vault: { ...vault, chainCommitments: chain },
      });
      await persistFullVault({
        ...vault,
        mnemonic,
        notes: incoming.notes,
        chainCommitments: incoming.chainCommitments,
      });
      await refreshNotes();
      setSyncStatus(
        `Synced: ${incoming.imported} encrypted note(s), ${chain.length} commitments`
      );
    } catch (err) {
      setSyncStatus(err instanceof Error ? err.message : "Sync failed");
    }
  }

  return (
    <section className="grid gap-4 md:grid-cols-3">
      <Card title="Shielded balance" value={`${formatStroops(shieldedBalance)} XLM`} />
      <Card title="Unspent notes" value={String(unspent)} />
      <Card
        title="Chain sync"
        value={
          inSync === null
            ? "—"
            : inSync
              ? "✓ in sync"
              : `local ${chainCommitments.length} / chain ${chainLeafCount}`
        }
      />
      <Panel title="Activity (recent)">
        {activity.length === 0 ? (
          <p className="text-sm text-zinc-400">No vault events yet.</p>
        ) : (
          <ul className="space-y-2 text-sm text-zinc-300">
            {activity.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={!publicKey}
          className="mt-4 rounded-lg border border-sky-500/30 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-500/10 disabled:opacity-50"
        >
          Scan encrypted incoming
        </button>
        {syncStatus ? (
          <p className="mt-2 text-xs text-emerald-300">{syncStatus}</p>
        ) : null}
      </Panel>
      <Panel title="How it works">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-300">
          <li>Deposit → commitment on-chain, secrets from recovery phrase.</li>
          <li>Send to zk1… → ECDH-encrypted note on-chain.</li>
          <li>Withdraw → ZK proof + public payout.</li>
        </ol>
      </Panel>
    </section>
  );
}

function formatStroops(value: bigint): string {
  const whole = value / 10_000_000n;
  const frac = value % 10_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(7, "0").replace(/0+$/, "")}`;
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-sm text-zinc-400">{title}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6 md:col-span-3">
      <h2 className="mb-4 text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}
