import {
  isRpcRequest,
  isRpcResponse,
  PROVIDER_CHANNEL,
  type RpcRequest,
  type RpcResponse,
} from "./shared/messages.js";

function injectProvider(): void {
  if (document.documentElement.getAttribute("data-zk-stellar-wallet")) return;
  document.documentElement.setAttribute("data-zk-stellar-wallet", "1");
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("injected.js");
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
  script.onload = () => script.remove();
}

injectProvider();

window.addEventListener("message", (event) => {
  if (event.source !== window || !isRpcRequest(event.data)) return;
  const req = event.data as RpcRequest;
  if (req.channel !== PROVIDER_CHANNEL) return;

  chrome.runtime.sendMessage(
    {
      ...req,
      origin: event.origin,
    },
    (response: RpcResponse | undefined) => {
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message ?? "Extension unavailable";
        const payload: RpcResponse = {
          channel: PROVIDER_CHANNEL,
          type: "response",
          id: req.id,
          error: errMsg,
        };
        window.postMessage(payload, window.location.origin);
        return;
      }
      const payload: RpcResponse = {
        channel: PROVIDER_CHANNEL,
        type: "response",
        id: req.id,
        result: response?.result,
        error: response?.error,
      };
      window.postMessage(payload, window.location.origin);
    }
  );
});
