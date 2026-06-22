import { useRef, useState, type ReactNode } from "react";
import { signTransactionXdr } from "@/lib/wallet";
import { createNote } from "@/lib/note";
import { randomField } from "@/lib/field";
import { encryptNoteForRecipient } from "@/lib/ecdh-delivery";
import { deriveAndAllocateNoteSecrets } from "@/lib/note-store";
import { resolveNoteSecretsFromVault } from "@/lib/note-secrets";
import { proveWitness } from "@/lib/prove-client";
import type { ProvePhase } from "@/lib/prover-client";
import { ProveProgress } from "@/components/ProveProgress";
import { buildTransferWitness, MAX_ACTION_SLOTS } from "@/lib/action-witness";
import { proofBytesFromHex } from "@/lib/proof";
import { isZk1Address } from "@/lib/shielded-keys";
import { resolveReceivePubkey } from "@/lib/shielded-registry";
import { encodePublicInputs, shieldedTransferToVault } from "@/lib/stellar";
import { formatError } from "@/lib/format-error";
import { upsertChainCommitment } from "@/lib/vault-events";
import { persistVaultState, useWalletStore } from "@/store/useWalletStore";
import { usePasskeyStore } from "@/store/usePasskeyStore";
import { TxLink } from "@/components/TxLink";

