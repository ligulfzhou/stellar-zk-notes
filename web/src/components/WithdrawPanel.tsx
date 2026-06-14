"use client";

import { useState } from "react";
import { signTransaction } from "@stellar/freighter-api";
import { Networks } from "@stellar/stellar-sdk";
import { resolveNoteSecretsFromVault } from "@/lib/note-secrets";
import { proofBytesFromHex } from "@/lib/proof";
import { encodePublicInputs, withdrawFromVault } from "@/lib/stellar";
import { persistVaultState, useWalletStore } from "@/store/useWalletStore";

export function WithdrawPanel() {
  const { publicKey, notes, chainCommitments, refreshNotes } = useWalletStore();
  const [noteId, setNoteId] = useState("");
  const [destination, setDestination] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unspent = notes.filter((n) => n.status === "unspent");

  async function handleWithdraw() {
    if (!publicKey) {
      setError("Connect Freighter first");
      return;
    }
    const note = unspent.find((n) => n.id === noteId);
    if (!note) {
      setError("Select a note");
      return;
    }
    if (!destination.startsWith("G")) {
      setError("Enter destination Stellar address");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setStatus("Generating withdraw witness…");
      const spendSecrets = await resolveNoteSecretsFromVault(note);
      const proveRes = await fetch("/api/prove-spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "withdraw",
          value: note.value.toString(),
          secret: spendSecrets.secret,
          nullifierSecret: spendSecrets.nullifierSecret,
          leafIndex: note.leafIndex,
          commitments: chainCommitments,
        }),
      });
      const prove = (await proveRes.json()) as {
        error?: string;
        merkleRoot?: string;
        nullifier?: string;
        proofHex?: string;
        publicInputs?: Record<string, string>;
      };
      if (!proveRes.ok || !prove.merkleRoot || !prove.publicInputs) {
        throw new Error(prove.error ?? "Prove API failed");
      }

      setStatus("Submitting withdraw…");
      const publicInputs = encodePublicInputs({
        merkleRootHex: prove.merkleRoot,
        nullifierHex: prove.nullifier!,
        newCommitmentHex: "0x0",
        publicAmount: prove.publicInputs.public_amount,
        mode: prove.publicInputs.mode,
      });

      const txHash = await withdrawFromVault({
        sourcePublicKey: publicKey,
        recipient: destination,
        amountStroops: note.value,
        nullifierHex: prove.nullifier!,
        merkleRootHex: prove.merkleRoot,
        publicInputs,
        proofBytes: proofBytesFromHex(prove.proofHex),
        signTransaction: async (xdr) => {
          const signed = await signTransaction(xdr, {
            networkPassphrase: Networks.TESTNET,
          });
          if ("error" in signed && signed.error) throw new Error(signed.error);
          return signed.signedTxXdr;
        },
      });

      const updatedNotes = notes.map((n) =>
        n.id === note.id ? { ...n, status: "spent" as const } : n
      );
      await persistVaultState(updatedNotes, chainCommitments);
      await refreshNotes();
      setStatus(`Withdrawn. Tx: ${txHash.slice(0, 12)}…`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdraw failed");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <h2 className="mb-4 text-lg font-medium">Withdraw to public address</h2>
      <label className="mb-2 block text-sm text-zinc-300">Note</label>
      <select
        value={noteId}
        onChange={(e) => setNoteId(e.target.value)}
        className="mb-4 w-full max-w-md rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
      >
        <option value="">Select…</option>
        {unspent.map((n) => (
          <option key={n.id} value={n.id}>
            {Number(n.value) / 1e7} XLM — leaf {n.leafIndex}
          </option>
        ))}
      </select>
      <label className="mb-2 block text-sm text-zinc-300">Destination (G…)</label>
      <input
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
        placeholder={publicKey ?? "G..."}
        className="mb-4 w-full max-w-md rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-mono"
      />
      <button
        type="button"
        onClick={() => void handleWithdraw()}
        disabled={loading || unspent.length === 0}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
      >
        {loading ? "Processing…" : "Withdraw"}
      </button>
      {status ? <p className="mt-4 text-sm text-emerald-300">{status}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
    </section>
  );
}
