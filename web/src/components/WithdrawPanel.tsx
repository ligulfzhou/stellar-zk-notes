"use client";

import { useRef, useState, type ReactNode } from "react";
import { signTransactionXdr } from "@/lib/wallet";
import { resolveNoteSecretsFromVault } from "@/lib/note-secrets";
import { proveWitness } from "@/lib/prove-client";
import type { ProvePhase } from "@/lib/prover-client";
import { ProveProgress } from "@/components/ProveProgress";
import { buildWithdrawWitness } from "@/lib/action-witness";
import { proofBytesFromHex } from "@/lib/proof";
import { encodePublicInputs, withdrawFromVault } from "@/lib/stellar";
import { formatError } from "@/lib/format-error";
import { persistVaultState, useWalletStore } from "@/store/useWalletStore";
import { usePasskeyStore } from "@/store/usePasskeyStore";
import { TxLink } from "@/components/TxLink";

export function WithdrawPanel() {
  const { publicKey, notes, chainCommitments, refreshNotes } = useWalletStore();
  const { unlocked, unlock } = usePasskeyStore();
  const [noteId, setNoteId] = useState("");
  const [destination, setDestination] = useState("");
  const [loading, setLoading] = useState(false);
  const [provePhase, setProvePhase] = useState<ProvePhase | null>(null);
  const [proveDetail, setProveDetail] = useState<string | null>(null);
  const [status, setStatus] = useState<ReactNode>(null);
  const [error, setError] = useState<string | null>(null);
  const proveAbortRef = useRef<AbortController | null>(null);

  function cancelProve() {
    proveAbortRef.current?.abort();
    proveAbortRef.current = null;
    setLoading(false);
    setProvePhase(null);
    setProveDetail(null);
    setStatus(null);
    setError("Proof cancelled");
  }

  const unspent = notes.filter((n) => n.status === "unspent");

  async function handleWithdraw() {
    if (!publicKey) {
      setError("Connect wallet first");
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
    setProvePhase(null);
    setProveDetail(null);
    try {
      if (!unlocked) {
        setStatus("Unlocking passkey…");
        await unlock();
      }

      setStatus("Loading on-chain Merkle tree…");
      const chainRes = await fetch("/api/chain-commitments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reader: publicKey,
          localCommitments: chainCommitments,
          notes: unspent.map((n) => ({
            leafIndex: n.leafIndex,
            commitment: n.commitment,
          })),
        }),
      });
      const chainData = (await chainRes.json()) as {
        error?: string;
        commitments?: string[];
        merkleRoot?: string | null;
        leafCount?: number | null;
        treeState?: { filled: string[]; zeros: string[] } | null;
      };
      if (!chainRes.ok || !chainData.commitments) {
        throw new Error(chainData.error ?? "Failed to load chain commitments");
      }
      const chain = chainData.commitments;

      setStatus("Building witness in browser…");
      const spendSecrets = await resolveNoteSecretsFromVault(note);
      const built = await buildWithdrawWitness({
        value: note.value.toString(),
        secret: spendSecrets.secret,
        nullifierSecret: spendSecrets.nullifierSecret,
        leafIndex: note.leafIndex,
        leafCount: chainData.leafCount ?? chain.length,
        onChainMerkleRoot: chainData.merkleRoot ?? undefined,
        commitments: chain,
        noteCommitment: note.commitment,
        treeState: chainData.treeState ?? undefined,
      });

      setStatus("Generating ZK proof…");
      proveAbortRef.current = new AbortController();
      const prove = await proveWitness(built.witness, {}, (phase, detail) => {
        setProvePhase(phase);
        setProveDetail(detail ?? null);
      }, { signal: proveAbortRef.current.signal });
      proveAbortRef.current = null;
      setProvePhase(null);
      setProveDetail(null);

      setStatus("Submitting withdraw…");
      const publicInputs = encodePublicInputs({
        merkleRootHex: prove.merkleRoot ?? built.merkleRootHex,
        nullifierHexes: built.nullifierHexes,
        newCommitmentHexes: ["0x0", "0x0", "0x0", "0x0"],
        publicAmount: note.value.toString(),
      });

      const txHash = await withdrawFromVault({
        sourcePublicKey: publicKey,
        recipient: destination,
        amountStroops: note.value,
        nullifierHex: built.nullifierHexes[0]!,
        merkleRootHex: prove.merkleRoot ?? built.merkleRootHex,
        publicInputs,
        proofBytes: proofBytesFromHex(prove.proofHex),
        signTransaction: async (xdr) => signTransactionXdr(xdr, publicKey),
      });

      const updatedNotes = notes.map((n) =>
        n.id === note.id ? { ...n, status: "spent" as const } : n
      );
      await persistVaultState(updatedNotes, chain);
      await refreshNotes();
      setStatus(
        <>
          Withdrawn. Tx: <TxLink txHash={txHash} />
        </>
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Proof cancelled");
        setStatus(null);
        return;
      }
      setError(formatError(err) || "Withdraw failed");
      setStatus(null);
    } finally {
      setLoading(false);
      setProvePhase(null);
      setProveDetail(null);
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
      <ProveProgress phase={provePhase} detail={proveDetail} onCancel={cancelProve} />
      {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
    </section>
  );
}
