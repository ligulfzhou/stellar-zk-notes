"use client";

import { useEffect, useMemo, useState } from "react";
import { signTransactionXdr } from "@/lib/wallet";
import { createNote } from "@/lib/note";
import type { Note } from "@/lib/note";
import { deriveAndAllocateNoteSecrets } from "@/lib/note-store";
import {
  computeCommitmentV2,
  depositSecretToHex,
} from "@/lib/commitment-v2";
import { deriveDepositSecretFromSeed } from "@/lib/root-seed";
import { joinPoolOnVault, getVaultLeafCount } from "@/lib/stellar";
import { stellarExpertTxUrl } from "@/lib/explorer";
import { formatError } from "@/lib/format-error";
import {
  decomposeJoinAmount,
  formatJoinSummary,
  parseJoinAmountXlm,
  type JoinSlot,
} from "@/lib/join-decompose";
import { MIN_POOL_SIZE_TESTNET, POOLS } from "@/lib/pool-config";
import { upsertPoolChainCommitment } from "@/lib/vault-events";
import { persistVaultState, useWalletStore } from "@/store/useWalletStore";
import { usePasskeyStore } from "@/store/usePasskeyStore";

type BatchSuccess = {
  totalXlm: number;
  joinCount: number;
  lastTxHash: string;
};

