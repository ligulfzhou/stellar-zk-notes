"use client";

import { useEffect, useState } from "react";
import { signTransactionXdr } from "@/lib/wallet";
import { PasskeySetupModal } from "@/components/PasskeySetupModal";
import { createNote } from "@/lib/note";
import { deriveAndAllocateNoteSecrets, loadVault } from "@/lib/note-store";
import { hasPasskey } from "@/lib/note-types";
import {
  computeCommitmentV2,
  depositSecretToHex,
} from "@/lib/commitment-v2";
import { deriveDepositSecretFromSeed } from "@/lib/root-seed";
import { joinPoolOnVault, getVaultLeafCount } from "@/lib/stellar";
import { stellarExpertTxUrl } from "@/lib/explorer";
import { formatError } from "@/lib/format-error";
import { MIN_POOL_SIZE_TESTNET, POOLS } from "@/lib/pool-config";
import { PrivacyBadge } from "@/components/PrivacyBadge";
import { upsertPoolChainCommitment } from "@/lib/vault-events";
import { persistVaultState, useWalletStore } from "@/store/useWalletStore";
import { usePasskeyStore } from "@/store/usePasskeyStore";

export function JoinPanel() {
  const { publicKey, notes, poolChainCommitments, refreshNotes } = useWalletStore();
  const { unlocked, unlock, registerPrimary, rootSeed, requireSeed } = usePasskeyStore();
  const [poolId, setPoolId] = useState(0);
  const [poolLeafCount, setPoolLeafCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    leafIndex: number;
    derivationIndex: number;
    txHash: string;
    poolId: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  const selectedPool = POOLS.find((p) => p.id === poolId) ?? POOLS[0]!;

  useEffect(() => {
    void (async () => {
      if (!publicKey) {
        setPoolLeafCount(null);
        return;
      }
      try {
        setPoolLeafCount(await getVaultLeafCount(publicKey, poolId));
      } catch {
        setPoolLeafCount(null);
      }
    })();
  }, [publicKey, poolId, success?.txHash]);

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

  async function runJoin() {
    if (!publicKey) {
      setError("Connect wallet first");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    setStatus("Deriving note secrets from passkey…");

    try {
      await ensurePasskeyReady();

      const derived = await deriveAndAllocateNoteSecrets(publicKey);
      const { secret, nullifierSecret, derivationIndex } = derived;
      const seed = rootSeed ?? requireSeed();
      const depositSecret = deriveDepositSecretFromSeed(seed, derivationIndex);
      const valueStroops = selectedPool.stroops;

      setStatus("Computing commitment v2 (browser)…");
      const commitmentHex = await computeCommitmentV2({
        valueStroops,
        secret,
        nullifierSecret,
        depositSecret,
        poolId,
      });

      setStatus("Signing join transaction…");
      const { txHash, leafIndex } = await joinPoolOnVault({
        sourcePublicKey: publicKey,
        poolId,
        commitmentHex,
        signTransaction: async (xdr) => signTransactionXdr(xdr, publicKey),
      });

      const note = await createNote({
        valueStroops,
        poolId,
        ownerPubkey: publicKey,
        secret,
        nullifierSecret,
        depositSecretHex: depositSecretToHex(depositSecret),
        commitmentHex,
        leafIndex,
        derivationIndex,
      });

      await persistVaultState(
        [...notes, note],
        upsertPoolChainCommitment(
          poolChainCommitments,
          poolId,
          leafIndex,
          commitmentHex
        )
      );
      await refreshNotes();

      setStatus(null);
      setSuccess({ leafIndex, derivationIndex, txHash, poolId });
    } catch (err) {
      if (err instanceof Error && err.message === "PASSKEY_SETUP") {
        setStatus(null);
      } else {
        setError(formatError(err) || "Join failed");
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
      await runJoin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey setup failed");
      setLoading(false);
    }
  }

  const anonymityHint =
    poolLeafCount === null
      ? "—"
      : poolLeafCount >= MIN_POOL_SIZE_TESTNET
        ? `${poolLeafCount} notes in pool (spend enabled)`
        : `${poolLeafCount} / ${MIN_POOL_SIZE_TESTNET} min for private spend`;

  return (
    <>
      {showSetup ? (
        <PasskeySetupModal
          onComplete={() => void handleSetupPasskey()}
          onCancel={() => setShowSetup(false)}
        />
      ) : null}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="mb-4 text-lg font-medium">Join shielded pool</h2>
        <p className="mb-4 text-sm text-zinc-400">
          Fixed-denomination join — only pool id, commitment, and leaf index appear
          on-chain. Note secrets come from your passkey (WebAuthn PRF).
        </p>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <PrivacyBadge poolLeafCount={poolLeafCount} poolLabel={selectedPool.label} />
        </div>
        <p className="mb-4 text-xs text-violet-300/90">
          Pool anonymity set: {anonymityHint}
        </p>
        <label className="mb-2 block text-sm text-zinc-300">Denomination</label>
        <div className="mb-4 flex flex-wrap gap-2">
          {POOLS.map((pool) => (
            <button
              key={pool.id}
              type="button"
              onClick={() => setPoolId(pool.id)}
              className={`rounded-lg px-3 py-2 text-sm ${
                poolId === pool.id
                  ? "bg-violet-600 text-white"
                  : "border border-white/10 bg-black/30 text-zinc-300 hover:bg-white/5"
              }`}
            >
              {pool.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void runJoin()}
          disabled={loading}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {loading ? "Processing…" : `Join ${selectedPool.label} pool`}
        </button>
        {success ? (
          <p className="mt-4 text-sm text-emerald-300">
            Joined pool {success.poolId} (leaf {success.leafIndex}, passkey #
            {success.derivationIndex}). Tx:{" "}
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
