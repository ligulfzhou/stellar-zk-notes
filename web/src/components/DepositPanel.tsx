"use client";

import { useState } from "react";
import { signTransactionXdr } from "@/lib/wallet";
import { PasskeySetupModal } from "@/components/PasskeySetupModal";
import { createNote } from "@/lib/note";
import { deriveAndAllocateNoteSecrets, loadVault } from "@/lib/note-store";
import { hasPasskey } from "@/lib/note-types";
import { stroopsFromXlm } from "@/lib/field";
import { depositToVault, ensureAccountOnNetwork } from "@/lib/stellar";
import { stellarExpertTxUrl } from "@/lib/explorer";
import { formatError } from "@/lib/format-error";
import { upsertChainCommitment } from "@/lib/vault-events";
import { persistVaultState, useWalletStore } from "@/store/useWalletStore";
import { usePasskeyStore } from "@/store/usePasskeyStore";

export function DepositPanel() {
  const { publicKey, notes, chainCommitments, refreshNotes } = useWalletStore();
  const { unlocked, unlock, registerPrimary } = usePasskeyStore();
  const [amount, setAmount] = useState("1");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    leafIndex: number;
    derivationIndex: number;
    txHash: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  async function ensurePasskeyReady(): Promise<void> {
    if (!publicKey) {
      throw new Error("Connect wallet first");
    }
    const vault = await loadVault(publicKey);
    if (!hasPasskey(vault)) {
      setShowSetup(true);
      throw new Error("PASSKEY_SETUP");
    }
    if (!unlocked) {
      await unlock();
    }
  }

  async function runDeposit() {
    if (!publicKey) {
      setError("Connect wallet first");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    setStatus("Deriving note secrets from passkey…");

    try {
      setStatus("Funding testnet account if needed…");
      await ensureAccountOnNetwork(publicKey);

      setStatus("Deriving note secrets from passkey…");
      await ensurePasskeyReady();

      const valueStroops = stroopsFromXlm(amount);
      if (valueStroops <= 0n) {
        throw new Error("Enter a positive amount");
      }

      const derived = await deriveAndAllocateNoteSecrets(publicKey);
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
        signTransaction: async (xdr) => signTransactionXdr(xdr, publicKey),
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
        upsertChainCommitment(chainCommitments, leafIndex, data.commitment)
      );
      await refreshNotes();

      setStatus(null);
      setSuccess({ leafIndex, derivationIndex, txHash });
    } catch (err) {
      if (err instanceof Error && err.message === "PASSKEY_SETUP") {
        setStatus(null);
      } else {
        setError(formatError(err) || "Deposit failed");
        setStatus(null);
        setSuccess(null);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSetupPasskey() {
    setShowSetup(false);
    setLoading(true);
    setError(null);
    try {
      await registerPrimary("Primary passkey");
      await runDeposit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey setup failed");
      setLoading(false);
    }
  }

  return (
    <>
      {showSetup ? (
        <PasskeySetupModal
          onComplete={() => void handleSetupPasskey()}
          onCancel={() => setShowSetup(false)}
        />
      ) : null}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="mb-4 text-lg font-medium">Deposit to shielded note</h2>
        <p className="mb-4 text-sm text-zinc-400">
          Note secrets are derived from your passkey (WebAuthn PRF). Only the commitment goes
          on-chain. Create a passkey in Notes if you have not yet.
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
          onClick={() => void runDeposit()}
          disabled={loading}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {loading ? "Processing…" : "Deposit"}
        </button>
        {success ? (
          <p className="mt-4 text-sm text-emerald-300">
            Deposited (leaf {success.leafIndex}, passkey #{success.derivationIndex}). Tx:{" "}
            <a
              href={stellarExpertTxUrl(success.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-emerald-400/60 underline-offset-2 hover:text-emerald-200"
            >
              {success.txHash.slice(0, 12)}…
            </a>
          </p>
        ) : null}
        {status ? <p className="mt-4 text-sm text-emerald-300">{status}</p> : null}
        {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
      </section>
    </>
  );
}