export function JoinPanel() {
  const { publicKey, notes, poolChainCommitments, refreshNotes } = useWalletStore();
  const { unlocked, unlock, rootSeed, requireSeed } = usePasskeyStore();
  const [amountXlm, setAmountXlm] = useState("10");
  const [poolLeafCounts, setPoolLeafCounts] = useState<Array<number | null>>(
    () => POOLS.map(() => null)
  );
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [success, setSuccess] = useState<BatchSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decomposition = useMemo(() => {
    const xlm = parseJoinAmountXlm(amountXlm);
    if (xlm === null) return null;
    const result = decomposeJoinAmount(xlm);
    return "error" in result ? result : result;
  }, [amountXlm]);

  useEffect(() => {
    void (async () => {
      if (!publicKey) {
        setPoolLeafCounts(POOLS.map(() => null));
        return;
      }
      const counts = await Promise.all(
        POOLS.map(async (pool) => {
          try {
            return await getVaultLeafCount(publicKey, pool.id);
          } catch {
            return null;
          }
        })
      );
      setPoolLeafCounts(counts);
    })();
  }, [publicKey, success?.joinCount]);

  async function ensurePasskeyReady(): Promise<void> {
    if (!publicKey) {
      throw new Error("Connect wallet first");
    }
    if (!unlocked) {
      setStatus("Unlocking passkey…");
      await unlock();
    }
  }

  async function joinOneSlot(params: {
    slot: JoinSlot;
    slotIndex: number;
    slotTotal: number;
    currentNotes: Note[];
    currentPools: string[][];
  }) {
    if (!publicKey) throw new Error("Connect wallet first");

    const { slot, slotIndex, slotTotal, currentNotes, currentPools } = params;
    const { poolId } = slot;

    setStatus(`Deposit ${slotIndex + 1}/${slotTotal} — ${slot.label}…`);

    const derived = await deriveAndAllocateNoteSecrets(publicKey);
    const { secret, nullifierSecret, derivationIndex } = derived;
    const seed = rootSeed ?? requireSeed();
    const depositSecret = deriveDepositSecretFromSeed(seed, derivationIndex);

    const commitmentHex = await computeCommitmentV2({
      valueStroops: slot.stroops,
      secret,
      nullifierSecret,
      depositSecret,
      poolId,
    });

    const { txHash, leafIndex } = await joinPoolOnVault({
      sourcePublicKey: publicKey,
      poolId,
      commitmentHex,
      signTransaction: async (xdr) => signTransactionXdr(xdr, publicKey),
    });

    const note = await createNote({
      valueStroops: slot.stroops,
      poolId,
      ownerPubkey: publicKey,
      secret,
      nullifierSecret,
      depositSecretHex: depositSecretToHex(depositSecret),
      commitmentHex,
      leafIndex,
      derivationIndex,
    });

    return {
      txHash,
      notes: [...currentNotes, note],
      pools: upsertPoolChainCommitment(currentPools, poolId, leafIndex, commitmentHex),
    };
  }

  async function runJoin() {
    if (!publicKey) {
      setError("Connect wallet first");
      return;
    }
    if (!decomposition || "error" in decomposition) {
      setError(
        decomposition && "error" in decomposition
          ? decomposition.error
          : "Enter a positive whole number of XLM"
      );
      return;
    }

    const { slots, totalXlm } = decomposition;

    setLoading(true);
    setError(null);
    setSuccess(null);
    setStatus("Deriving note secrets from passkey…");

    try {
      await ensurePasskeyReady();

      let currentNotes = [...notes];
      let currentPools = poolChainCommitments;
      let lastTxHash = "";

      for (let i = 0; i < slots.length; i++) {
        try {
          const result = await joinOneSlot({
            slot: slots[i]!,
            slotIndex: i,
            slotTotal: slots.length,
            currentNotes,
            currentPools,
          });
          currentNotes = result.notes;
          currentPools = result.pools;
          lastTxHash = result.txHash;
        } catch (joinErr) {
          if (currentNotes.length > notes.length) {
            await persistVaultState(currentNotes, currentPools);
            await refreshNotes();
          }
          throw joinErr;
        }
      }

      await persistVaultState(currentNotes, currentPools);
      await refreshNotes();

      setStatus(null);
      setSuccess({ totalXlm, joinCount: slots.length, lastTxHash });
    } catch (err) {
      setError(formatError(err) || "Deposit failed");
      setStatus(null);
      setSuccess(null);
      await refreshNotes();
    } finally {
      setLoading(false);
    }
  }

  const previewError =
    decomposition && "error" in decomposition ? decomposition.error : null;
  const previewOk =
    decomposition && !("error" in decomposition) ? decomposition : null;
  const depositLabel =
    previewOk && previewOk.slots.length === 1
      ? `Deposit ${previewOk.totalXlm} XLM`
      : previewOk
        ? `Deposit ${previewOk.totalXlm} XLM (${previewOk.slots.length} transactions)`
        : "Deposit";

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="mb-4 text-lg font-medium">Shielded deposit</h2>
        <p className="mb-4 text-sm text-zinc-400">
          Enter any whole XLM amount — we split it into 100 / 10 / 1 fixed pools
          (one note per deposit). Only pool id, commitment, and leaf index appear
          on-chain.
        </p>

        <label className="mb-2 block text-sm text-zinc-300">Amount (XLM)</label>
        <input
          type="text"
          inputMode="numeric"
          value={amountXlm}
          onChange={(e) => setAmountXlm(e.target.value)}
          placeholder="e.g. 237"
          disabled={loading}
          className="mb-2 w-full max-w-xs rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
        />
        <div className="mb-4 flex flex-wrap gap-2">
          {[1, 10, 100, 237].map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={loading}
              onClick={() => setAmountXlm(String(preset))}
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5 disabled:opacity-50"
            >
              {preset} XLM
            </button>
          ))}
        </div>

        {previewError ? (
          <p className="mb-4 text-sm text-red-300">{previewError}</p>
        ) : previewOk ? (
          <div className="mb-4 rounded-lg border border-violet-500/20 bg-violet-500/5 px-4 py-3">
            <p className="text-sm text-violet-100">{formatJoinSummary(previewOk)}</p>
            <p className="mt-2 text-xs text-zinc-400">
              Exit operates per pool — notes in different pools are spent
              separately.
            </p>
            <ul className="mt-3 space-y-1 text-xs text-zinc-500">
              {POOLS.map((pool, i) => {
                const count = poolLeafCounts[i];
                const hint =
                  count === null
                    ? "—"
                    : count >= MIN_POOL_SIZE_TESTNET
                      ? `${count} notes (spend enabled)`
                      : `${count} / ${MIN_POOL_SIZE_TESTNET} min`;
                return (
                  <li key={pool.id}>
                    Pool {pool.label}: {hint}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void runJoin()}
          disabled={loading || !previewOk}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {loading ? "Processing…" : depositLabel}
        </button>

        {success ? (
          <p className="mt-4 text-sm text-emerald-300">
            Deposited {success.totalXlm} XLM in {success.joinCount} transaction
            {success.joinCount === 1 ? "" : "s"}. Last tx:{" "}
            <a
              href={stellarExpertTxUrl(success.lastTxHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-emerald-400/60 underline-offset-2 hover:text-emerald-200"
            >
              {success.lastTxHash.slice(0, 12)}…
            </a>
          </p>
        ) : null}
        {status ? <p className="mt-4 text-sm text-emerald-300">{status}</p> : null}
        {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
    </section>
  );
}
