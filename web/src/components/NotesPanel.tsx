"use client";

import { useEffect, useRef, useState } from "react";
import type { Note } from "@/lib/note";
import { exportVaultJson, importVaultJson, loadVault } from "@/lib/note-store";
import { rescanVaultFromChain } from "@/lib/rescan-vault";
import { formatError } from "@/lib/format-error";
import { isPlatformAuthenticatorAvailable, passkeyOriginHint } from "@/lib/passkey";
import { persistFullVault, useWalletStore } from "@/store/useWalletStore";
import { usePasskeyStore } from "@/store/usePasskeyStore";

function formatStroops(value: bigint): string {
  const whole = value / 10_000_000n;
  const frac = value % 10_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(7, "0").replace(/0+$/, "")}`;
}

export function NotesPanel() {
  const { notes, poolChainCommitments, publicKey, refreshNotes } = useWalletStore();
  const {
    unlocked,
    unlocking,
    unlock,
    registerRecovery,
    rootSeed,
  } = usePasskeyStore();

  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [platformOk, setPlatformOk] = useState(true);
  const originHint = passkeyOriginHint();

  useEffect(() => {
    void (async () => {
      if (!publicKey) {
        return;
      }
      await loadVault(publicKey);
      setPlatformOk(await isPlatformAuthenticatorAvailable());
    })();
  }, [publicKey, unlocked, rootSeed, notes.length]);

  async function handleExport() {
    setError(null);
    if (!publicKey) {
      setError("Connect wallet first");
      return;
    }
    const json = await exportVaultJson(publicKey);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `zk-tornado-vault-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Vault exported (metadata only — secrets stay in passkey)");
  }

  async function handleImport(file: File) {
    setError(null);
    setStatus(null);
    try {
      const text = await file.text();
      const vault = importVaultJson(text);
      await persistFullVault(vault);
      await refreshNotes();
      setStatus(`Imported ${vault.notes.length} notes`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    }
  }

  async function handleRescan() {
    setError(null);
    setStatus(null);
    if (!publicKey) {
      setError("Connect wallet first (needed to read chain state)");
      return;
    }

    let seed = rootSeed;
    if (!seed) {
      try {
        seed = await unlock();
      } catch {
        setError("Unlock passkey first to rescan deposits");
        return;
      }
    }

    setRescanning(true);
    setStatus("Scanning vault events on-chain…");
    try {
      const existing = await loadVault(publicKey);
      const result = await rescanVaultFromChain({
        ownerPubkey: publicKey,
        rootSeed: seed,
        existingVault: existing,
        onProgress: (msg) => setStatus(msg),
      });
      await persistFullVault(result.vault);
      await refreshNotes();
      setStatus(
        `Rescan done: ${result.joinsMatched} deposit(s) recovered, ` +
          `pool-0 ${result.vault.poolChainCommitments[0]?.length ?? 0} commitments, ` +
          `${result.eventsParsed} events` +
          (result.joinsSkipped
            ? ` (${result.joinsSkipped} deposit(s) unmatched)`
            : "")
      );
    } catch (err) {
      setError(formatError(err) || "Rescan failed");
      setStatus(null);
    } finally {
      setRescanning(false);
    }
  }

  async function handleUnlockPasskey() {
    setError(null);
    try {
      await unlock();
      await refreshNotes();
      setStatus("Passkey unlocked");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey unlock failed");
    }
  }

  async function handleAddRecovery() {
    setError(null);
    try {
      if (!unlocked) await unlock();
      await registerRecovery("Recovery passkey");
      setStatus("Recovery passkey added — can unwrap wallet on another device");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recovery passkey failed");
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="mb-6 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
        <h3 className="text-sm font-medium text-sky-200">Passkey wallet</h3>
        <p className="mt-1 text-xs text-zinc-400">
          Note secrets are derived from your device passkey (WebAuthn PRF). Unlock
          with biometrics to deposit or exit. On a new device: same synced passkey,
          or add a recovery passkey, then Rescan from chain.
        </p>
        <p className="mt-2 text-sm text-zinc-300">
          Status: {unlocked ? "🔓 unlocked" : "🔒 locked"}
        </p>
        {!platformOk ? (
          <p className="mt-1 text-xs text-amber-300">
            Platform authenticator not detected. Use Safari 17+ or Chrome 118+ on macOS/iOS.
          </p>
        ) : null}
        {originHint ? (
          <p className="mt-1 text-xs text-amber-300">{originHint}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {!unlocked ? (
            <button
              type="button"
              onClick={() => void handleUnlockPasskey()}
              disabled={unlocking}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {unlocking ? "Waiting…" : "Unlock passkey"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleAddRecovery()}
              className="rounded-lg border border-sky-500/30 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-500/10"
            >
              Add recovery passkey
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleRescan()}
            disabled={rescanning}
            className="rounded-lg border border-violet-500/30 px-3 py-1.5 text-sm text-violet-200 hover:bg-violet-500/10 disabled:opacity-50"
          >
            {rescanning ? "Scanning…" : "Rescan from chain"}
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Local note vault</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleExport()}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10"
          >
            Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <p className="mb-4 text-xs text-zinc-500">
        {publicKey
          ? `${notes.length} notes for ${publicKey.slice(0, 6)}…${publicKey.slice(-6)} · pool-0 ${poolChainCommitments[0]?.length ?? 0} commitments`
          : "Connect wallet to view account notes"}
      </p>

      {notes.length === 0 ? (
        <p className="text-sm text-zinc-400">No notes stored yet. Deposit to create one.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} formatStroops={formatStroops} />
          ))}
        </ul>
      )}

      {status ? <p className="mt-4 text-sm text-emerald-300">{status}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
    </section>
  );
}

function NoteRow({
  note,
  formatStroops,
}: {
  note: Note;
  formatStroops: (v: bigint) => string;
}) {
  const deriveLabel =
    note.derivationIndex !== undefined
      ? `passkey #${note.derivationIndex}`
      : "legacy";

  return (
    <li className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <span>{formatStroops(note.value)} XLM</span>
        <span className="text-zinc-400">
          {note.status} · pool {note.poolId} · leaf {note.leafIndex} · {deriveLabel}
        </span>
      </div>
      <p className="mt-1 truncate font-mono text-xs text-zinc-500">{note.commitment}</p>
    </li>
  );
}
