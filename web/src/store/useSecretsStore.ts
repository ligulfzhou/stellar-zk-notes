"use client";

import { create } from "zustand";
import {
  decryptMnemonic,
  encryptMnemonic,
  randomSalt,
  saltFromB64,
  saltToB64,
  wrapKeyFromPasskeyPrf,
  wrapKeyFromPassword,
  type EncryptedMnemonic,
} from "@/lib/encrypted-secrets";
import {
  createWalletMnemonic,
  mnemonicToMasterSeed,
} from "@/lib/mnemonic-wallet";
import { defaultVault } from "@/lib/note-types";
import type { PasskeyVaultConfig } from "@/lib/passkey";
import {
  registerPrimaryPasskey,
  unlockPasskey,
} from "@/lib/passkey";
import {
  getPasskeyConfig,
  loadVault,
  savePasskeyConfig,
  saveVault,
} from "@/lib/note-store";
import { deriveStellarKeypairFromMnemonic } from "@/lib/unified-stellar";
import { loadWalletMeta, saveWalletMeta } from "@/lib/wallet-meta";
import { useWalletStore } from "@/store/useWalletStore";

interface SecretsState {
  masterSeed: Uint8Array | null;
  rootSeed: Uint8Array | null;
  stellarPublicKey: string | null;
  stellarSecretKey: string | null;
  unlocked: boolean;
  unlocking: boolean;
  error: string | null;
  hasEncryptedWallet: boolean;
  unlock: () => Promise<Uint8Array>;
  unlockWithPasskey: () => Promise<Uint8Array>;
  unlockWithPassword: (password: string) => Promise<Uint8Array>;
  createWallet: () => Promise<{ mnemonic: string; masterSeed: Uint8Array }>;
  importMnemonic: (
    mnemonic: string,
    opts?: { password?: string; usePasskey?: boolean }
  ) => Promise<Uint8Array>;
  lock: () => void;
  requireSeed: () => Uint8Array;
  refreshWalletStatus: () => Promise<void>;
}

async function resolvePublicKey(): Promise<string> {
  const fromStore = useWalletStore.getState().publicKey;
  if (fromStore) return fromStore;
  const meta = await loadWalletMeta();
  if (meta?.stellarPublicKey) return meta.stellarPublicKey;
  throw new Error("Create or import a wallet in Notes first");
}

async function persistEncryptedMnemonic(
  publicKey: string,
  mnemonic: string,
  opts: { password?: string; usePasskey?: boolean }
): Promise<{ encrypted: EncryptedMnemonic; passwordSalt: string | null }> {
  if (opts.usePasskey !== false) {
    let passkey = await getPasskeyConfig();
    let prfBytes: Uint8Array;
    if (!passkey) {
      const registered = await registerPrimaryPasskey("Wallet passkey");
      await savePasskeyConfig(registered.config, publicKey);
      prfBytes = registered.rootSeed;
    } else {
      prfBytes = await unlockPasskey(passkey);
    }
    const key = wrapKeyFromPasskeyPrf(prfBytes);
    return {
      encrypted: encryptMnemonic(mnemonic, key, "passkey-prf"),
      passwordSalt: null,
    };
  }

  const password = opts.password?.trim();
  if (!password) {
    throw new Error("Password required when not using passkey");
  }
  const salt = randomSalt();
  const key = await wrapKeyFromPassword(password, salt);
  return {
    encrypted: encryptMnemonic(mnemonic, key, "password"),
    passwordSalt: saltToB64(salt),
  };
}

async function decryptFromVault(
  encrypted: EncryptedMnemonic,
  passwordSalt: string | null
): Promise<string> {
  if (encrypted.method === "passkey-prf") {
    const passkey = await getPasskeyConfig();
    if (!passkey) throw new Error("Register wallet passkey first");
    const prfBytes = await unlockPasskey(passkey);
    return decryptMnemonic(encrypted, wrapKeyFromPasskeyPrf(prfBytes));
  }
  const password = useSecretsStore.getState()._password;
  if (!password) throw new Error("Enter wallet password");
  if (!passwordSalt) throw new Error("Missing password salt");
  const key = await wrapKeyFromPassword(password, saltFromB64(passwordSalt));
  return decryptMnemonic(encrypted, key);
}

function setUnlocked(
  set: (partial: object) => void,
  params: {
    masterSeed: Uint8Array;
    stellarPublicKey: string;
    stellarSecretKey: string;
  }
) {
  set({
    masterSeed: params.masterSeed,
    rootSeed: params.masterSeed,
    stellarPublicKey: params.stellarPublicKey,
    stellarSecretKey: params.stellarSecretKey,
    unlocked: true,
    unlocking: false,
    hasEncryptedWallet: true,
  });
}

