"use client";

import { create } from "zustand";
import type { Note, StoredNoteVault } from "@/lib/note";
import { sumUnspentNotes, hasPasskey } from "@/lib/note";
import { loadVault, saveVault } from "@/lib/note-store";
import { connectWallet, getPublicKey } from "@/lib/wallet";

type Tab = "dashboard" | "join" | "send" | "exit" | "notes";

interface WalletState {
  publicKey: string | null;
  connecting: boolean;
  error: string | null;
  notes: Note[];
  poolChainCommitments: string[][];
  hasPasskey: boolean;
  activeTab: Tab;
  shieldedBalance: bigint;
  setTab: (tab: Tab) => void;
  refreshNotes: () => Promise<void>;
  connect: () => Promise<void>;
  hydrate: () => Promise<void>;
  onAccountChange: (publicKey: string | null) => Promise<void>;
}

function vaultToState(vault: StoredNoteVault) {
  return {
    notes: vault.notes,
    poolChainCommitments: vault.poolChainCommitments,
    hasPasskey: hasPasskey(vault),
    shieldedBalance: sumUnspentNotes(vault.notes),
  };
}

const emptyAccountState = {
  notes: [] as Note[],
  poolChainCommitments: [[], [], []] as string[][],
  hasPasskey: false,
  shieldedBalance: BigInt(0),
};

export const useWalletStore = create<WalletState>((set, get) => ({
  publicKey: null,
  connecting: false,
  error: null,
  notes: [],
  poolChainCommitments: [[], [], []],
  hasPasskey: false,
  activeTab: "dashboard",
  shieldedBalance: BigInt(0),

  setTab: (tab) => set({ activeTab: tab }),

  refreshNotes: async () => {
    const { publicKey } = get();
    if (!publicKey) {
      set(emptyAccountState);
      return;
    }
    const vault = await loadVault(publicKey);
    set(vaultToState(vault));
  },

  onAccountChange: async (publicKey) => {
    set({ publicKey });
    if (!publicKey) {
      set(emptyAccountState);
      return;
    }
    const vault = await loadVault(publicKey);
    set(vaultToState(vault));
  },

  connect: async () => {
    set({ connecting: true, error: null });
    try {
      const publicKey = await connectWallet();
      await get().onAccountChange(publicKey);
      set({ connecting: false });
    } catch (err) {
      set({
        connecting: false,
        error: err instanceof Error ? err.message : "Failed to connect wallet",
      });
    }
  },

  hydrate: async () => {
    const publicKey = await getPublicKey();
    if (!publicKey) {
      set({ publicKey: null, ...emptyAccountState });
      return;
    }
    const vault = await loadVault(publicKey);
    set({ publicKey, ...vaultToState(vault) });
  },
}));

function requireActivePubkey(): string {
  const publicKey = useWalletStore.getState().publicKey;
  if (!publicKey) {
    throw new Error("Connect wallet first");
  }
  return publicKey;
}

export async function persistVaultState(
  notes: Note[],
  poolChainCommitments: string[][]
) {
  const publicKey = requireActivePubkey();
  const vault = await loadVault(publicKey);
  vault.notes = notes;
  vault.poolChainCommitments = poolChainCommitments;
  await saveVault(vault, publicKey);
  useWalletStore.setState(vaultToState(vault));
}

export async function persistFullVault(vault: StoredNoteVault) {
  const publicKey = requireActivePubkey();
  await saveVault(vault, publicKey);
  useWalletStore.setState(vaultToState(vault));
}
