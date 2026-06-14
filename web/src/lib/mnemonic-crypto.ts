const VAULT_SALT = "zk-notes-mnemonic-v1";

export type EncryptedMnemonic = {
  ciphertext: string;
  iv: string;
  salt: string;
};

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const saltBuf = new Uint8Array(salt);
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBuf, iterations: 120_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function toB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromB64(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function encryptMnemonic(
  mnemonic: string,
  pin: string
): Promise<EncryptedMnemonic> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);
  const ivBuf = new Uint8Array(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivBuf },
    key,
    new TextEncoder().encode(mnemonic)
  );
  return {
    salt: toB64(salt),
    iv: toB64(iv),
    ciphertext: toB64(new Uint8Array(ciphertext)),
  };
}

export async function decryptMnemonic(
  encrypted: EncryptedMnemonic,
  pin: string
): Promise<string> {
  const key = await deriveKey(pin, fromB64(encrypted.salt));
  const ivBuf = new Uint8Array(fromB64(encrypted.iv));
  const cipherBuf = new Uint8Array(fromB64(encrypted.ciphertext));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBuf },
    key,
    cipherBuf
  );
  return new TextDecoder().decode(plaintext);
}

export { VAULT_SALT };
