export type RpcMethod =
  | "ping"
  | "connect"
  | "disconnect"
  | "getPublicKey"
  | "getSession"
  | "unlock"
  | "lock"
  | "signTransaction"
  | "getShieldedMasterSeed"
  | "getShieldedReceiveAddress";

export type ConnectResult = {
  publicKey: string;
  shieldedAddress: string;
  unlocked: boolean;
};

export type SessionInfo = {
  connected: boolean;
  unlocked: boolean;
  publicKey: string | null;
  shieldedAddress: string | null;
  origin: string | null;
};

export type SignTransactionParams = {
  xdr: string;
  networkPassphrase: string;
};

export type UnlockParams = {
  password: string;
};

export type ZkStellarWalletProvider = {
  isZkStellarWallet: true;
  version: string;
  request<T = unknown>(args: {
    method: RpcMethod;
    params?: unknown;
  }): Promise<T>;
};

declare global {
  interface Window {
    zkStellarWallet?: ZkStellarWalletProvider;
  }
}

export const INIT_EVENT = "zkStellarWallet#initialized";