async function unlockFromMnemonic(
  set: (partial: object) => void,
  mnemonic: string
): Promise<Uint8Array> {
  const masterSeed = await mnemonicToMasterSeed(mnemonic);
  const stellar = await deriveStellarKeypairFromMnemonic(mnemonic);
  await saveWalletMeta({ stellarPublicKey: stellar.publicKey });
  await useWalletStore.getState().onAccountChange(stellar.publicKey);
  setUnlocked(set, {
    masterSeed,
    stellarPublicKey: stellar.publicKey,
    stellarSecretKey: stellar.secretKey,
  });
  return masterSeed;
}

export const useSecretsStore = create<
  SecretsState & { _password: string | null }
>((set, get) => ({
  masterSeed: null,
  rootSeed: null,
  stellarPublicKey: null,
  stellarSecretKey: null,
  unlocked: false,
  unlocking: false,
  error: null,
  hasEncryptedWallet: false,
  _password: null,

  lock: () =>
    set({
      masterSeed: null,
      rootSeed: null,
      stellarPublicKey: null,
      stellarSecretKey: null,
      unlocked: false,
      error: null,
      _password: null,
    }),

  requireSeed: () => {
    const seed = get().masterSeed;
    if (!seed) {
      throw new Error("Unlock wallet first");
    }
    return seed;
  },

  unlock: async () => get().unlockWithPasskey(),

  refreshWalletStatus: async () => {
    try {
      const meta = await loadWalletMeta();
      const publicKey =
        useWalletStore.getState().publicKey ?? meta?.stellarPublicKey ?? null;
      if (!publicKey) {
        set({ hasEncryptedWallet: false });
        return;
      }
      const vault = await loadVault(publicKey);
      set({ hasEncryptedWallet: Boolean(vault.encryptedMnemonic) });
    } catch {
      set({ hasEncryptedWallet: false });
    }
  },

  createWallet: async () => {
    const mnemonic = createWalletMnemonic();
    const masterSeed = await mnemonicToMasterSeed(mnemonic);
    const stellar = await deriveStellarKeypairFromMnemonic(mnemonic);
    await saveWalletMeta({ stellarPublicKey: stellar.publicKey });
    await useWalletStore.getState().onAccountChange(stellar.publicKey);

    const { encrypted, passwordSalt } = await persistEncryptedMnemonic(
      stellar.publicKey,
      mnemonic,
      { usePasskey: true }
    );
    const vault = defaultVault();
    vault.encryptedMnemonic = encrypted;
    vault.passwordSalt = passwordSalt;
    vault.addressIndex = 1;
    await saveVault(vault, stellar.publicKey);

    setUnlocked(set, {
      masterSeed,
      stellarPublicKey: stellar.publicKey,
      stellarSecretKey: stellar.secretKey,
    });
    return { mnemonic, masterSeed };
  },

  importMnemonic: async (mnemonic, opts) => {
    const masterSeed = await mnemonicToMasterSeed(mnemonic);
    const stellar = await deriveStellarKeypairFromMnemonic(mnemonic);
    await saveWalletMeta({ stellarPublicKey: stellar.publicKey });
    await useWalletStore.getState().onAccountChange(stellar.publicKey);

    const { encrypted, passwordSalt } = await persistEncryptedMnemonic(
      stellar.publicKey,
      mnemonic,
      { password: opts?.password, usePasskey: opts?.usePasskey ?? true }
    );
    const vault = defaultVault();
    vault.encryptedMnemonic = encrypted;
    vault.passwordSalt = passwordSalt;
    vault.addressIndex = 1;
    await saveVault(vault, stellar.publicKey);

    setUnlocked(set, {
      masterSeed,
      stellarPublicKey: stellar.publicKey,
      stellarSecretKey: stellar.secretKey,
    });
    return masterSeed;
  },

  unlockWithPasskey: async () => {
    set({ unlocking: true, error: null, _password: null });
    try {
      const publicKey = await resolvePublicKey();
      const vault = await loadVault(publicKey);
      if (!vault.encryptedMnemonic) {
        throw new Error("Create or import a wallet first");
      }
      const mnemonic = await decryptFromVault(
        vault.encryptedMnemonic,
        vault.passwordSalt
      );
      return await unlockFromMnemonic(set, mnemonic);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unlock failed";
      set({ unlocking: false, error: message });
      throw new Error(message);
    }
  },

  unlockWithPassword: async (password) => {
    set({ unlocking: true, error: null, _password: password });
    try {
      const publicKey = await resolvePublicKey();
      const vault = await loadVault(publicKey);
      if (!vault.encryptedMnemonic) {
        throw new Error("Create or import a wallet first");
      }
      if (vault.encryptedMnemonic.method !== "password") {
        throw new Error("This wallet uses passkey unlock");
      }
      const mnemonic = await decryptFromVault(
        vault.encryptedMnemonic,
        vault.passwordSalt
      );
      return await unlockFromMnemonic(set, mnemonic);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unlock failed";
      set({ unlocking: false, error: message });
      throw new Error(message);
    }
  },
}));

export const usePasskeyStore = useSecretsStore;
