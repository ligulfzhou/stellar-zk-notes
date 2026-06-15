import { deriveShieldedReceiveKeysFromSeed } from "./root-seed";

export type ShieldedReceiveKeys = import("./root-seed").ShieldedReceiveKeys;

export function deriveShieldedReceiveKeysFromRoot(
  rootSeed: Uint8Array
): ShieldedReceiveKeys {
  return deriveShieldedReceiveKeysFromSeed(rootSeed);
}

export function encodeZk1Address(
  publicKey: Uint8Array,
  network = "testnet"
): string {
  const b64 = btoa(String.fromCharCode(...publicKey))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `zk1:${network}:${b64}`;
}

export function parseZk1Address(
  address: string
): { publicKey: Uint8Array; network: string } | null {
  const match = /^zk1:([^:]+):([A-Za-z0-9_-]+)$/.exec(address.trim());
  if (!match) return null;
  const padded = match[2].replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (padded.length % 4)) % 4;
  const b64 = padded + "=".repeat(pad);
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  if (bytes.length !== 32) return null;
  return { network: match[1], publicKey: bytes };
}

export function isZk1Address(value: string): boolean {
  return value.startsWith("zk1:");
}
