"use client";

import { useRef, useState, type ReactNode } from "react";
import { signTransactionXdr } from "@/lib/wallet";
import { resolveSpendingSkFromVault } from "@/lib/note-secrets";
import { proveWitness } from "@/lib/prove-client";
import type { ProvePhase } from "@/lib/prover-client";
import { ProveProgress } from "@/components/ProveProgress";
import { buildShieldedTransferWitness } from "@/lib/action-witness";
import { selectNotesForAmount } from "@/lib/coin-selection";
import { createNote } from "@/lib/note";
import {
  bytesToHex0x,
  encryptNoteForRecipient,
  parseShieldedReceiveAddress,
} from "@/lib/note-crypto";
import { proofBytesFromHex } from "@/lib/proof";
import { encodePublicInputs, shieldedTransferOnVault } from "@/lib/stellar";
import { formatError } from "@/lib/format-error";
import { upsertChainCommitment } from "@/lib/vault-events";
import {
  deriveShieldedReceiveKeysFromSeed,
} from "@/lib/root-seed";
import {
  deriveSpendingKeysFromSeed,
  randomNoteRandomness,
} from "@/lib/shielded-keys";
import { persistVaultState, useWalletStore } from "@/store/useWalletStore";
import { usePasskeyStore } from "@/store/usePasskeyStore";
import { TxLink } from "@/components/TxLink";

const STROOPS_PER_XLM = 10_000_000n;

