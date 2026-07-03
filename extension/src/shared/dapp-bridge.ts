import type {
  ShieldedAddressParams,
  SignTransactionParams,
  UnlockParams,
} from "./shared/messages.js";
import {
  connect,
  disconnect,
  getDappSession,
} from "./session-store.js";

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "ZK shielded wallet cryptography and Stellar signing",
  });
}

async function callOffscreen<T>(method: string, params?: unknown): Promise<T> {
  await ensureOffscreen();
  return new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage(
      { target: "offscreen", method, params },
      (response: { result?: T; error?: string } | undefined) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message ?? "Offscreen unavailable"));
          return;
        }
        if (response?.error) reject(new Error(response.error));
        else resolve(response?.result as T);
      }
    );
  });
}

export async function handleDapp(
  method: string,
  params: unknown,
  origin: string | null
): Promise<unknown> {
  switch (method) {
    case "ping":
      return { ok: true, version: "0.1.0" };
    case "connect":
      return connect(origin ?? "unknown");
    case "disconnect":
      disconnect();
      return { ok: true };
    case "getPublicKey": {
      const session = await getDappSession(origin);
      return { publicKey: session.publicKey };
    }
    case "getSession":
      return getDappSession(origin);
    case "unlock": {
      const { password } = (params ?? {}) as UnlockParams;
      if (!password?.trim()) throw new Error("Password required");
      return callOffscreen("unlock", { password });
    }
    case "lock":
      return callOffscreen("lock");
    case "signTransaction": {
      const { xdr, networkPassphrase } = (params ?? {}) as SignTransactionParams;
      if (!xdr || !networkPassphrase) {
        throw new Error("xdr and networkPassphrase required");
      }
      return callOffscreen("signTransaction", { xdr, networkPassphrase });
    }
    case "getShieldedMasterSeed":
      return callOffscreen("getShieldedMasterSeed");
    case "getShieldedReceiveAddress": {
      const { diversifier } = (params ?? {}) as ShieldedAddressParams;
      return callOffscreen("getShieldedReceiveAddress", { diversifier: diversifier ?? "0" });
    }
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}
