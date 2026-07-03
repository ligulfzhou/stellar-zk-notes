export const PROVIDER_CHANNEL = "zk-stellar-wallet" as const;

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

export type RpcRequest = {
  channel: typeof PROVIDER_CHANNEL;
  type: "request";
  id: string;
  method: RpcMethod;
  params?: unknown;
  origin?: string;
};

export type RpcResponse = {
  channel: typeof PROVIDER_CHANNEL;
  type: "response";
  id: string;
  result?: unknown;
  error?: string;
};

export type RpcEvent = {
  channel: typeof PROVIDER_CHANNEL;
  type: "event";
  event: "accountsChanged" | "lockChanged";
  payload?: unknown;
};

export function isRpcRequest(msg: unknown): msg is RpcRequest {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as RpcRequest).channel === PROVIDER_CHANNEL &&
    (msg as RpcRequest).type === "request"
  );
}

export function isRpcResponse(msg: unknown): msg is RpcResponse {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as RpcResponse).channel === PROVIDER_CHANNEL &&
    (msg as RpcResponse).type === "response"
  );
}

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

export type ShieldedAddressParams = {
  diversifier?: string;
};

export function randomId(): string {
  return crypto.randomUUID();
}

export function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function b64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