function parseXlmToStroops(xlm: string): bigint | null {
  const trimmed = xlm.trim();
  if (!trimmed || !/^\d+(\.\d{1,7})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0000000").slice(0, 7);
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(fracPadded);
}

function formatStroops(value: bigint): string {
  const whole = value / STROOPS_PER_XLM;
  const frac = value % STROOPS_PER_XLM;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(7, "0").replace(/0+$/, "")}`;
}

export function SendPanel() {
  const { publicKey, notes, chainCommitments, refreshNotes } = useWalletStore();
  const { unlocked, unlock } = usePasskeyStore();
  const [recipient, setRecipient] = useState("");
  const [amountXlm, setAmountXlm] = useState("1");
  const [loading, setLoading] = useState(false);
  const [provePhase, setProvePhase] = useState<ProvePhase | null>(null);
  const [proveDetail, setProveDetail] = useState<string | null>(null);
  const [status, setStatus] = useState<ReactNode>(null);
  const [error, setError] = useState<string | null>(null);
  const proveAbortRef = useRef<AbortController | null>(null);

  const unspent = notes.filter((n) => n.status === "unspent");
  const targetStroops = parseXlmToStroops(amountXlm);

  async function handleSend() {
    if (!publicKey) {
      setError("Connect wallet first");
      return;
    }
    if (targetStroops === null || targetStroops <= 0n) {
      setError("Enter a valid amount");
      return;
    }
    if (!recipient.trim()) {
      setError("Enter recipient zk1 address");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (!unlocked) {
        setStatus("Unlocking passkey…");
        await unlock();
      }
      const seed = usePasskeyStore.getState().requireSeed();
      const spendingSk = await resolveSpendingSkFromVault();
      const { spendingPk } = await deriveSpendingKeysFromSeed(seed);
      const { publicKey: selfX25519 } = deriveShieldedReceiveKeysFromSeed(seed);
      const recipientAddr = parseShieldedReceiveAddress(recipient);

      const { inputs: selected, change } = selectNotesForAmount(
        unspent,
        targetStroops
      );
      const inputs = selected.map(
        (picked) => unspent.find((n) => n.id === picked.id)!
      );

      setStatus("Loading Merkle tree…");
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
        throw new Error(chainData.error ?? "Failed to load chain");
      }

      const spendInputs = inputs.map((note) => ({
        value: note.value.toString(),
        noteRandomness: note.noteRandomness,
        spendingSk,
        leafIndex: note.leafIndex,
        noteCommitment: note.commitment,
      }));

      const payeeRcm = randomNoteRandomness();
      const outputs: Array<{
        value: string;
        noteRandomness: string;
        recipientPk: string;
        deliveryX25519: string;
        isChange: boolean;
      }> = [
        {
          value: targetStroops.toString(),
          noteRandomness: payeeRcm,
          recipientPk: recipientAddr.spendingPk,
          deliveryX25519: recipientAddr.x25519Hex,
          isChange: false,
        },
      ];

      if (change > 0n) {
        outputs.push({
          value: change.toString(),
          noteRandomness: randomNoteRandomness(),
          recipientPk: spendingPk,
          deliveryX25519: bytesToHex0x(selfX25519).slice(2),
          isChange: true,
        });
      }

      setStatus("Building witness…");
      const built = await buildShieldedTransferWitness({
        inputs: spendInputs,
        outputs: outputs.map((o) => ({
          value: o.value,
          noteRandomness: o.noteRandomness,
          recipientPk: o.recipientPk,
        })),
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

      const epkHexes: string[] = [];
      const encryptedNotes: Uint8Array[] = [];
      for (let i = 0; i < outputs.length; i++) {
        const nc = built.newCommitmentHexes[i];
        if (!nc || nc === "0x0") continue;
        const out = outputs[i]!;
        const enc = encryptNoteForRecipient(out.deliveryX25519, {
          valueStroops: out.value,
          noteRandomness: out.noteRandomness,
          spendingPk: out.recipientPk,
        });
        epkHexes.push(bytesToHex0x(enc.epk));
        encryptedNotes.push(enc.encryptedNote);
      }

      const publicInputs = encodePublicInputs({
        merkleRootHex: prove.merkleRoot ?? built.merkleRootHex,
        nullifierHexes: built.nullifierHexes,
        newCommitmentHexes: built.newCommitmentHexes,
        publicAmount: "0",
        relayerFeeStroops: "0",
      });

      setStatus("Submitting shielded transfer…");
      const txHash = await shieldedTransferOnVault({
        sourcePublicKey: publicKey,
        nullifierHexes: built.nullifierHexes,
        newCommitmentHexes: built.newCommitmentHexes,
        merkleRootHex: prove.merkleRoot ?? built.merkleRootHex,
        publicInputs,
        proofBytes: proofBytesFromHex(prove.proofHex),
        epkHexes,
        encryptedNotes,
        signTransaction: (xdr) => signTransactionXdr(xdr, publicKey),
      });

      const spentIds = new Set(inputs.map((n) => n.id));
      let updatedCommitments = [...chainCommitments];
      const newNotes = [...notes];

      for (let i = 0; i < built.newCommitmentHexes.length; i++) {
        const nc = built.newCommitmentHexes[i];
        if (!nc || nc === "0x0") continue;
        const out = outputs[i]!;
        if (!out.isChange) continue;
        const leafIndex = updatedCommitments.filter(Boolean).length;
        updatedCommitments = upsertChainCommitment(updatedCommitments, leafIndex, nc);
        newNotes.push(
          await createNote({
            valueStroops: BigInt(out.value),
            noteRandomness: out.noteRandomness,
            spendingPk: out.recipientPk,
            commitmentHex: nc,
            leafIndex,
          })
        );
      }

      const finalNotes = newNotes.map((n) =>
        spentIds.has(n.id) ? { ...n, status: "spent" as const } : n
      );
      await persistVaultState(finalNotes, updatedCommitments);
      await refreshNotes();

      setStatus(
        <>
          Sent {formatStroops(targetStroops)} XLM privately
          {change > 0n ? ` (change ${formatStroops(change)} XLM)` : ""}{" "}
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
      <h2 className="mb-2 text-lg font-medium">Send</h2>
      <p className="mb-4 text-sm text-zinc-400">
        Sapling-style send: payee output binds to recipient spending key only —
        sender cannot spend it. Address format:{" "}
        <code className="text-zinc-300">zk1:&lt;spending_pk&gt;#&lt;x25519&gt;</code>
      </p>

      <label className="mb-3 block text-sm">
        <span className="text-zinc-400">Recipient</span>
        <input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="zk1:<spending_pk64>#<x25519_64>"
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs"
        />
      </label>

      <label className="mb-4 block text-sm">
        <span className="text-zinc-400">Amount (XLM)</span>
        <input
          value={amountXlm}
          onChange={(e) => setAmountXlm(e.target.value)}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2"
        />
      </label>

      {provePhase ? (
        <div className="mb-4">
          <ProveProgress phase={provePhase} detail={proveDetail} />
        </div>
      ) : null}

      {status ? <p className="mb-3 text-sm text-emerald-300">{status}</p> : null}
      {error ? <p className="mb-3 text-sm text-red-300">{error}</p> : null}

      <button
        type="button"
        disabled={loading || !publicKey}
        onClick={() => void handleSend()}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {loading ? "Processing…" : "Shielded send"}
      </button>
    </section>
  );
}
