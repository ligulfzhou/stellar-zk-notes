"use client";

import { useEffect, useRef, useState } from "react";
import type { Note } from "@/lib/note";
import {
  encryptWalletMnemonicWithPin,
  exportVaultJson,
  getWalletMnemonic,
  hasEncryptedMnemonic,
  importVaultJson,
  loadVault,
  resolveWalletMnemonic,
  setWalletMnemonic,
  unlockWalletMnemonic,
} from "@/lib/note-store";
import {
  noteFromPaymentEnvelope,
  parsePaymentEnvelope,
} from "@/lib/payment-envelope";
import { rescanVaultFromChain } from "@/lib/rescan-vault";
import {
  deriveShieldedReceiveKeys,
  encodeZk1Address,
} from "@/lib/shielded-keys";
import { persistFullVault, persistVaultState, useWalletStore } from "@/store/useWalletStore";

function formatStroops(value: bigint): string {
  const whole = value / 10_000_000n;
  const frac = value % 10_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(7, "0").replace(/0+$/, "")}`;
}

export function NotesPanel() {
  const { notes, chainCommitments, hasMnemonic, publicKey, refreshNotes } =
    useWalletStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const paymentRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importPhrase, setImportPhrase] = useState("");
  const [showPhraseImport, setShowPhraseImport] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [zk1Address, setZk1Address] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [encryptedOnly, setEncryptedOnly] = useState(false);

  useEffect(() => {
    void (async () => {
      setEncryptedOnly(await hasEncryptedMnemonic());
      const mnemonic = await getWalletMnemonic();
      if (mnemonic) {
        const keys = deriveShieldedReceiveKeys(mnemonic);
        setZk1Address(encodeZk1Address(keys.publicKey));
      } else {
        setZk1Address(null);
      }
    })();
  }, [hasMnemonic]);

  async function handleExport(includeMnemonic: boolean) {
    setError(null);
    const json = await exportVaultJson(includeMnemonic);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `zk-notes-vault-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(includeMnemonic ? "Full vault exported (includes phrase)" : "Vault exported");
  }

  async function handleImportPayment(file: File) {
    setError(null);
    setStatus(null);
    try {
      const text = await file.text();
      const envelope = parsePaymentEnvelope(text);
      if (publicKey && envelope.recipient !== publicKey) {
        throw new Error("Payment file is for a different Stellar address");
      }
      const incoming = await noteFromPaymentEnvelope(envelope);
      const vault = await loadVault();
      const hasCommitment = vault.chainCommitments.includes(envelope.commitment);
      const chain = hasCommitment
        ? vault.chainCommitments
        : [...vault.chainCommitments, envelope.commitment];
      const already = vault.notes.some((n) => n.commitment === envelope.commitment);
      const updatedNotes = already ? vault.notes : [...vault.notes, incoming];
      await persistVaultState(updatedNotes, chain);
      await refreshNotes();
      setStatus(
        already
          ? "Payment already in vault"
          : `Received ${Number(envelope.value) / 1e7} XLM shielded payment`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import payment failed");
    }
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
      setError("Connect Freighter first (needed to read chain state)");
      return;
    }
    const mnemonic =
      (await resolveWalletMnemonic(pin)) ??
      (await getWalletMnemonic()) ??
      importPhrase;
    if (!mnemonic.trim()) {
      setError("Import recovery phrase first, then rescan");
      return;
    }
    setRescanning(true);
    setStatus("Scanning vault events on-chain…");
    try {
      const existing = await loadVault();
      const result = await rescanVaultFromChain({
        mnemonic,
        ownerPubkey: publicKey,
        existingVault: existing,
        onProgress: (msg) => setStatus(msg),
      });
      await persistFullVault(result.vault);
      await refreshNotes();
      setStatus(
        `Rescan done: ${result.depositsMatched} deposit(s) recovered, ` +
          `${result.vault.chainCommitments.length} commitments, ` +
          `${result.eventsParsed} events` +
          (result.depositsSkipped
            ? ` (${result.depositsSkipped} deposit(s) need payment file / legacy JSON)`
            : "")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rescan failed");
      setStatus(null);
    } finally {
      setRescanning(false);
    }
  }

  async function handleEncryptPin() {
    setError(null);
    try {
      await encryptWalletMnemonicWithPin(pin);
      setPin("");
      setEncryptedOnly(true);
      setZk1Address(null);
      await refreshNotes();
      setStatus("Recovery phrase encrypted with PIN");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Encrypt failed");
    }
  }

  async function handleUnlockPin() {
    setError(null);
    try {
      const mnemonic = await unlockWalletMnemonic(pin);
      const keys = deriveShieldedReceiveKeys(mnemonic);
      setZk1Address(encodeZk1Address(keys.publicKey));
      setEncryptedOnly(false);
      setPin("");
      await refreshNotes();
      setStatus("Recovery phrase unlocked for this session");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unlock failed");
    }
  }

  async function handleCopyZk1() {
    if (!zk1Address) return;
    await navigator.clipboard.writeText(zk1Address);
    setStatus("zk1 address copied");
  }

  async function handleImportPhrase() {
    setError(null);
    try {
      await setWalletMnemonic(importPhrase);
      const mnemonic = (await getWalletMnemonic())!;
      setImportPhrase("");
      setShowPhraseImport(false);
      const keys = deriveShieldedReceiveKeys(mnemonic);
      setZk1Address(encodeZk1Address(keys.publicKey));
      setEncryptedOnly(false);
      await refreshNotes();
      setStatus("Recovery phrase imported");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid phrase");
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="mb-6 rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
        <h3 className="text-sm font-medium text-violet-200">Recovery phrase</h3>
        <p className="mt-1 text-xs text-zinc-400">
          12 words derive deposit secrets. On a new browser: import phrase →{" "}
          <strong className="font-normal text-zinc-300">Rescan from chain</strong> rebuilds
          your deposits and <code className="text-zinc-300">chainCommitments</code>. Payment
          files still needed for notes others sent you.
        </p>
        <p className="mt-2 text-sm text-zinc-300">
          Status:{" "}
          {encryptedOnly
            ? "🔒 PIN-encrypted"
            : hasMnemonic
              ? "✓ active"
              : "not set — created on first deposit"}
        </p>

        {zk1Address ? (
          <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <p className="text-xs text-emerald-200">Shielded receive address (zk1)</p>
            <p className="mt-1 break-all font-mono text-xs text-zinc-200">{zk1Address}</p>
            <button
              type="button"
              onClick={() => void handleCopyZk1()}
              className="mt-2 rounded-lg border border-emerald-500/30 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-500/10"
            >
              Copy zk1
            </button>
          </div>
        ) : encryptedOnly ? (
          <p className="mt-2 text-xs text-amber-200">Unlock with PIN to show zk1 address</p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN (optional)"
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm"
          />
          {encryptedOnly ? (
            <button
              type="button"
              onClick={() => void handleUnlockPin()}
              className="rounded-lg border border-amber-500/30 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-500/10"
            >
              Unlock
            </button>
          ) : hasMnemonic ? (
            <button
              type="button"
              onClick={() => void handleEncryptPin()}
              className="rounded-lg border border-amber-500/30 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-500/10"
            >
              Encrypt with PIN
            </button>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowPhraseImport((v) => !v)}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10"
          >
            Import phrase
          </button>
          <button
            type="button"
            onClick={() => void handleRescan()}
            disabled={rescanning}
            className="rounded-lg border border-sky-500/30 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-500/10 disabled:opacity-50"
          >
            {rescanning ? "Scanning…" : "Rescan from chain"}
          </button>
        </div>
        {showPhraseImport ? (
          <div className="mt-3">
            <textarea
              value={importPhrase}
              onChange={(e) => setImportPhrase(e.target.value)}
              placeholder="twelve words separated by spaces…"
              rows={2}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => void handleImportPhrase()}
              className="mt-2 rounded-lg bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-500"
            >
              Save phrase
            </button>
          </div>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Local note vault</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleExport(false)}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => void handleExport(true)}
            className="rounded-lg border border-amber-500/30 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-500/10"
          >
            Export + phrase
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10"
          >
            Import JSON
          </button>
          <button
            type="button"
            onClick={() => paymentRef.current?.click()}
            className="rounded-lg border border-emerald-500/30 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/10"
          >
            Import payment
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
          <input
            ref={paymentRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportPayment(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <p className="mb-4 text-xs text-zinc-500">
        {notes.length} notes · {chainCommitments.length} on-chain commitments tracked locally
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
      ? `derive #${note.derivationIndex}`
      : "payment / legacy";

  return (
    <li className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <span>{formatStroops(note.value)} XLM</span>
        <span className="text-zinc-400">
          {note.status} · leaf {note.leafIndex} · {deriveLabel}
        </span>
      </div>
      <p className="mt-1 truncate font-mono text-xs text-zinc-500">{note.commitment}</p>
    </li>
  );
}
