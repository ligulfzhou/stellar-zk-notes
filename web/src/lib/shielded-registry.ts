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

/** Read recipient X25519 pubkey from zk1 string or on-chain G… registry. */
export async function resolveReceivePubkey(params: {
  recipient: string;
  readerPublicKey: string;
  selfPublicKey: string | null;
  selfRootSeed: Uint8Array | null;
}): Promise<Uint8Array> {
  const recipient = params.recipient.trim();

  if (isZk1Address(recipient)) {
    const parsed = parseZk1Address(recipient);
    if (!parsed) throw new Error("Invalid zk1 address");
    return parsed.publicKey;
  }

  if (!recipient.startsWith("G") || recipient.length !== 56) {
    throw new Error("Enter zk1… or a registered Stellar G… address");
  }

  if (params.selfPublicKey === recipient) {
    if (!params.selfRootSeed) {
      throw new Error("Unlock passkey first");
    }
    return deriveShieldedReceiveKeysFromRoot(params.selfRootSeed).publicKey;
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
      "Recipient has not registered a shielded key on-chain. Ask them to register in Notes, or use their zk1 address."
    );
  }
  return hexToBytes32(data.receivePubkeyHex);
}
