import type { ConnectResult, SessionInfo } from "./messages.js";
import { b64ToBytes, bytesToB64 } from "./messages.js";

export type EncryptedWalletRecord = {
  stellarPublicKey: string;
  encryptedMnemonic: { iv: string; ciphertext: string };
  passwordSalt: string;
};

export type UnlockedSession = {
  stellarPublicKey: string;
  stellarSecretKey: string;
  shieldedMasterB64: string;
  defaultShieldedAddress: string;
};

const WALLET_KEY = "wallet_v1";
const SESSION_KEY = "session_v1";

let connectedOrigin: string | null = null;

export async function loadWalletRecord(): Promise<EncryptedWalletRecord | null> {
  const data = await chrome.storage.local.get(WALLET_KEY);
  return (data[WALLET_KEY] as EncryptedWalletRecord | undefined) ?? null;
}

export async function saveWalletRecord(record: EncryptedWalletRecord): Promise<void> {
  await chrome.storage.local.set({ [WALLET_KEY]: record });
}

export async function clearWalletRecord(): Promise<void> {
  await chrome.storage.local.remove(WALLET_KEY);
}

export async function loadSession(): Promise<UnlockedSession | null> {
  const data = await chrome.storage.session.get(SESSION_KEY);
  return (data[SESSION_KEY] as UnlockedSession | undefined) ?? null;
}

export async function saveSession(session: UnlockedSession): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEY]: session });
}

export async function clearSession(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEY);
  connectedOrigin = null;
}

export function setConnectedOrigin(origin: string | null): void {
  connectedOrigin = origin;
}

export function getConnectedOrigin(): string | null {
  return connectedOrigin;
}

export async function walletStatus(): Promise<{
  hasWallet: boolean;
  unlocked: boolean;
  publicKey: string | null;
  shieldedAddress: string | null;
}> {
  const stored = await loadWalletRecord();
  const session = await loadSession();
  return {
    hasWallet: stored !== null,
    unlocked: session !== null,
    publicKey: session?.stellarPublicKey ?? stored?.stellarPublicKey ?? null,
    shieldedAddress: session?.defaultShieldedAddress ?? null,
  };
}

export async function connect(origin: string): Promise<ConnectResult> {
  const stored = await loadWalletRecord();
  if (!stored) {
    throw new Error("Open ZK Stellar Wallet extension to create or import a wallet");
  }
  const session = await loadSession();
  if (!session) {
    throw new Error("Unlock wallet in the extension or via the dapp unlock prompt");
  }
  if (session.stellarPublicKey !== stored.stellarPublicKey) {
    throw new Error("Wallet session mismatch — unlock again");
  }
  connectedOrigin = origin;
  return {
    publicKey: session.stellarPublicKey,
    shieldedAddress: session.defaultShieldedAddress,
    unlocked: true,
  };
}

export function disconnect(): void {
  connectedOrigin = null;
}

export async function getDappSession(origin: string | null): Promise<SessionInfo> {
  const session = await loadSession();
  return {
    connected: Boolean(connectedOrigin && connectedOrigin === origin && session),
    unlocked: session !== null,
    publicKey: session?.stellarPublicKey ?? null,
    shieldedAddress: session?.defaultShieldedAddress ?? null,
    origin: connectedOrigin,
  };
}

export function sessionToSnapshot(params: {
  stellarPublicKey: string;
  stellarSecretKey: string;
  shieldedMaster: Uint8Array;
  defaultShieldedAddress: string;
}): UnlockedSession {
  return {
    stellarPublicKey: params.stellarPublicKey,
    stellarSecretKey: params.stellarSecretKey,
    shieldedMasterB64: bytesToB64(params.shieldedMaster),
    defaultShieldedAddress: params.defaultShieldedAddress,
  };
}

export function shieldedMasterFromSession(session: UnlockedSession): Uint8Array {
  return b64ToBytes(session.shieldedMasterB64);
}
