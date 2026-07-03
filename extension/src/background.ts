import type { RpcRequest } from "./shared/messages.js";
import { handleDapp } from "./shared/dapp-bridge.js";

chrome.runtime.onMessage.addListener((message: RpcRequest, sender, sendResponse) => {
  if (message.type !== "request") return false;
  void (async () => {
    try {
      const origin = message.origin ?? sender.origin ?? sender.url ?? null;
      const result = await handleDapp(message.method, message.params, origin);
      sendResponse({ id: message.id, result });
    } catch (err) {
      const error = err instanceof Error ? err.message : "Request failed";
      sendResponse({ id: message.id, error });
    }
  })();
  return true;
});
