import { config } from "./config.ts";

/** Deterministic test root seed (not passkey — stable across runs). */
export function e2eRootSeed(): Uint8Array {
  return e2ePartySeed("default");
}

/** Per-party E2E root seed for multi-account flows. */
export function e2ePartySeed(party: "default" | "alice" | "bob"): Uint8Array {
  const bytes = new Uint8Array(32);
  const label =
    party === "default"
      ? "zk-utxo-e2e-test-root-v1"
      : `zk-utxo-e2e-${party}-v1`;
  for (let i = 0; i < 32; i++) {
    bytes[i] = label.charCodeAt(i % label.length) ^ i;
  }
  return bytes;
}
