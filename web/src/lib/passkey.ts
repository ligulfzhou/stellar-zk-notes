import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { rootSeedFromPrf } from "./root-seed";

const RECOVERY_WRAP_INFO = new TextEncoder().encode("zk-notes-recovery-wrap-v1");

export type PasskeyCredentialMeta = {
  id: string;
  label: string;
  createdAt: number;
  role: "primary" | "recovery";
};

export type PasskeyRecoveryWrap = {
  credentialId: string;
  iv: string;
  ciphertext: string;
};

export type PasskeyVaultConfig = {
  userId: string;
  prfSalt: string;
  credentials: PasskeyCredentialMeta[];
  recoveryWraps: PasskeyRecoveryWrap[];
};

type PrfExtensionResults = {
  enabled?: boolean;
  results?: { first?: ArrayBuffer };
};

function getRpId(): string {
  const host = window.location.hostname;
  return host === "127.0.0.1" ? "localhost" : host;
}

function bufferCopy(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function toB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (padded.length % 4)) % 4;
  const raw = atob(padded + "=".repeat(pad));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function prfFromCredential(credential: PublicKeyCredential): Uint8Array {
  const ext = credential.getClientExtensionResults() as {
    prf?: PrfExtensionResults;
  };
  const first = ext.prf?.results?.first;
  if (!first) {
    throw new Error("Passkey PRF not available — use Safari 17+ or Chrome 118+");
  }
  return new Uint8Array(first);
}

function recoveryWrapKey(prfOutput: Uint8Array): Uint8Array {
  return hkdf(sha256, prfOutput, new Uint8Array(), RECOVERY_WRAP_INFO, 32);
}

export function isPasskeySupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof PublicKeyCredential !== "undefined" &&
    typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable ===
      "function"
  );
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isPasskeySupported()) return false;
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
}

/** Register primary passkey and derive root seed via PRF. */
export async function registerPrimaryPasskey(
  label = "Primary passkey"
): Promise<{ config: PasskeyVaultConfig; rootSeed: Uint8Array }> {
  if (!isPasskeySupported()) {
    throw new Error("WebAuthn passkeys are not supported in this browser");
  }

  const userId = crypto.getRandomValues(new Uint8Array(16));
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "zk-notes", id: getRpId() },
      user: {
        id: userId as BufferSource,
        name: "shielded-wallet",
        displayName: "zk-notes Shielded Wallet",
      },
      challenge,
      pubKeyCredParams: [
        { alg: -7, type: "public-key" },
        { alg: -257, type: "public-key" },
      ],
      authenticatorSelection: {
        userVerification: "required",
        residentKey: "preferred",
      },
      extensions: {
        prf: { eval: { first: prfSalt as BufferSource } },
      },
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Passkey registration cancelled");
  }

  const prfBytes = prfFromCredential(credential);
  const rootSeed = rootSeedFromPrf(prfBytes);
  const rawId = new Uint8Array(credential.rawId);

  const config: PasskeyVaultConfig = {
    userId: toB64url(userId),
    prfSalt: toB64url(prfSalt),
    credentials: [
      {
        id: toB64url(rawId),
        label,
        createdAt: Date.now(),
        role: "primary",
      },
    ],
    recoveryWraps: [],
  };

  return { config, rootSeed };
}

/** Unlock with a registered passkey (primary PRF or recovery wrap). */
export async function unlockPasskey(
  config: PasskeyVaultConfig,
  credentialId?: string
): Promise<Uint8Array> {
  const prfSalt = bufferCopy(fromB64url(config.prfSalt));
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const allowCredentials: PublicKeyCredentialDescriptor[] = credentialId
    ? [
        {
          id: bufferCopy(fromB64url(credentialId)) as BufferSource,
          type: "public-key",
        },
      ]
    : config.credentials.map((c) => ({
        id: bufferCopy(fromB64url(c.id)) as BufferSource,
        type: "public-key" as PublicKeyCredentialDescriptor["type"],
      }));

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: getRpId(),
      allowCredentials,
      userVerification: "required",
      extensions: {
        prf: { eval: { first: prfSalt as BufferSource } },
      },
    },
  })) as PublicKeyCredential | null;

  if (!assertion) {
    throw new Error("Passkey unlock cancelled");
  }

  const usedId = toB64url(new Uint8Array(assertion.rawId));
  const meta = config.credentials.find((c) => c.id === usedId);
  const wrap = config.recoveryWraps.find((w) => w.credentialId === usedId);

  if (meta?.role === "recovery" && wrap) {
    const prfBytes = prfFromCredential(assertion);
    const key = recoveryWrapKey(prfBytes);
    const iv = fromB64url(wrap.iv);
    const ciphertext = fromB64url(wrap.ciphertext);
    const plaintext = gcm(key, iv, RECOVERY_WRAP_INFO).decrypt(ciphertext);
    return new Uint8Array(plaintext);
  }

  const prfBytes = prfFromCredential(assertion);
  return rootSeedFromPrf(prfBytes);
}

/** Add a backup passkey that can unwrap the same root seed. */
export async function registerRecoveryPasskey(
  config: PasskeyVaultConfig,
  rootSeed: Uint8Array,
  label = "Recovery passkey"
): Promise<PasskeyVaultConfig> {
  const userId = bufferCopy(fromB64url(config.userId));
  const prfSalt = bufferCopy(fromB64url(config.prfSalt));
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "zk-notes", id: getRpId() },
      user: {
        id: userId as BufferSource,
        name: "shielded-wallet",
        displayName: "zk-notes Shielded Wallet",
      },
      challenge,
      pubKeyCredParams: [
        { alg: -7, type: "public-key" },
        { alg: -257, type: "public-key" },
      ],
      authenticatorSelection: {
        userVerification: "required",
        residentKey: "preferred",
      },
      extensions: {
        prf: { eval: { first: prfSalt as BufferSource } },
      },
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Recovery passkey registration cancelled");
  }

  const prfBytes = prfFromCredential(credential);
  const key = recoveryWrapKey(prfBytes);
  const iv = randomBytes(12);
  const ciphertext = gcm(key, iv, RECOVERY_WRAP_INFO).encrypt(rootSeed);
  const rawId = toB64url(new Uint8Array(credential.rawId));

  return {
    ...config,
    credentials: [
      ...config.credentials,
      {
        id: rawId,
        label,
        createdAt: Date.now(),
        role: "recovery",
      },
    ],
    recoveryWraps: [
      ...config.recoveryWraps,
      {
        credentialId: rawId,
        iv: toB64url(iv),
        ciphertext: toB64url(ciphertext),
      },
    ],
  };
}
