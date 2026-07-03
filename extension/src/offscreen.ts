import * as wallet from "./shared/wallet-ops.js";

type OffscreenRequest = {
  target: "offscreen";
  method: string;
  params?: unknown;
};

chrome.runtime.onMessage.addListener((message: OffscreenRequest, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return false;
  void (async () => {
    try {
      const result = await handle(message.method, message.params);
      sendResponse({ result });
    } catch (err) {
      sendResponse({
        error: err instanceof Error ? err.message : "Offscreen request failed",
      });
    }
  })();
  return true;
});

async function handle(method: string, params: unknown): Promise<unknown> {
  switch (method) {
    case "unlock": {
      const { password } = (params ?? {}) as { password: string };
      await wallet.unlockWithPassword(password);
      return { unlocked: true };
    }
    case "lock":
      await wallet.lockWallet();
      return { ok: true };
    case "signTransaction": {
      const { xdr, networkPassphrase } = (params ?? {}) as {
        xdr: string;
        networkPassphrase: string;
      };
      return {
        signedXdr: await wallet.signTransaction(xdr, networkPassphrase),
      };
    }
    case "getShieldedMasterSeed":
      return { seedB64: await wallet.getShieldedMasterSeedB64() };
    case "getShieldedReceiveAddress": {
      const { diversifier } = (params ?? {}) as { diversifier?: string };
      return { address: await wallet.getShieldedReceiveAddress(diversifier ?? "0") };
    }
    default:
      throw new Error(`Unknown offscreen method: ${method}`);
  }
}
