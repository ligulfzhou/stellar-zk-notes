import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

const WRAP_AAD = new TextEncoder().encode("zk-utxo-mnemonic-wrap-v1");

export type EncryptedMnemonic = {
  iv: string;
  ciphertext: string;
};

function toB64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromB64(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function wrapKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const material = new TextEncoder().encode(password);
  return hkdf(sha256, material, salt, WRAP_AAD, 32);
}

export function encryptMnemonic(
  mnemonic: string,
  key: Uint8Array
): EncryptedMnemonic {
  const iv = randomBytes(12);
  const plaintext = new TextEncoder().encode(mnemonic);
  const ciphertext = gcm(key, iv, WRAP_AAD).encrypt(plaintext);
  return { iv: toB64(iv), ciphertext: toB64(ciphertext) };
}

export function decryptMnemonic(
  encrypted: EncryptedMnemonic,
  key: Uint8Array
): string {
  const iv = fromB64(encrypted.iv);
  const ciphertext = fromB64(encrypted.ciphertext);
  const plaintext = gcm(key, iv, WRAP_AAD).decrypt(ciphertext);
  return new TextDecoder().decode(plaintext);
}

export function randomSalt(): Uint8Array {
  return randomBytes(16);
}

export function saltToB64(salt: Uint8Array): string {
  return toB64(salt);
}

export function saltFromB64(b64: string): Uint8Array {
  return fromB64(b64);
}
