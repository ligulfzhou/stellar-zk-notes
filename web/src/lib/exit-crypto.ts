import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ENCRYPTED_EXIT_MAX } from "./pool-config";
import { computeExitHash } from "./exit-hash";

export type ExitPayload = {
  recipient: string;
  amountStroops: string;
  memo?: string;
};

const EXIT_AAD = new TextEncoder().encode("zk-notes/exit-v1");
const EPK_LEN = 32;

function deriveAesKey(shared: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, new Uint8Array(), EXIT_AAD, 32);
}

/** Layout: epk (32) || nonce (12) || ciphertext+tag */
export function encryptExitForRelayer(
  relayerPublicKey: Uint8Array,
  payload: ExitPayload
): { encryptedExit: Uint8Array } {
  const esk = x25519.utils.randomSecretKey();
  const epk = x25519.getPublicKey(esk);
  const shared = x25519.getSharedSecret(esk, relayerPublicKey);
  const key = deriveAesKey(shared);
  const nonce = randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = gcm(key, nonce, EXIT_AAD).encrypt(plaintext);
  const encryptedExit = new Uint8Array(EPK_LEN + nonce.length + ciphertext.length);
  encryptedExit.set(epk, 0);
  encryptedExit.set(nonce, EPK_LEN);
  encryptedExit.set(ciphertext, EPK_LEN + nonce.length);
  if (encryptedExit.length > ENCRYPTED_EXIT_MAX) {
    throw new Error(`Encrypted exit too large (${encryptedExit.length} > ${ENCRYPTED_EXIT_MAX})`);
  }
  return { encryptedExit };
}

export async function encryptExitForRelayerAsync(
  relayerPublicKey: Uint8Array,
  payload: ExitPayload
): Promise<{ encryptedExit: Uint8Array; exitHashHex: string }> {
  const result = encryptExitForRelayer(relayerPublicKey, payload);
  const exitHashHex = await computeExitHash(result.encryptedExit);
  return { ...result, exitHashHex };
}

export function decryptExit(
  relayerSecretKey: Uint8Array,
  encryptedExit: Uint8Array
): ExitPayload {
  if (encryptedExit.length < EPK_LEN + 13) {
    throw new Error("Encrypted exit too short");
  }
  const epk = encryptedExit.slice(0, EPK_LEN);
  const nonce = encryptedExit.slice(EPK_LEN, EPK_LEN + 12);
  const ciphertext = encryptedExit.slice(EPK_LEN + 12);
  const shared = x25519.getSharedSecret(relayerSecretKey, epk);
  const key = deriveAesKey(shared);
  const plaintext = gcm(key, nonce, EXIT_AAD).decrypt(ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as ExitPayload;
}

export function relayerPublicKeyFromHex(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length !== 64) {
    throw new Error("Relayer X25519 public key must be 32 bytes hex");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
