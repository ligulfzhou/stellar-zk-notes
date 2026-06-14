import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

export type DeliveredNotePayload = {
  value: string;
  secret: string;
  nullifierSecret: string;
  commitment: string;
  leafIndex: number;
};

const NOTE_AAD = new TextEncoder().encode("zk-notes/note-v1");

function deriveAesKey(shared: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, new Uint8Array(), NOTE_AAD, 32);
}

export function encryptNoteForRecipient(
  recipientPublicKey: Uint8Array,
  payload: DeliveredNotePayload
): { epk: Uint8Array; encrypted: Uint8Array } {
  const esk = x25519.utils.randomSecretKey();
  const epk = x25519.getPublicKey(esk);
  const shared = x25519.getSharedSecret(esk, recipientPublicKey);
  const key = deriveAesKey(shared);
  const nonce = randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = gcm(key, nonce, NOTE_AAD).encrypt(plaintext);
  const encrypted = new Uint8Array(nonce.length + ciphertext.length);
  encrypted.set(nonce, 0);
  encrypted.set(ciphertext, nonce.length);
  return { epk, encrypted };
}

export function tryDecryptNote(
  recipientSecretKey: Uint8Array,
  epk: Uint8Array,
  encrypted: Uint8Array
): DeliveredNotePayload | null {
  if (encrypted.length < 13) return null;
  try {
    const nonce = encrypted.slice(0, 12);
    const ciphertext = encrypted.slice(12);
    const shared = x25519.getSharedSecret(recipientSecretKey, epk);
    const key = deriveAesKey(shared);
    const plaintext = gcm(key, nonce, NOTE_AAD).decrypt(ciphertext);
    return JSON.parse(
      new TextDecoder().decode(plaintext)
    ) as DeliveredNotePayload;
  } catch {
    return null;
  }
}
