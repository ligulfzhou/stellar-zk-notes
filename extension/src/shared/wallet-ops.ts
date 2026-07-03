import {
  importUnifiedWallet,
  createUnifiedWallet,
  deriveShieldedReceiveBundle,
  signStellarTransactionXdr,
  type UnifiedWallet,
} from "@zk-utxo/wallet-core";
import {
  decryptMnemonic,
  encryptMnemonic,
  randomSalt,
  saltFromB64,
  saltToB64,
  wrapKeyFromPassword,
} from "./crypto.js";
import { hashPair } from "./noir-hash-pair.js";
import {
  clearSession,
  clearWalletRecord,
  loadSession,
  loadWalletRecord,
  saveSession,
  saveWalletRecord,
  sessionToSnapshot,
  shieldedMasterFromSession,
  type EncryptedWalletRecord,
} from "./session-store.js";

async function unlockToSnapshot(
  stored: EncryptedWalletRecord,
  password: string
) {
  const key = await wrapKeyFromPassword(password, saltFromB64(stored.passwordSalt));
  const mnemonic = decryptMnemonic(stored.encryptedMnemonic, key);
  const unified = await importUnifiedWallet(mnemonic);
  if (unified.stellarPublicKey !== stored.stellarPublicKey) {
    throw new Error("Recovery phrase does not match stored Stellar account");
  }
  const bundle = await deriveShieldedReceiveBundle(
    unified.shieldedMaster,
    "0",
    hashPair
  );
  return sessionToSnapshot({
    stellarPublicKey: unified.stellarPublicKey,
    stellarSecretKey: unified.stellarSecretKey,
    shieldedMaster: unified.shieldedMaster,
    defaultShieldedAddress: bundle.address,
  });
}

async function persistUnified(unified: UnifiedWallet, password: string): Promise<void> {
  const salt = randomSalt();
  const key = await wrapKeyFromPassword(password, salt);
  const encryptedMnemonic = encryptMnemonic(unified.mnemonic, key);
  await saveWalletRecord({
    stellarPublicKey: unified.stellarPublicKey,
    encryptedMnemonic,
    passwordSalt: saltToB64(salt),
  });
}

export async function createWallet(password: string): Promise<{
  mnemonic: string;
  publicKey: string;
  shieldedAddress: string;
}> {
  const unified = await createUnifiedWallet();
  await persistUnified(unified, password);
  const session = await unlockToSnapshot(await loadWalletRecord()!, password);
  await saveSession(session);
  return {
    mnemonic: unified.mnemonic,
    publicKey: unified.stellarPublicKey,
    shieldedAddress: session.defaultShieldedAddress,
  };
}

export async function importWallet(
  mnemonic: string,
  password: string
): Promise<{ publicKey: string; shieldedAddress: string }> {
  const unified = await importUnifiedWallet(mnemonic);
  await persistUnified(unified, password);
  const session = await unlockToSnapshot(await loadWalletRecord()!, password);
  await saveSession(session);
  return {
    publicKey: unified.stellarPublicKey,
    shieldedAddress: session.defaultShieldedAddress,
  };
}

export async function unlockWithPassword(password: string): Promise<void> {
  const stored = await loadWalletRecord();
  if (!stored) throw new Error("Create or import a wallet in the extension first");
  const session = await unlockToSnapshot(stored, password);
  await saveSession(session);
}

export async function lockWallet(): Promise<void> {
  await clearSession();
}

export async function resetWallet(): Promise<void> {
  await clearSession();
  await clearWalletRecord();
}

export async function getShieldedReceiveAddress(diversifier = "0"): Promise<string> {
  const session = await loadSessionFromStore();
  const master = shieldedMasterFromSession(session);
  const bundle = await deriveShieldedReceiveBundle(master, diversifier, hashPair);
  return bundle.address;
}

export async function signTransaction(
  xdr: string,
  networkPassphrase: string
): Promise<string> {
  const session = await loadSessionFromStore();
  return signStellarTransactionXdr(session.stellarSecretKey, xdr, networkPassphrase);
}

export async function getShieldedMasterSeedB64(): Promise<string> {
  const session = await loadSessionFromStore();
  return session.shieldedMasterB64;
}

async function loadSessionFromStore() {
  const session = await loadSession();
  if (!session) throw new Error("Wallet locked");
  return session;
}
