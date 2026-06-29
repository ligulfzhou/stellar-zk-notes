"use client";

import { useState, type ReactNode } from "react";
import { signTransactionXdr } from "@/lib/wallet";
import { createNote } from "@/lib/note";
import { computeCommitment } from "@/lib/commitment";
import { depositOnVault, getVaultLeafCount } from "@/lib/stellar";
import { stellarExpertTxUrl } from "@/lib/explorer";
import { formatError } from "@/lib/format-error";
import { upsertChainCommitment } from "@/lib/vault-events";
import { persistVaultState, useWalletStore } from "@/store/useWalletStore";
import { usePasskeyStore } from "@/store/usePasskeyStore";
import {
  deriveSpendingKeysFromSeed,
  randomNoteRandomness,
} from "@/lib/shielded-keys";

const STROOPS_PER_XLM = 10_000_000n;

function parseXlmToStroops(xlm: string): bigint | null {
  const trimmed = xlm.trim();
  if (!trimmed || !/^\d+(\.\d{1,7})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0000000").slice(0, 7);
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(fracPadded);
}

export function DepositPanel() {
  const { publicKey, notes, chainCommitments, refreshNotes } = useWalletStore();
  const { unlocked, unlock } = usePasskeyStore();
  const [amountXlm, setAmountXlm] = useState("10");
  const [leafCount, setLeafCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<ReactNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stroops = parseXlmToStroops(amountXlm);

  async function ensurePasskeyReady(): Promise<void> {
    if (!publicKey) throw new Error("Connect wallet first");
    if (!unlocked) {
      setStatus("Unlocking passkey…");
      await unlock();
    }
  }

  async function handleDeposit() {
    setError(null);
    setStatus(null);
    if (!publicKey) {
      setError("Connect wallet first");
      return;
    }
    if (stroops === null || stroops <= 0n) {
      setError("Enter a valid XLM amount");
      return;
    }

    setLoading(true);
    try {
      await ensurePasskeyReady();
      const seed = usePasskeyStore.getState().requireSeed();
      const { spendingPk } = await deriveSpendingKeysFromSeed(seed);
      const noteRandomness = randomNoteRandomness();

      const commitmentHex = await computeCommitment({
        valueStroops: stroops,
        noteRandomness,
        spendingPk,
      });

      setStatus("Signing deposit…");
      const { txHash, leafIndex } = await depositOnVault({
        sourcePublicKey: publicKey,
        signTransaction: (xdr) => signTransactionXdr(xdr, publicKey),
        amountStroops: stroops,
        commitmentHex,
      });

      const note = await createNote({
        valueStroops: stroops,
        noteRandomness,
        spendingPk,
        commitmentHex,
        leafIndex,
      });

      const updatedCommitments = upsertChainCommitment(
        chainCommitments,
        leafIndex,
        commitmentHex
      );
      await persistVaultState([...notes, note], updatedCommitments);
      await refreshNotes();

      const count = await getVaultLeafCount(publicKey);
      setLeafCount(count);
      setStatus(
        <>
          Deposited {amountXlm} XLM —{" "}
          <a
            href={stellarExpertTxUrl(txHash)}
            target="_blank"
            rel="noreferrer"
            className="text-violet-300 underline"
          >
            view tx
          </a>
        </>
      );
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-6">
      <h2 className="mb-2 text-lg font-medium">Deposit</h2>
      <p className="mb-4 text-sm text-zinc-400">
        Shield arbitrary XLM into a private note (Sapling-style: only you can
        spend via your spending key).
      </p>

      <label className="mb-4 block text-sm">
        <span className="text-zinc-400">Amount (XLM)</span>
        <input
          type="text"
          value={amountXlm}
          onChange={(e) => setAmountXlm(e.target.value)}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2"
        />
      </label>

      {leafCount !== null ? (
        <p className="mb-4 text-xs text-zinc-500">
          Global anonymity set: {leafCount} commitments
        </p>
      ) : null}

      {status ? <p className="mb-3 text-sm text-emerald-300">{status}</p> : null}
      {error ? <p className="mb-3 text-sm text-red-300">{error}</p> : null}

      <button
        type="button"
        disabled={loading || !publicKey}
        onClick={() => void handleDeposit()}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {loading ? "Processing…" : "Deposit to shielded pool"}
      </button>
    </section>
  );
}
