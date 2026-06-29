import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const ENCRYPTED_NOTE_MAX = 512;
const EPK_LEN = 32;
const NONCE_LEN = 12;

const NOTE_AAD = new TextEncoder().encode("zk-utxo/note-v2");

/** Encrypted delivery payload — spending_sk stays with recipient only. */
export type NoteDeliveryPayload = {
  valueStroops: string;
  noteRandomness: string;
  spendingPk: string;
};

function deriveAesKey(shared: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, new Uint8Array(), NOTE_AAD, 32);
}

function parseRecipientPubKey(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length !== 64) {
    throw new Error("Recipient delivery key must be 32-byte x25519 hex");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Encrypt note metadata for recipient x25519 (512-byte padded blob). */
export function encryptNoteForRecipient(
  recipientX25519Hex: string,
  payload: NoteDeliveryPayload
): { epk: Uint8Array; encryptedNote: Uint8Array } {
  const recipientPub = parseRecipientPubKey(recipientX25519Hex);
  const esk = x25519.utils.randomSecretKey();
  const epk = x25519.getPublicKey(esk);
  const shared = x25519.getSharedSecret(esk, recipientPub);
  const key = deriveAesKey(shared);
  const nonce = randomBytes(NONCE_LEN);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = gcm(key, nonce, NOTE_AAD).encrypt(plaintext);

  const blob = new Uint8Array(ENCRYPTED_NOTE_MAX);
  blob.set(epk, 0);
  blob.set(nonce, EPK_LEN);
  blob.set(ciphertext, EPK_LEN + NONCE_LEN);
  return { epk, encryptedNote: blob };
}

export function tryDecryptNote(
  recipientSecretKey: Uint8Array,
  epk: Uint8Array,
  encryptedNote: Uint8Array
): NoteDeliveryPayload | null {
  try {
    if (encryptedNote.length < EPK_LEN + NONCE_LEN + 1) return null;
    const nonce = encryptedNote.slice(EPK_LEN, EPK_LEN + NONCE_LEN);
    const ciphertext = encryptedNote.slice(EPK_LEN + NONCE_LEN);
    const shared = x25519.getSharedSecret(recipientSecretKey, epk);
    const key = deriveAesKey(shared);
    const plaintext = gcm(key, nonce, NOTE_AAD).decrypt(ciphertext);
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as NoteDeliveryPayload;
    if (!parsed.noteRandomness || !parsed.spendingPk) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function bytesToHex0x(bytes: Uint8Array): string {
  return "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export {
  formatShieldedReceiveAddress,
  parseShieldedReceiveAddress,
} from "./shielded-keys";
