"use client";

import { useEffect, useState } from "react";
import { signTransactionXdr } from "@/lib/wallet";
import { createNote } from "@/lib/note";
import { randomField } from "@/lib/field";
import { encryptNoteForRecipient } from "@/lib/ecdh-delivery";
import { deriveAndAllocateNoteSecrets } from "@/lib/note-store";
import { resolveNoteSecretsFromVault } from "@/lib/note-secrets";
import {
  buildPaymentEnvelope,
  downloadPaymentEnvelope,
} from "@/lib/payment-envelope";
import { proofBytesFromHex } from "@/lib/proof";
import {
  isZk1Address,
  parseZk1Address,
} from "@/lib/shielded-keys";
import { encodePublicInputs, shieldedSendToVault } from "@/lib/stellar";
import { formatError } from "@/lib/format-error";
import { upsertChainCommitment } from "@/lib/vault-events";
import { persistVaultState, useWalletStore } from "@/store/useWalletStore";
import { usePasskeyStore } from "@/store/usePasskeyStore";

export function SendPanel() {
  const { publicKey, notes, chainCommitments, refreshNotes } = useWalletStore();
  const { unlocked, unlock } = usePasskeyStore();
  const [noteId, setNoteId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unspent = notes.filter((n) => n.status === "unspent");
  const recipientTrimmed = recipient.trim();
  const sendToSelf = Boolean(
    publicKey && recipientTrimmed && publicKey === recipientTrimmed
  );
  const zk1Recipient = isZk1Address(recipientTrimmed);
  const parsedZk1 = zk1Recipient ? parseZk1Address(recipientTrimmed) : null;

  useEffect(() => {
    if (publicKey && !recipient) setRecipient(publicKey);
  }, [publicKey, recipient]);

  async function handleSend() {
    if (!publicKey) {
      setError("Connect wallet first");
      return;
    }
    const note = unspent.find((n) => n.id === noteId);
    if (!note) {
      setError("Select a note to spend");
      return;
    }
    if (!recipientTrimmed.startsWith("G") && !zk1Recipient) {
      setError("Enter zk1… shielded address or Stellar G… (self)");
      return;
    }
    if (recipientTrimmed.startsWith("G") && recipientTrimmed.length !== 56) {
      setError("Stellar address must be 56 characters (G…)");
      return;
    }
    if (zk1Recipient && !parsedZk1) {
      setError("Invalid zk1 address");
      return;
    }

    setLoading(true);
    setError(null);
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

      setStatus("Generating ZK witness…");
      const spendSecrets = await resolveNoteSecretsFromVault(note);

      let newSecret: string;
      let newNullifierSecret: string;
      let newDerivationIndex: number | undefined;

      if (sendToSelf) {
        const derived = await deriveAndAllocateNoteSecrets(publicKey!);
        newSecret = derived.secret;
        newNullifierSecret = derived.nullifierSecret;
        newDerivationIndex = derived.derivationIndex;
      } else {
        newSecret = randomField();
        newNullifierSecret = randomField();
      }

      const proveRes = await fetch("/api/prove-spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "shielded_send",
          value: note.value.toString(),
          secret: spendSecrets.secret,
          nullifierSecret: spendSecrets.nullifierSecret,
          leafIndex: note.leafIndex,
          leafCount: chainData.leafCount ?? chain.length,
          onChainMerkleRoot: chainData.merkleRoot ?? undefined,
          commitments: chain,
          noteCommitment: note.commitment,
          treeState: chainData.treeState ?? undefined,
          newSecret,
          newNullifierSecret,
        }),
      });
      const prove = (await proveRes.json()) as {
        error?: string;
        merkleRoot?: string;
        nullifier?: string;
        newCommitment?: string;
        publicInputs?: Record<string, string>;
        proofHex?: string | null;
        proofReady?: boolean;
      };
      if (!proveRes.ok || !prove.merkleRoot || !prove.publicInputs) {
        throw new Error(prove.error ?? "Prove API failed");
      }

      const leafIndex = chainData.leafCount ?? chain.length;
      let epkBytes: Uint8Array | undefined;
      let encryptedNoteBytes: Uint8Array | undefined;

      if (parsedZk1) {
        const enc = encryptNoteForRecipient(parsedZk1.publicKey, {
          value: note.value.toString(),
          secret: newSecret,
          nullifierSecret: newNullifierSecret,
          commitment: prove.newCommitment!,
          leafIndex,
        });
        epkBytes = enc.epk;
        encryptedNoteBytes = enc.encrypted;
      }

      setStatus("Submitting shielded send…");
      const publicInputs = encodePublicInputs({
        merkleRootHex: prove.merkleRoot,
        nullifierHex: prove.nullifier!,
        newCommitmentHex: prove.newCommitment!,
        publicAmount: prove.publicInputs.public_amount,
        mode: prove.publicInputs.mode,
      });

      const txHash = await shieldedSendToVault({
        sourcePublicKey: publicKey,
        nullifierHex: prove.nullifier!,
        newCommitmentHex: prove.newCommitment!,
        merkleRootHex: prove.merkleRoot,
        publicInputs,
        proofBytes: proofBytesFromHex(prove.proofHex),
        epkBytes,
        encryptedNoteBytes,
        signTransaction: async (xdr) => signTransactionXdr(xdr, publicKey),
      });

      const updatedNotes = notes.map((n) =>
        n.id === note.id ? { ...n, status: "spent" as const } : n
      );
      const updatedChain = upsertChainCommitment(
        chain,
        leafIndex,
        prove.newCommitment!
      );

      if (sendToSelf) {
        const recipientNote = await createNote({
          valueStroops: note.value,
          ownerPubkey: publicKey,
          secret: newSecret,
          nullifierSecret: newNullifierSecret,
          commitmentHex: prove.newCommitment!,
          leafIndex,
          derivationIndex: newDerivationIndex,
        });
        updatedNotes.push(recipientNote);
      }

      await persistVaultState(updatedNotes, updatedChain);
      await refreshNotes();

      if (parsedZk1) {
        setStatus(
          `Sent to zk1 address on-chain (encrypted). Tx: ${txHash.slice(0, 12)}…`
        );
      } else if (!sendToSelf) {
        downloadPaymentEnvelope(
          buildPaymentEnvelope({
            recipient: recipientTrimmed,
            sender: publicKey,
            valueStroops: note.value,
            secret: newSecret,
            nullifierSecret: newNullifierSecret,
            commitment: prove.newCommitment!,
            leafIndex,
            txHash,
          })
        );
        setStatus(
          `Sent to G… address. Payment file downloaded. Tx: ${txHash.slice(0, 12)}…`
        );
      } else {
        setStatus(`Sent. Tx: ${txHash.slice(0, 12)}…`);
      }
    } catch (err) {
      setError(formatError(err) || "Send failed");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <h2 className="mb-4 text-lg font-medium">Shielded send</h2>
      <label className="mb-2 block text-sm text-zinc-300">Note to spend</label>
      <select
        value={noteId}
        onChange={(e) => setNoteId(e.target.value)}
        className="mb-4 w-full max-w-md rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
      >
        <option value="">Select…</option>
        {unspent.map((n) => (
          <option key={n.id} value={n.id}>
            {Number(n.value) / 1e7} XLM — leaf {n.leafIndex}
            {n.derivationIndex !== undefined ? ` · #${n.derivationIndex}` : ""}
          </option>
        ))}
      </select>
      <label className="mb-2 block text-sm text-zinc-300">
        Recipient (zk1… preferred, or G… for self)
      </label>
      <input
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
        placeholder="zk1:testnet:… or G…"
        className="mb-4 w-full max-w-md rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-mono"
      />
      {publicKey ? (
        <button
          type="button"
          onClick={() => setRecipient(publicKey)}
          className="mb-4 text-xs text-violet-300 hover:underline"
        >
          Use my address (self-send)
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => void handleSend()}
        disabled={loading || unspent.length === 0}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
      >
        {loading ? "Processing…" : "Shielded send"}
      </button>
      {status ? <p className="mt-4 text-sm text-emerald-300">{status}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
      <p className="mt-4 text-xs text-zinc-500">
        zk1: on-chain encrypted delivery. G… (not self): payment file fallback.
      </p>
    </section>
  );
}
