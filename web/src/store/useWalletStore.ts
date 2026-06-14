"use client";

import { create } from "zustand";
import type { Note, StoredNoteVault } from "@/lib/note";
import { sumUnspentNotes } from "@/lib/note";
import { loadVault, saveVault } from "@/lib/note-store";
import { scanIncomingEncryptedNotes } from "@/lib/incoming-scanner";
import { rescanVaultFromChain } from "@/lib/rescan-vault";
import { connectFreighter, getPublicKey } from "@/lib/wallet";

type Tab = "dashboard" | "deposit" | "send" | "withdraw" | "notes";

interface WalletState {
  publicKey: string | null;
  connecting: boolean;
  error: string | null;
  notes: Note[];
  chainCommitments: string[];
  hasMnemonic: boolean;
  activeTab: Tab;
  shieldedBalance: bigint;
  setTab: (tab: Tab) => void;
  refreshNotes: () => Promise<void>;
  connect: () => Promise<void>;
  hydrate: () => Promise<void>;
}

function vaultToState(vault: StoredNoteVault) {
  return {
    notes: vault.notes,
    chainCommitments: vault.chainCommitments,
    hasMnemonic: Boolean(vault.mnemonic || vault.encryptedMnemonic),
    shieldedBalance: sumUnspentNotes(vault.notes),
  };
}

export const useWalletStore = create<WalletState>((set) => ({
  publicKey: null,
  connecting: false,
  error: null,
  notes: [],
  chainCommitments: [],
  hasMnemonic: false,
  activeTab: "dashboard",
  shieldedBalance: BigInt(0),

  setTab: (tab) => set({ activeTab: tab }),

  refreshNotes: async () => {
    const vault = await loadVault();
    set(vaultToState(vault));
  },

  connect: async () => {
    set({ connecting: true, error: null });
    try {
      const publicKey = await connectFreighter();
      set({ publicKey, connecting: false });
    } catch (err) {
      set({
        connecting: false,
        error: err instanceof Error ? err.message : "Failed to connect wallet",
      });
    }
  },

  hydrate: async () => {
    const [publicKey, vault] = await Promise.all([getPublicKey(), loadVault()]);
    set({ publicKey, ...vaultToState(vault) });

    const mnemonic = vault.mnemonic;
    const shouldAutoSync =
      publicKey &&
      mnemonic &&
      vault.notes.length === 0 &&
      typeof sessionStorage !== "undefined" &&
      !sessionStorage.getItem("zk-notes:auto-synced");

    if (shouldAutoSync) {
      sessionStorage.setItem("zk-notes:auto-synced", "1");
      try {
        const rescan = await rescanVaultFromChain({
          mnemonic,
          ownerPubkey: publicKey,
          existingVault: vault,
        });
        const incoming = await scanIncomingEncryptedNotes({
          mnemonic,
          ownerPubkey: publicKey,
          vault: rescan.vault,
        });
        const merged = {
          ...rescan.vault,
          notes: incoming.notes,
          chainCommitments: incoming.chainCommitments,
        };
        await saveVault(merged);
        set({ ...vaultToState(merged) });
      } catch {
        // RPC unavailable — user can rescan manually
      }
    }
  },
}));

export async function persistVaultState(
  notes: Note[],
  chainCommitments: string[]
) {
  const vault = await loadVault();
  vault.notes = notes;
  vault.chainCommitments = chainCommitments;
  await saveVault(vault);
  useWalletStore.setState(vaultToState(vault));
}

export async function persistFullVault(vault: StoredNoteVault) {
  await saveVault(vault);
  useWalletStore.setState(vaultToState(vault));
}
