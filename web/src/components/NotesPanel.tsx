"use client";

import { useEffect, useRef, useState } from "react";
import type { Note } from "@/lib/note";
import { exportVaultJson, importVaultJson, loadVault } from "@/lib/note-store";
import { rescanVaultFromChain } from "@/lib/rescan-vault";
import { formatError } from "@/lib/format-error";
import { persistFullVault, useWalletStore } from "@/store/useWalletStore";
import { useSecretsStore } from "@/store/useSecretsStore";
import { WalletSetupPanel } from "@/components/WalletSetupPanel";

function formatStroops(value: bigint): string {
  const whole = value / 10_000_000n;
  const frac = value % 10_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(7, "0").replace(/0+$/, "")}`;
}

export function NotesPanel() {
  const { notes, chainCommitments, publicKey, refreshNotes } = useWalletStore();
  const { unlocked, rootSeed, unlock } = useSecretsStore();

  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);

  useEffect(() => {
    if (!publicKey) return;
    void loadVault(publicKey);
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
    anchor.download = `zk-utxo-vault-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Vault exported (metadata only — recovery phrase not included)");
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
      setError("Connect wallet first");
      return;
    }
    setRescanning(true);
    try {
      let seed = rootSeed;
      if (!seed) {
        setStatus("Unlocking…");
        seed = await unlock();
      }
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
        `Rescan done: ${result.notesAdded} received note(s), ${result.eventsParsed} events`
      );
    } catch (err) {
      setError(formatError(err));
    } finally {
      setRescanning(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <WalletSetupPanel />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Local note vault</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleRescan()}
            disabled={rescanning}
            className="rounded-lg border border-violet-500/30 px-3 py-1.5 text-sm text-violet-200 hover:bg-violet-500/10 disabled:opacity-50"
          >
            {rescanning ? "Scanning…" : "Rescan from chain"}
          </button>
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
          ? `${notes.length} notes for ${publicKey.slice(0, 6)}…${publicKey.slice(-6)} · ${chainCommitments.filter(Boolean).length} commitments`
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
  const sourceLabel = note.received ? "received" : "self";

  return (
    <li className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <span>{formatStroops(note.value)} XLM</span>
        <span className="text-zinc-400">
          {note.status} · leaf {note.leafIndex} · d={note.diversifier} · {sourceLabel}
        </span>
      </div>
      <p className="mt-1 truncate font-mono text-xs text-zinc-500">{note.commitment}</p>
    </li>
  );
}
