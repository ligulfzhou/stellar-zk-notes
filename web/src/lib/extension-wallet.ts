import type {
  ConnectResult,
  RpcMethod,
  SessionInfo,
  SignTransactionParams,
  UnlockParams,
  ZkStellarWalletProvider,
} from "./extension-types";
import { INIT_EVENT } from "./extension-types";

export type { ZkStellarWalletProvider } from "./extension-types";

export function waitForExtensionProvider(timeoutMs = 3000): Promise<ZkStellarWalletProvider | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.zkStellarWallet?.isZkStellarWallet) {
    return Promise.resolve(window.zkStellarWallet);
  }

  return new Promise((resolve) => {
    const done = (provider: ZkStellarWalletProvider | null) => {
      window.removeEventListener(INIT_EVENT, onInit);
      clearTimeout(timer);
      resolve(provider);
    };
    const onInit = () => {
      done(window.zkStellarWallet?.isZkStellarWallet ? window.zkStellarWallet : null);
    };
    window.addEventListener(INIT_EVENT, onInit);
    const timer = window.setTimeout(() => done(null), timeoutMs);
  });
}

export async function isExtensionInstalled(): Promise<boolean> {
  const provider = await waitForExtensionProvider();
  if (!provider) return false;
  try {
    await provider.request({ method: "ping" });
    return true;
  } catch {
    return false;
  }
}

async function request<T>(method: RpcMethod, params?: unknown): Promise<T> {
  const provider = await waitForExtensionProvider();
  if (!provider) {
    throw new Error("ZK Stellar Wallet extension not installed");
  }
  return provider.request<T>({ method, params });
}

export async function connectExtension(): Promise<ConnectResult> {
  return request<ConnectResult>("connect");
}

export async function disconnectExtension(): Promise<void> {
  await request("disconnect");
}

export async function getExtensionSession(): Promise<SessionInfo> {
  return request<SessionInfo>("getSession");
}

export async function unlockExtension(password: string): Promise<void> {
  await request("unlock", { password } satisfies UnlockParams);
}

export async function lockExtension(): Promise<void> {
  await request("lock");
}

export async function getExtensionPublicKey(): Promise<string | null> {
  const { publicKey } = await request<{ publicKey: string | null }>("getPublicKey");
  return publicKey;
}

export async function signExtensionTransaction(
  xdr: string,
  networkPassphrase: string
): Promise<string> {
  const { signedXdr } = await request<{ signedXdr: string }>("signTransaction", {
    xdr,
    networkPassphrase,
  } satisfies SignTransactionParams);
  return signedXdr;
}

export async function getExtensionShieldedMasterSeed(): Promise<Uint8Array> {
  const { seedB64 } = await request<{ seedB64: string }>("getShieldedMasterSeed");
  const raw = atob(seedB64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function getExtensionShieldedAddress(diversifier = "0"): Promise<string> {
  const { address } = await request<{ address: string }>("getShieldedReceiveAddress", {
    diversifier,
  });
  return address;
}
