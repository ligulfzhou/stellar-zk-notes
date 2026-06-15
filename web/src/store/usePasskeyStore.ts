"use client";

import { create } from "zustand";
import type { PasskeyVaultConfig } from "@/lib/passkey";
import {
  registerPrimaryPasskey,
  registerRecoveryPasskey,
  unlockPasskey,
} from "@/lib/passkey";
import { getPasskeyConfig, savePasskeyConfig } from "@/lib/note-store";
import { useWalletStore } from "@/store/useWalletStore";

interface PasskeySessionState {
  rootSeed: Uint8Array | null;
  unlocked: boolean;
  unlocking: boolean;
  error: string | null;
  unlock: () => Promise<Uint8Array>;
  lock: () => void;
  registerPrimary: (label?: string) => Promise<Uint8Array>;
  registerRecovery: (label?: string) => Promise<void>;
  requireSeed: () => Uint8Array;
}

export const usePasskeyStore = create<PasskeySessionState>((set, get) => ({
  rootSeed: null,
  unlocked: false,
  unlocking: false,
  error: null,

  lock: () => set({ rootSeed: null, unlocked: false, error: null }),

  requireSeed: () => {
    const seed = get().rootSeed;
    if (!seed) {
      throw new Error("Unlock passkey first (Touch ID / Face ID / security key)");
    }
    return seed;
  },

  unlock: async () => {
    set({ unlocking: true, error: null });
    try {
      const passkey = await getPasskeyConfig();
      if (!passkey) {
        throw new Error("No passkey configured — register in Notes first");
      }
      const rootSeed = await unlockPasskey(passkey);
      set({ rootSeed, unlocked: true, unlocking: false });
      return rootSeed;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Passkey unlock failed";
      set({ unlocking: false, error: message });
      throw new Error(message);
    }
  },

  registerPrimary: async (label) => {
    set({ unlocking: true, error: null });
    try {
      const { config, rootSeed } = await registerPrimaryPasskey(label);
      const publicKey = useWalletStore.getState().publicKey;
      await savePasskeyConfig(config, publicKey);
      set({ rootSeed, unlocked: true, unlocking: false });
      return rootSeed;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Passkey registration failed";
      set({ unlocking: false, error: message });
      throw new Error(message);
    }
  },

  registerRecovery: async (label) => {
    const seed = get().requireSeed();
    const passkey = await getPasskeyConfig();
    if (!passkey) {
      throw new Error("Register primary passkey first");
    }
    const updated = await registerRecoveryPasskey(passkey, seed, label);
    const publicKey = useWalletStore.getState().publicKey;
    await savePasskeyConfig(updated, publicKey);
  },
}));

export { getPasskeyConfig };
