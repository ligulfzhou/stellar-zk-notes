"use client";

import { useState } from "react";
import { signTransaction } from "@stellar/freighter-api";
import { Networks } from "@stellar/stellar-sdk";
import { MnemonicBackupModal } from "@/components/MnemonicBackupModal";
import { createNote } from "@/lib/note";
import { deriveAndAllocateNoteSecrets } from "@/lib/note-store";
import { stroopsFromXlm } from "@/lib/field";
import { depositToVault } from "@/lib/stellar";
import { persistVaultState, useWalletStore } from "@/store/useWalletStore";

export function DepositPanel() {
  const { publicKey, notes, chainCommitments, refreshNotes } = useWalletStore();
  const [amount, setAmount] = useState("1");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingMnemonic, setPendingMnemonic] = useState<string | null>(null);

  async function handleDeposit() {
    if (!publicKey) {
      setError("Connect Freighter first");
      return;
    }

    setLoading(true);
    setError(null);
    setStatus("Deriving note secrets from recovery phrase…");

    try {
      const valueStroops = stroopsFromXlm(amount);
      if (valueStroops <= 0n) {
        throw new Error("Enter a positive amount");
      }

      const derived = await deriveAndAllocateNoteSecrets();
      if (derived.mnemonicIsNew) {
        setPendingMnemonic(derived.mnemonic);
      }

      const { secret, nullifierSecret, derivationIndex } = derived;

      setStatus("Computing Poseidon2 commitment…");
      const res = await fetch("/api/commitment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: valueStroops.toString(),
          secret,
          nullifierSecret,
        }),
      });
      const data = (await res.json()) as { commitment?: string; error?: string };
      if (!res.ok || !data.commitment) {
        throw new Error(data.error ?? "Commitment API failed");
      }

      setStatus("Signing deposit transaction…");
      const { txHash, leafIndex } = await depositToVault({
        sourcePublicKey: publicKey,
        amountStroops: valueStroops,
        commitmentHex: data.commitment,
        signTransaction: async (xdr) => {
          const signed = await signTransaction(xdr, {
            networkPassphrase: Networks.TESTNET,
          });
          if ("error" in signed && signed.error) {
            throw new Error(signed.error);
          }
          return signed.signedTxXdr;
        },
      });

      const note = await createNote({
        valueStroops,
        ownerPubkey: publicKey,
        secret,
        nullifierSecret,
        commitmentHex: data.commitment,
        leafIndex,
        derivationIndex,
      });

      await persistVaultState(
        [...notes, note],
        [...chainCommitments, data.commitment]
      );
      await refreshNotes();

      setStatus(
        `Deposited (leaf ${leafIndex}, derive #${derivationIndex}). Tx: ${txHash.slice(0, 12)}…`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {pendingMnemonic ? (
        <MnemonicBackupModal
          mnemonic={pendingMnemonic}
          onConfirm={() => setPendingMnemonic(null)}
        />
      ) : null}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="mb-4 text-lg font-medium">Deposit to shielded note</h2>
        <p className="mb-4 text-sm text-zinc-400">
          Note secrets are derived from your 12-word recovery phrase (created on first deposit).
          Only the commitment goes on-chain.
        </p>
        <label className="mb-2 block text-sm text-zinc-300">Amount (XLM)</label>
        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="mb-4 w-full max-w-xs rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void handleDeposit()}
          disabled={loading}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {loading ? "Processing…" : "Deposit"}
        </button>
        {status ? <p className="mt-4 text-sm text-emerald-300">{status}</p> : null}
        {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
      </section>
    </>
  );
}
