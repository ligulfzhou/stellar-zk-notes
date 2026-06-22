import { normalizeHex } from "./bytes";
import {
  deriveShieldedReceiveKeysFromRoot,
  isZk1Address,
  parseZk1Address,
} from "./shielded-keys";

function hexToBytes32(hex: string): Uint8Array {
  const h = normalizeHex(hex).slice(2).padStart(64, "0");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function isX25519PubkeyHex(value: string): boolean {
  const h = value.trim().replace(/^0x/i, "");
  return /^[0-9a-fA-F]{64}$/.test(h);
}

/** Read recipient X25519 pubkey from zk1, pasted hex, or (legacy) on-chain G… registry. */
export async function resolveReceivePubkey(params: {
  recipient: string;
  readerPublicKey: string;
  selfPublicKey: string | null;
  selfRootSeed: Uint8Array | null;
  /** Phase C default: false — no on-chain G… lookup */
  allowOnChainRegistry?: boolean;
}): Promise<Uint8Array> {
  const recipient = params.recipient.trim();

  if (isZk1Address(recipient)) {
    const parsed = parseZk1Address(recipient);
    if (!parsed) throw new Error("Invalid zk1 address");
    return parsed.publicKey;
  }

  if (isX25519PubkeyHex(recipient)) {
    return hexToBytes32(recipient);
  }

  if (!recipient.startsWith("G") || recipient.length !== 56) {
    throw new Error("Enter zk1… shielded address or paste recipient X25519 pubkey (64 hex chars)");
  }

  if (params.selfPublicKey === recipient) {
    if (!params.selfRootSeed) {
      throw new Error("Unlock passkey first");
    }
    return deriveShieldedReceiveKeysFromRoot(params.selfRootSeed).publicKey;
  }

  if (params.allowOnChainRegistry === false) {
    throw new Error(
      "On-chain G… lookup is disabled. Share your zk1 address or X25519 pubkey with the sender."
    );
  }

  const res = await fetch(
    `/api/shielded-key?owner=${encodeURIComponent(recipient)}&reader=${encodeURIComponent(params.readerPublicKey)}`
  );
  const data = (await res.json()) as {
    receivePubkeyHex?: string | null;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? "Shielded key lookup failed");
  }
  if (!data.receivePubkeyHex) {
    throw new Error(
      "Recipient has not registered a shielded key on-chain. Use their zk1 address instead."
    );
  }
  return hexToBytes32(data.receivePubkeyHex);
}
