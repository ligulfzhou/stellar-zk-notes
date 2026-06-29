"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { signTransactionXdr } from "@/lib/wallet";
import { resolveSpendingSkFromVault } from "@/lib/note-secrets";
import { proveWitness } from "@/lib/prove-client";
import type { ProvePhase } from "@/lib/prover-client";
import { ProveProgress } from "@/components/ProveProgress";
import {
  buildSingleNoteRelayerExitWitness,
  buildSingleNoteWithdrawWitness,
} from "@/lib/action-witness";
import { proofBytesFromHex } from "@/lib/proof";
import {
  encodePublicInputs,
  exitViaRelayerOnVault,
  withdrawOnVault,
} from "@/lib/stellar";
import { formatError } from "@/lib/format-error";
import {
  DEFAULT_RELAYER_FEE_STROOPS,
  RELAYER_G,
  RELAYER_URL,
} from "@/lib/config";
import { fetchRelayerInfo, submitExitViaRelayer } from "@/lib/relayer-exit";
import { persistVaultState, useWalletStore } from "@/store/useWalletStore";
import { usePasskeyStore } from "@/store/usePasskeyStore";
import { TxLink } from "@/components/TxLink";

const STROOPS_PER_XLM = 10_000_000n;

function formatStroops(value: bigint): string {
  const whole = value / STROOPS_PER_XLM;
  const frac = value % STROOPS_PER_XLM;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(7, "0").replace(/0+$/, "")}`;
}

export function WithdrawPanel() {
  const { publicKey, notes, chainCommitments, refreshNotes } = useWalletStore();
  const { unlocked, unlock } = usePasskeyStore();
  const [noteId, setNoteId] = useState("");
  const [destination, setDestination] = useState("");
  const [mode, setMode] = useState<"onchain" | "relayer">(
    RELAYER_URL ? "relayer" : "onchain"
  );
  const [relayerFee, setRelayerFee] = useState(DEFAULT_RELAYER_FEE_STROOPS);
  const [relayerPub, setRelayerPub] = useState(RELAYER_G);
  const [loading, setLoading] = useState(false);
  const [provePhase, setProvePhase] = useState<ProvePhase | null>(null);
  const [proveDetail, setProveDetail] = useState<string | null>(null);
  const [status, setStatus] = useState<ReactNode>(null);
  const [error, setError] = useState<string | null>(null);
  const proveAbortRef = useRef<AbortController | null>(null);

  const relayerAvailable = Boolean(RELAYER_URL);
  const unspent = notes.filter((n) => n.status === "unspent");

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

  async function loadChainState(noteLeafIndex: number) {
    const chainRes = await fetch("/api/chain-commitments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reader: publicKey,
        localChainCommitments: chainCommitments,
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
    return { ...chainData, commitments: chainData.commitments };
  }

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
    const recipient = destination.trim() || publicKey;
    if (!recipient.startsWith("G")) {
      setError("Enter destination Stellar G… address");
      return;
    }

    const useRelayer = mode === "relayer" && relayerAvailable;
    const feeStroops = useRelayer ? BigInt(relayerFee.trim() || "0") : 0n;
    const relayerAddr = useRelayer
      ? relayerPub || (await fetchRelayerInfo())?.publicKey || ""
      : publicKey;

    if (useRelayer && !relayerAddr.startsWith("G")) {
      setError("Relayer unavailable — check NEXT_PUBLIC_RELAYER_URL");
      return;
    }
    if (useRelayer && feeStroops <= 0n) {
      setError("Relayer exit requires fee > 0");
      return;
    }
    if (feeStroops >= note.value) {
      setError("Fee cannot exceed note value");
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

      setStatus("Loading Merkle tree…");
      const chainData = await loadChainState(note.leafIndex);
      const spendingSk = await resolveSpendingSkFromVault();
      const feeStr = feeStroops.toString();

      setStatus("Building witness…");
      const built = useRelayer
        ? await buildSingleNoteRelayerExitWitness({
            note,
            spendingSk,
            relayerFeeStroops: feeStr,
            leafCount: chainData.leafCount ?? chainData.commitments.length,
            commitments: chainData.commitments,
            onChainMerkleRoot: chainData.merkleRoot ?? undefined,
            treeState: chainData.treeState ?? undefined,
          })
        : await buildSingleNoteWithdrawWitness({
            note,
            spendingSk,
            leafCount: chainData.leafCount ?? chainData.commitments.length,
            commitments: chainData.commitments,
            onChainMerkleRoot: chainData.merkleRoot ?? undefined,
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
        merkleRootHex: prove.merkleRoot ?? built.merkleRootHex,
        nullifierHexes: built.nullifierHexes,
        newCommitmentHexes: ["0x0", "0x0", "0x0", "0x0"],
        publicAmount: note.value.toString(),
        relayerFeeStroops: feeStr,
      });
      const proofBytes = proofBytesFromHex(prove.proofHex);
      const merkleRootHex = prove.merkleRoot ?? built.merkleRootHex;

      let txHash: string;
      if (useRelayer) {
        setStatus("Submitting via relayer…");
        txHash = await submitExitViaRelayer({
          recipient,
          relayerFeeStroops: Number(feeStroops),
          nullifierHexes: built.nullifierHexes,
          merkleRootHex,
          publicInputs,
          proofBytes,
        });
      } else if (RELAYER_URL && mode === "onchain") {
        setStatus("Submitting on-chain withdraw…");
        txHash = await withdrawOnVault({
          sourcePublicKey: publicKey,
          recipient,
          nullifierHexes: built.nullifierHexes,
          merkleRootHex,
          publicInputs,
          proofBytes,
          signTransaction: (xdr) => signTransactionXdr(xdr, publicKey),
        });
      } else {
        setStatus("Submitting on-chain withdraw…");
        txHash = await withdrawOnVault({
          sourcePublicKey: publicKey,
          recipient,
          nullifierHexes: built.nullifierHexes,
          merkleRootHex,
          publicInputs,
          proofBytes,
          signTransaction: (xdr) => signTransactionXdr(xdr, publicKey),
        });
      }

      const updatedNotes = notes.map((n) =>
        n.id === note.id ? { ...n, status: "spent" as const } : n
      );
      await persistVaultState(updatedNotes, chainCommitments);
      await refreshNotes();

      const payout = note.value - feeStroops;
      setStatus(
        <>
          Withdraw complete — {formatStroops(payout)} XLM to {recipient.slice(0, 8)}…
          {useRelayer ? " (relayer exit)" : " (on-chain)"}{" "}
          <TxLink txHash={txHash} />
        </>
      );
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
      setProvePhase(null);
      setProveDetail(null);
    }
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-6">
      <h2 className="mb-2 text-lg font-medium">Withdraw</h2>
      <p className="mb-4 text-sm text-zinc-400">
        On-chain withdraw exposes recipient + amount in events. Relayer exit
        only publishes a nullifier on-chain.
      </p>

      {relayerAvailable ? (
        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setMode("onchain")}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              mode === "onchain" ? "bg-violet-600" : "bg-white/10"
            }`}
          >
            On-chain
          </button>
          <button
            type="button"
            onClick={() => setMode("relayer")}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              mode === "relayer" ? "bg-violet-600" : "bg-white/10"
            }`}
          >
            Relayer exit
          </button>
        </div>
      ) : null}

      <label className="mb-3 block text-sm">
        <span className="text-zinc-400">Note</span>
        <select
          value={noteId}
          onChange={(e) => setNoteId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2"
        >
          <option value="">Select unspent note</option>
          {unspent.map((n) => (
            <option key={n.id} value={n.id}>
              {formatStroops(n.value)} XLM · leaf {n.leafIndex}
            </option>
          ))}
        </select>
      </label>

      <label className="mb-3 block text-sm">
        <span className="text-zinc-400">Destination (G…)</span>
        <input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder={publicKey ?? "G…"}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs"
        />
      </label>

      {mode === "relayer" && relayerAvailable ? (
        <label className="mb-4 block text-sm">
          <span className="text-zinc-400">Relayer fee (stroops)</span>
          <input
            value={relayerFee}
            onChange={(e) => setRelayerFee(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2"
          />
        </label>
      ) : null}

      {provePhase ? (
        <div className="mb-4">
          <ProveProgress phase={provePhase} detail={proveDetail} />
          <button
            type="button"
            onClick={cancelProve}
            className="mt-2 text-sm text-zinc-400 underline"
          >
            Cancel proof
          </button>
        </div>
      ) : null}

      {status ? <p className="mb-3 text-sm text-emerald-300">{status}</p> : null}
      {error ? <p className="mb-3 text-sm text-red-300">{error}</p> : null}

      <button
        type="button"
        disabled={loading || !publicKey || !noteId}
        onClick={() => void handleWithdraw()}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {loading ? "Processing…" : mode === "relayer" ? "Relayer exit" : "Withdraw"}
      </button>
    </section>
  );
}
