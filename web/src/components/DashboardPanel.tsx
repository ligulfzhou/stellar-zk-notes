"use client";

import { useEffect, useState } from "react";
import { fetchVaultChainState } from "@/lib/vault-events-client";
import { eventToActivityLabel } from "@/lib/vault-events";
import { fetchPublicXlmBalance } from "@/lib/account-balance";
import { POOLS } from "@/lib/pool-config";
import { PrivacyBadge } from "@/components/PrivacyBadge";
import { useWalletStore } from "@/store/useWalletStore";

export function DashboardPanel() {
  const { publicKey, notes, poolChainCommitments, shieldedBalance } =
    useWalletStore();
  const [chainLeafCount, setChainLeafCount] = useState<number | null>(null);
  const [poolLeafCounts, setPoolLeafCounts] = useState<Array<number | null>>([]);
  const [publicBalance, setPublicBalance] = useState<string | null>(null);
  const [activity, setActivity] = useState<string[]>([]);

  const unspent = notes.filter((n) => n.status === "unspent").length;
  const pool0Count = poolChainCommitments[0]?.length ?? 0;
  const inSync =
    chainLeafCount === null ? null : pool0Count === chainLeafCount;

  useEffect(() => {
    void (async () => {
      if (!publicKey) {
        setPublicBalance(null);
        return;
      }
      setPublicBalance(await fetchPublicXlmBalance(publicKey));
    })();
  }, [publicKey]);

  useEffect(() => {
    void (async () => {
      if (!publicKey) return;
      try {
        const state = await fetchVaultChainState({ reader: publicKey });
        setChainLeafCount(state.leafCount);
        setPoolLeafCounts(state.poolLeafCounts ?? []);
        setActivity(
          state.events
            .slice(-8)
            .reverse()
            .map((e) => eventToActivityLabel(e))
        );
      } catch {
        setChainLeafCount(null);
      }
    })();
  }, [publicKey, notes.length, pool0Count]);

  return (
    <section className="grid gap-4 md:grid-cols-3">
      <p className="text-sm text-zinc-500 md:col-span-3">
        Shielded balance and unspent notes come from{" "}
        <span className="text-zinc-400">local notes</span> in this browser
        (IndexedDB). Connect, unlock passkey, then deposit or use Notes →
        Rescan from chain. Pool privacy and activity are read from the vault on
        testnet.
      </p>
      <Card
        title="Public XLM"
        value={publicBalance !== null ? `${publicBalance} XLM` : "—"}
      />
      <Card title="Shielded balance" value={`${formatStroops(shieldedBalance)} XLM`} />
      <Card title="Unspent notes" value={String(unspent)} />
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <p className="text-sm text-zinc-400">Pool privacy (pool 0)</p>
        <div className="mt-3">
          <PrivacyBadge
            poolLeafCount={poolLeafCounts[0] ?? chainLeafCount}
            poolLabel={POOLS[0]?.label}
          />
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Larger anonymity set → stronger unlinkability on exit.
        </p>
      </div>
      <Card
        title="Chain sync"
        value={
          inSync === null
            ? "—"
            : inSync
              ? "✓ in sync"
              : `local pool-0 ${pool0Count} / chain ${chainLeafCount}`
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
      </Panel>
      <Panel title="Limits">
        <ul className="space-y-2 text-sm text-zinc-400">
          <li>Fixed pools: 1 / 10 / 100 XLM (Tornado-style denominations).</li>
          <li>Merkle tree height 16 (~65k commitments per pool).</li>
        </ul>
      </Panel>
      <Panel title="How it works">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-300">
          <li>Deposit → commitment enters the pool (no note secrets on-chain).</li>
          <li>Wait for anonymity set to grow (see privacy badge).</li>
          <li>
            Exit → browser ZK proof + relayer submits; recipient G address can
            differ from deposit (unlinkability).
          </li>
        </ol>
        <p className="mt-3 text-xs text-zinc-500">
          Recover deposits on a new browser: Notes → Unlock passkey → Rescan from
          chain.
        </p>
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
