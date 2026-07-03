"use client";

import { useEffect, useState } from "react";
import { formatMnemonicWords } from "@/lib/mnemonic-wallet";
import { deriveShieldedReceiveBundle } from "@/lib/shielded-keys";
import { bumpAddressIndex } from "@/lib/note-store";
import { useSecretsStore } from "@/store/useSecretsStore";
import { useWalletStore } from "@/store/useWalletStore";

export function WalletSetupPanel() {
  const { publicKey } = useWalletStore();
  const {
    unlocked,
    unlocking,
    hasEncryptedWallet,
    unlock,
    createWallet,
    importMnemonic,
    refreshWalletStatus,
    requireSeed,
  } = useSecretsStore();

  const [mnemonicWords, setMnemonicWords] = useState<string[] | null>(null);
  const [importText, setImportText] = useState("");
  const [receiveAddress, setReceiveAddress] = useState<string | null>(null);
  const [addressLoading, setAddressLoading] = useState(false);
  const [ivk, setIvk] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refreshWalletStatus();
  }, [publicKey, refreshWalletStatus]);

  useEffect(() => {
    if (!unlocked) {
      setReceiveAddress(null);
      setIvk(null);
      return;
    }
    void (async () => {
      setAddressLoading(true);
      try {
        const seed = requireSeed();
        const bundle = await deriveShieldedReceiveBundle(seed, "0");
        setReceiveAddress(bundle.address);
        setIvk(bundle.incomingViewingKeyHex);
      } catch (err) {
        setReceiveAddress(null);
        setIvk(null);
        setError(
          err instanceof Error ? err.message : "Failed to derive shielded address"
        );
      } finally {
        setAddressLoading(false);
      }
    })();
  }, [unlocked, requireSeed]);

  async function handleCreate() {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const { mnemonic } = await createWallet();
      setMnemonicWords(formatMnemonicWords(mnemonic));
      setStatus(
        "Wallet created — one recovery phrase controls both your G address and shielded funds. Save it offline."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create wallet failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      await importMnemonic(importText);
      setImportText("");
      setStatus("Wallet imported");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlock() {
    setError(null);
    setBusy(true);
    try {
      await unlock();
      setStatus("Wallet unlocked");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unlock failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleNewAddress() {
    if (!publicKey || !unlocked) return;
    setBusy(true);
    setError(null);
    try {
      const index = await bumpAddressIndex(publicKey);
      const seed = requireSeed();
      const bundle = await deriveShieldedReceiveBundle(seed, String(index));
      setReceiveAddress(bundle.address);
      setStatus(`New receive address (#${index})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate address");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!receiveAddress) return;
    await navigator.clipboard.writeText(receiveAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mb-6 rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
      <h3 className="text-sm font-medium text-violet-200">ZK Stellar wallet</h3>
      <p className="mt-1 text-xs text-zinc-400">
        One BIP39 recovery phrase derives your Stellar <span className="font-mono">G…</span>{" "}
        account and <span className="font-mono">zkstellar…</span> shielded addresses. Passkey
        encrypts it at rest in this browser.
      </p>

      {publicKey ? (
        <p className="mt-2 break-all font-mono text-xs text-emerald-300/90">{publicKey}</p>
      ) : null}

      {!hasEncryptedWallet ? (
        <div className="mt-4 space-y-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCreate()}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-500 disabled:opacity-50"
          >
            Create new wallet
          </button>
          <div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="Or paste 24-word recovery phrase"
              rows={3}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs"
            />
            <button
              type="button"
              disabled={busy || !importText.trim()}
              onClick={() => void handleImport()}
              className="mt-2 rounded-lg border border-violet-500/30 px-3 py-1.5 text-sm text-violet-200 hover:bg-violet-500/10 disabled:opacity-50"
            >
              Import recovery phrase
            </button>
          </div>
        </div>
      ) : !unlocked ? (
        <button
          type="button"
          disabled={busy || unlocking}
          onClick={() => void handleUnlock()}
          className="mt-4 rounded-lg bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {unlocking ? "Waiting for passkey…" : "Unlock wallet"}
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-emerald-300">Unlocked</p>
          <div>
            <p className="text-xs font-medium text-violet-200/90">
              Shielded receive address
            </p>
            {addressLoading ? (
              <p className="mt-1 text-xs text-zinc-500">Deriving zkstellar address…</p>
            ) : receiveAddress ? (
              <p className="mt-1 break-all font-mono text-xs text-zinc-300">
                {receiveAddress}
              </p>
            ) : (
              <p className="mt-1 text-xs text-zinc-500">Not available</p>
            )}
          </div>
          {receiveAddress ? (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="rounded-lg border border-violet-500/30 px-3 py-1.5 text-sm text-violet-200 hover:bg-violet-500/10"
                >
                  {copied ? "Copied" : "Copy shielded address"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleNewAddress()}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"
                >
                  New address (diversifier)
                </button>
              </div>
            </>
          ) : null}
          {ivk ? (
            <p className="text-xs text-zinc-500">
              Viewing key (audit): <span className="font-mono">{ivk.slice(0, 16)}…</span>
            </p>
          ) : null}
        </div>
      )}

      {mnemonicWords ? (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-xs font-medium text-amber-200">Write down these 24 words</p>
          <p className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 font-mono text-xs text-zinc-200 sm:grid-cols-4">
            {mnemonicWords.map((word, i) => (
              <span key={word + i}>
                {i + 1}. {word}
              </span>
            ))}
          </p>
        </div>
      ) : null}

      {status ? <p className="mt-3 text-sm text-emerald-300">{status}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