export function SendPanel() {
  const { publicKey, notes, chainCommitments, refreshNotes } = useWalletStore();
  const { unlocked, unlock } = usePasskeyStore();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sendAmountXlm, setSendAmountXlm] = useState("");
  const [recipientOverride, setRecipientOverride] = useState<string | null>(null);
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
  const recipientTrimmed = (recipientOverride ?? publicKey ?? "").trim();
  const sendToSelf = Boolean(
    publicKey && recipientTrimmed && publicKey === recipientTrimmed
  );

  function toggleNote(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_ACTION_SLOTS) return prev;
      return [...prev, id];
    });
  }

  async function handleSend() {
    if (!publicKey) {
      setError("Connect wallet first");
      return;
    }
    const selected = selectedIds
      .map((id) => unspent.find((n) => n.id === id))
      .filter(Boolean);
    if (selected.length === 0) {
      setError("Select at least one note (up to 4)");
      return;
    }

    if (!recipientTrimmed.startsWith("G") && !isZk1Address(recipientTrimmed)) {
      setError("Enter zk1… shielded address or registered Stellar G…");
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
      const seed = usePasskeyStore.getState().rootSeed;

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

      const noteTotal = selected.reduce((a, n) => a + n!.value, 0n);
      let payeeAmount = noteTotal;
      const trimmed = sendAmountXlm.trim();
      if (trimmed) {
        const xlm = Number(trimmed);
        if (!Number.isFinite(xlm) || xlm <= 0) throw new Error("Invalid send amount");
        payeeAmount = BigInt(Math.round(xlm * 1e7));
        if (payeeAmount <= 0n || payeeAmount > noteTotal) {
          throw new Error("Send amount must be positive and not exceed selected notes");
        }
      }
      const changeAmount = noteTotal - payeeAmount;
      if (selected.length > 1 && changeAmount <= 0n) {
        throw new Error("Multi-note send requires change — send less than the total");
      }

      setStatus("Resolving recipient shielded key…");
      const receivePubkey = await resolveReceivePubkey({
        recipient: recipientTrimmed,
        readerPublicKey: publicKey,
        selfPublicKey: publicKey,
        selfRootSeed: seed,
      });

      setStatus("Building action witness…");
      const inputNotes = await Promise.all(
        selected.map(async (note) => {
          const secrets = await resolveNoteSecretsFromVault(note!);
          return {
            value: note!.value.toString(),
            secret: secrets.secret,
            nullifierSecret: secrets.nullifierSecret,
            leafIndex: note!.leafIndex,
            commitment: note!.commitment,
          };
        })
      );

      let payeeSecret: string;
      let payeeNullifierSecret: string;
      if (sendToSelf) {
        const derived = await deriveAndAllocateNoteSecrets(publicKey);
        payeeSecret = derived.secret;
        payeeNullifierSecret = derived.nullifierSecret;
      } else {
        payeeSecret = randomField();
        payeeNullifierSecret = randomField();
      }

      const outputs: Array<{ value: string; secret: string; nullifierSecret: string }> = [
        {
          value: payeeAmount.toString(),
          secret: payeeSecret,
          nullifierSecret: payeeNullifierSecret,
        },
      ];

      let changeDerived: Awaited<ReturnType<typeof deriveAndAllocateNoteSecrets>> | null = null;
      if (changeAmount > 0n) {
        changeDerived = await deriveAndAllocateNoteSecrets(publicKey);
        outputs.push({
          value: changeAmount.toString(),
          secret: changeDerived.secret,
          nullifierSecret: changeDerived.nullifierSecret,
        });
      }

      const built = await buildTransferWitness({
        inputs: inputNotes,
        outputs,
        leafCount: chainData.leafCount ?? chain.length,
        onChainMerkleRoot: chainData.merkleRoot ?? undefined,
        commitments: chain,
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

      const leafBase = chainData.leafCount ?? chain.length;
      const encPayee = encryptNoteForRecipient(receivePubkey, {
        value: payeeAmount.toString(),
        secret: payeeSecret,
        nullifierSecret: payeeNullifierSecret,
        commitment: built.newCommitmentHexes[0]!,
        leafIndex: leafBase,
      });

      const epks = [encPayee.epk];
      const encs = [encPayee.encrypted];

      if (changeAmount > 0n && changeDerived) {
        const selfReceive = await resolveReceivePubkey({
          recipient: publicKey,
          readerPublicKey: publicKey,
          selfPublicKey: publicKey,
          selfRootSeed: seed,
        });
        const encChange = encryptNoteForRecipient(selfReceive, {
          value: changeAmount.toString(),
          secret: changeDerived.secret,
          nullifierSecret: changeDerived.nullifierSecret,
          commitment: built.newCommitmentHexes[1]!,
          leafIndex: leafBase + 1,
        });
        epks.push(encChange.epk);
        encs.push(encChange.encrypted);
      }

      setStatus("Submitting shielded transfer…");
      const publicInputs = encodePublicInputs({
        merkleRootHex: prove.merkleRoot ?? built.merkleRootHex,
        nullifierHexes: prove.nullifierHexes,
        newCommitmentHexes: built.newCommitmentHexes,
        publicAmount: "0",
      });

      const txHash = await shieldedTransferToVault({
        sourcePublicKey: publicKey,
        nullifierHexes: built.nullifierHexes,
        newCommitmentHexes: built.newCommitmentHexes,
        merkleRootHex: prove.merkleRoot ?? built.merkleRootHex,
        publicInputs,
        proofBytes: proofBytesFromHex(prove.proofHex),
        epkBytes: epks,
        encryptedNoteBytes: encs,
        signTransaction: async (xdr) => signTransactionXdr(xdr, publicKey),
      });

      const spentIds = new Set(selectedIds);
      let updatedNotes = notes.map((n) =>
        spentIds.has(n.id) ? { ...n, status: "spent" as const } : n
      );
      let updatedChain = chain;
      built.newCommitmentHexes.forEach((nc, i) => {
        if (nc !== "0x0") {
          updatedChain = upsertChainCommitment(updatedChain, leafBase + i, nc);
        }
      });

      if (sendToSelf && payeeAmount > 0n) {
        const derived = await deriveAndAllocateNoteSecrets(publicKey);
        updatedNotes.push(
          await createNote({
            valueStroops: payeeAmount,
            ownerPubkey: publicKey,
            secret: payeeSecret,
            nullifierSecret: payeeNullifierSecret,
            commitmentHex: built.newCommitmentHexes[0]!,
            leafIndex: leafBase,
            derivationIndex: derived.derivationIndex,
          })
        );
      }

      if (changeAmount > 0n && changeDerived) {
        updatedNotes.push(
          await createNote({
            valueStroops: changeAmount,
            ownerPubkey: publicKey,
            secret: changeDerived.secret,
            nullifierSecret: changeDerived.nullifierSecret,
            commitmentHex: built.newCommitmentHexes[1]!,
            leafIndex: leafBase + (payeeAmount < noteTotal ? 1 : 0),
            derivationIndex: changeDerived.derivationIndex,
          })
        );
      }

      await persistVaultState(updatedNotes, updatedChain);
      await refreshNotes();

      setStatus(
        <>
          Sent {Number(payeeAmount) / 1e7} XLM
          {changeAmount > 0n ? ` (change ${Number(changeAmount) / 1e7} XLM)` : ""}. Tx:{" "}
          <TxLink txHash={txHash} />
        </>
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Proof cancelled");
        setStatus(null);
        return;
      }
      setError(formatError(err) || "Send failed");
      setStatus(null);
    } finally {
      setLoading(false);
      setProvePhase(null);
      setProveDetail(null);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <h2 className="mb-4 text-lg font-medium">Shielded send</h2>
      <p className="mb-3 text-xs text-zinc-400">
        Action model: select up to {MAX_ACTION_SLOTS} notes, one ZK proof (payee + optional change).
      </p>
      <label className="mb-2 block text-sm text-zinc-300">Notes to spend</label>
      <ul className="mb-4 max-h-48 space-y-2 overflow-y-auto">
        {unspent.map((n) => (
          <li key={n.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={selectedIds.includes(n.id)}
                onChange={() => toggleNote(n.id)}
              />
              {Number(n.value) / 1e7} XLM — leaf {n.leafIndex}
            </label>
          </li>
        ))}
      </ul>
      <label className="mb-2 block text-sm text-zinc-300">
        Amount to send (XLM, empty = full total)
      </label>
      <input
        type="text"
        inputMode="decimal"
        value={sendAmountXlm}
        onChange={(e) => setSendAmountXlm(e.target.value)}
        placeholder="e.g. 0.15"
        className="mb-4 w-full max-w-md rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
      />
      <label className="mb-2 block text-sm text-zinc-300">Recipient (zk1… or G…)</label>
      <input
        value={recipientOverride ?? publicKey ?? ""}
        onChange={(e) => setRecipientOverride(e.target.value)}
        placeholder="zk1:testnet:… or G…"
        className="mb-4 w-full max-w-md rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-mono"
      />
      <button
        type="button"
        onClick={() => void handleSend()}
        disabled={loading || unspent.length === 0}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
      >
        {loading ? "Processing…" : "Shielded transfer"}
      </button>
      {status ? <p className="mt-4 text-sm text-emerald-300">{status}</p> : null}
      <ProveProgress phase={provePhase} detail={proveDetail} onCancel={cancelProve} />
      {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
    </section>
  );
}
