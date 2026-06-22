"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { signTransactionXdr } from "@/lib/wallet";
import { resolveNoteSecretsFromVault } from "@/lib/note-secrets";
import { proveWitness } from "@/lib/prove-client";
import type { ProvePhase } from "@/lib/prover-client";
import { ProveProgress } from "@/components/ProveProgress";
import {
  buildExitWitness,
  depositSecretBytesForNote,
} from "@/lib/action-witness";
import { proofBytesFromHex } from "@/lib/proof";
import { encodePublicInputs, exitPoolOnVault } from "@/lib/stellar";
import { formatError } from "@/lib/format-error";
import {
  DEFAULT_RELAYER_FEE_STROOPS,
  RELAYER_G,
  RELAYER_URL,
} from "@/lib/config";
import { fetchRelayerInfo, submitExitViaRelayer } from "@/lib/relayer-exit";
import { poolById } from "@/lib/pool-config";
import { persistVaultState, useWalletStore } from "@/store/useWalletStore";
import { usePasskeyStore } from "@/store/usePasskeyStore";
import { TxLink } from "@/components/TxLink";

export function ExitPanel() {
  const { publicKey, notes, poolChainCommitments, refreshNotes } = useWalletStore();
  const { unlocked, unlock } = usePasskeyStore();
  const [noteId, setNoteId] = useState("");
  const [destination, setDestination] = useState("");
  const [relayerFee, setRelayerFee] = useState(DEFAULT_RELAYER_FEE_STROOPS);
  const [selfExit, setSelfExit] = useState(!RELAYER_URL);
  const [relayerPub, setRelayerPub] = useState(RELAYER_G);
  const [loading, setLoading] = useState(false);
  const [provePhase, setProvePhase] = useState<ProvePhase | null>(null);
  const [proveDetail, setProveDetail] = useState<string | null>(null);
  const [status, setStatus] = useState<ReactNode>(null);
  const [error, setError] = useState<string | null>(null);
  const proveAbortRef = useRef<AbortController | null>(null);

  const relayerAvailable = Boolean(RELAYER_URL);

  useEffect(() => {
    if (!RELAYER_URL) return;
    void fetchRelayerInfo().then((info) => {
      if (!info) return;
      if (!RELAYER_G) setRelayerPub(info.publicKey);
      setRelayerFee(String(info.defaultFeeStroops));
    });
  }, []);

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
  const useRelayerExit = relayerAvailable && !selfExit;

  async function handleExit() {
    if (!publicKey) {
      setError("Connect wallet first (for chain reads)");
      return;
    }
    const note = unspent.find((n) => n.id === noteId);
    if (!note) {
      setError("Select a note");
      return;
    }
    const recipient = destination.trim() || publicKey;
    if (!recipient.startsWith("G")) {
      setError("Enter destination Stellar address");
      return;
    }

    const feeStroops = BigInt(useRelayerExit ? relayerFee.trim() || "0" : "0");
    const relayerAddr = useRelayerExit
      ? relayerPub || (await fetchRelayerInfo())?.publicKey || ""
      : publicKey;

    if (useRelayerExit && !relayerAddr.startsWith("G")) {
      setError("Relayer unavailable — check NEXT_PUBLIC_RELAYER_URL");
      return;
    }
    if (useRelayerExit && feeStroops <= 0n) {
      setError("Relayer exit requires fee > 0");
      return;
    }

    const pool = poolById(note.poolId);
    if (feeStroops > pool.stroops) {
      setError("Relayer fee cannot exceed pool denomination");
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
          poolId: note.poolId,
          localPoolCommitments: poolChainCommitments,
          notes: unspent.map((n) => ({
            leafIndex: n.leafIndex,
            commitment: n.commitment,
            poolId: n.poolId,
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

      setStatus("Building witness in browser…");
      const spendSecrets = await resolveNoteSecretsFromVault(note);
      const depositSecret = depositSecretBytesForNote(note);
      const feeStr = feeStroops.toString();
      const built = await buildExitWitness({
        poolId: note.poolId,
        value: note.value.toString(),
        secret: spendSecrets.secret,
        nullifierSecret: spendSecrets.nullifierSecret,
        depositSecret,
        relayerFeeStroops: feeStr,
        leafIndex: note.leafIndex,
        leafCount: chainData.leafCount ?? chainData.commitments.length,
        onChainMerkleRoot: chainData.merkleRoot ?? undefined,
        commitments: chainData.commitments,
        noteCommitment: note.commitment,
        treeState: chainData.treeState ?? undefined,
      });

      setStatus("Generating ZK proof…");
      proveAbortRef.current = new AbortController();
      const prove = await proveWitness(
        built.witness,
        {},
        (phase, detail) => {
          setProvePhase(phase);
          setProveDetail(detail ?? null);
        },
        { signal: proveAbortRef.current.signal }
      );
      proveAbortRef.current = null;
      setProvePhase(null);
      setProveDetail(null);

      const publicInputs = encodePublicInputs({
        poolId: note.poolId,
        merkleRootHex: prove.merkleRoot ?? built.merkleRootHex,
        nullifierHexes: built.nullifierHexes,
        newCommitmentHexes: ["0x0", "0x0", "0x0", "0x0"],
        publicAmount: pool.stroops.toString(),
        relayerFeeStroops: feeStr,
      });
      const proofBytes = proofBytesFromHex(prove.proofHex);
      const merkleRootHex = prove.merkleRoot ?? built.merkleRootHex;

      let txHash: string;
      if (useRelayerExit) {
        setStatus("Submitting via relayer (gasless)…");
        txHash = await submitExitViaRelayer({
          poolId: note.poolId,
          recipient,
          relayerFeeStroops: Number(feeStroops),
          nullifierHexes: built.nullifierHexes,
          merkleRootHex,
          publicInputs,
          proofBytes,
        });
      } else {
        setStatus("Submitting exit (self)…");
        txHash = await exitPoolOnVault({
          sourcePublicKey: publicKey,
          poolId: note.poolId,
          recipient,
          relayer: publicKey,
          relayerFeeStroops: 0,
          nullifierHexes: built.nullifierHexes,
          merkleRootHex,
          publicInputs,
          proofBytes,
          signTransaction: async (xdr) => signTransactionXdr(xdr, publicKey),
        });
      }

      const updatedNotes = notes.map((n) =>
        n.id === note.id ? { ...n, status: "spent" as const } : n
      );
      await persistVaultState(updatedNotes, poolChainCommitments);
      await refreshNotes();
      setStatus(
        <>
          Exit complete — {Number(pool.stroops - feeStroops) / 1e7} XLM to{" "}
          {recipient.slice(0, 8)}…
          {useRelayerExit ? (
            <> (relayer fee {Number(feeStroops) / 1e7} XLM)</>
          ) : null}{" "}
          Tx: <TxLink txHash={txHash} />
        </>
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Proof cancelled");
        setStatus(null);
        return;
      }
      setError(formatError(err) || "Exit failed");
      setStatus(null);
    } finally {
      setLoading(false);
      setProvePhase(null);
      setProveDetail(null);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <h2 className="mb-2 text-lg font-medium">Exit pool (withdraw)</h2>
      <p className="mb-4 text-sm text-zinc-400">
        Tornado-style: prove locally, relayer submits and earns an on-chain fee
        (recipient can be a fresh G address with 0 XLM). Privacy = unlinkability
        in the pool, not hiding the recipient.
      </p>

      {relayerAvailable ? (
        <label className="mb-4 flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={selfExit}
            onChange={(e) => setSelfExit(e.target.checked)}
          />
          Self-exit (I pay Soroban fee, relayer fee = 0)
        </label>
      ) : null}

      <label className="mb-2 block text-sm text-zinc-300">Note</label>
      <select
        value={noteId}
        onChange={(e) => setNoteId(e.target.value)}
        className="mb-4 w-full max-w-md rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
      >
        <option value="">Select…</option>
        {unspent.map((n) => (
          <option key={n.id} value={n.id}>
            {Number(n.value) / 1e7} XLM — pool {n.poolId} — leaf {n.leafIndex}
          </option>
        ))}
      </select>

      <label className="mb-2 block text-sm text-zinc-300">Recipient (G…)</label>
      <input
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
        placeholder={publicKey ?? "G... — can be empty-balance address"}
        className="mb-4 w-full max-w-md rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-mono"
      />

      {useRelayerExit ? (
        <>
          <p className="mb-2 text-sm text-zinc-400">
            Relayer:{" "}
            <span className="font-mono text-zinc-200">
              {relayerPub ? `${relayerPub.slice(0, 12)}…` : "loading…"}
            </span>
          </p>
          <label className="mb-2 block text-sm text-zinc-300">
            Relayer fee (stroops, deducted on-chain)
          </label>
          <input
            value={relayerFee}
            onChange={(e) => setRelayerFee(e.target.value)}
            className="mb-4 w-full max-w-md rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
        </>
      ) : null}

      <button
        type="button"
        onClick={() => void handleExit()}
        disabled={loading || unspent.length === 0}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
      >
        {loading ? "Processing…" : useRelayerExit ? "Exit via relayer" : "Exit (self)"}
      </button>
      {status ? <p className="mt-4 text-sm text-emerald-300">{status}</p> : null}
      <ProveProgress phase={provePhase} detail={proveDetail} onCancel={cancelProve} />
      {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
    </section>
  );
}
