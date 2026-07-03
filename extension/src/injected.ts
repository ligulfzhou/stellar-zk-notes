import {
  isRpcResponse,
  PROVIDER_CHANNEL,
  randomId,
  type RpcMethod,
  type RpcRequest,
  type RpcResponse,
} from "./shared/messages.js";

declare global {
  interface Window {
    zkStellarWallet?: ZkStellarWalletProvider;
  }
}

export type ZkStellarWalletProvider = {
  isZkStellarWallet: true;
  version: string;
  request<T = unknown>(args: {
    method: RpcMethod;
    params?: unknown;
  }): Promise<T>;
};

const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>();

window.addEventListener("message", (event) => {
  if (event.source !== window || !isRpcResponse(event.data)) return;
  const res = event.data as RpcResponse;
  if (res.channel !== PROVIDER_CHANNEL) return;
  const entry = pending.get(res.id);
  if (!entry) return;
  pending.delete(res.id);
  if (res.error) entry.reject(new Error(res.error));
  else entry.resolve(res.result);
});

function request<T>(method: RpcMethod, params?: unknown): Promise<T> {
  const id = randomId();
  const payload: RpcRequest = {
    channel: PROVIDER_CHANNEL,
    type: "request",
    id,
    method,
    params,
  };
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    window.postMessage(payload, window.location.origin);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("ZK Stellar Wallet request timed out"));
      }
    }, 120_000);
  });
}

const provider: ZkStellarWalletProvider = {
  isZkStellarWallet: true,
  version: "0.1.0",
  request,
};

Object.defineProperty(window, "zkStellarWallet", {
  value: provider,
  writable: false,
  configurable: false,
});

window.dispatchEvent(new Event("zkStellarWallet#initialized"));
