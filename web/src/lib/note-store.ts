import { del, get, set } from "idb-keyval";
import type { EncryptedMnemonic } from "./encrypted-secrets";
import type { Note, StoredNoteVault } from "./note";
import { defaultVault, hasPasskey, hasWalletSecrets } from "./note-types";
import type { PasskeyVaultConfig } from "./passkey";

const VAULT_PREFIX = "zk-utxo:vault";
const PASSKEY_KEY = "zk-utxo:passkey";

function vaultKeyFor(pubkey: string): string {
  return `${VAULT_PREFIX}:${pubkey}`;
}

type SerializedNote = Omit<Note, "value"> & {
  value: string;
  diversifier?: string;
};

type SerializedVault = {
  version: 7;
  encryptedMnemonic?: EncryptedMnemonic | null;
  passwordSalt?: string | null;
  passkey?: PasskeyVaultConfig | null;
  addressIndex?: number;
  notes: SerializedNote[];
  chainCommitments: string[];
};

function serializeVault(vault: StoredNoteVault): SerializedVault {
  return {
    version: 7,
    encryptedMnemonic: vault.encryptedMnemonic,
    passwordSalt: vault.passwordSalt,
    passkey: vault.passkey,
    addressIndex: vault.addressIndex,
    notes: vault.notes.map((n) => ({
      ...n,
      value: n.value.toString(),
      diversifier: n.diversifier,
    })),
    chainCommitments: [...vault.chainCommitments],
  };
}

function deserializeVault(data: SerializedVault): StoredNoteVault {
  if (data.version !== 7) {
    throw new Error(
      "Unsupported vault version — create or import a v7 mnemonic privacy wallet"
    );
  }
  return {
    version: 7,
    encryptedMnemonic: data.encryptedMnemonic ?? null,
    passwordSalt: data.passwordSalt ?? null,
    passkey: data.passkey ?? null,
    addressIndex: data.addressIndex ?? 1,
    notes: data.notes.map((n) => ({
      ...n,
      value: BigInt(n.value),
      diversifier: n.diversifier ?? "0",
    })),
    chainCommitments: [...data.chainCommitments],
  };
}

async function loadGlobalPasskey(): Promise<PasskeyVaultConfig | null> {
  return (await get<PasskeyVaultConfig | null>(PASSKEY_KEY)) ?? null;
}

async function saveGlobalPasskey(config: PasskeyVaultConfig | null): Promise<void> {
  if (config) {
    await set(PASSKEY_KEY, config);
  } else {
    await del(PASSKEY_KEY);
  }
}

function withGlobalPasskey(
  vault: StoredNoteVault,
  passkey: PasskeyVaultConfig | null
): StoredNoteVault {
  return { ...vault, passkey: passkey ?? vault.passkey };
}

export async function loadVault(
  activePubkey?: string | null
): Promise<StoredNoteVault> {
  const passkey = await loadGlobalPasskey();
  if (!activePubkey) {
    return withGlobalPasskey(defaultVault(), passkey);
  }

  const raw = await get<SerializedVault>(vaultKeyFor(activePubkey));
  if (!raw) {
    return withGlobalPasskey(defaultVault(), passkey);
  }
  return withGlobalPasskey(deserializeVault(raw), passkey);
}

export async function loadChainCommitments(activePubkey: string): Promise<string[]> {
  return [...(await loadVault(activePubkey)).chainCommitments];
}

export async function saveVault(
  vault: StoredNoteVault,
  activePubkey: string
): Promise<void> {
  if (vault.passkey) {
    await saveGlobalPasskey(vault.passkey);
  }
  await set(vaultKeyFor(activePubkey), serializeVault(vault));
}

export async function savePasskeyConfig(
  config: PasskeyVaultConfig,
  activePubkey?: string | null
): Promise<void> {
  await saveGlobalPasskey(config);
  if (activePubkey) {
    const vault = await loadVault(activePubkey);
    vault.passkey = config;
    await saveVault(vault, activePubkey);
  }
}

export async function exportVaultJson(activePubkey: string): Promise<string> {
  const vault = await loadVault(activePubkey);
  const payload = serializeVault(vault);
  payload.encryptedMnemonic = null;
  if (payload.passkey) {
    payload.passkey = { ...payload.passkey, recoveryWraps: [] };
  }
  return JSON.stringify(payload, null, 2);
}

export function importVaultJson(json: string): StoredNoteVault {
  return deserializeVault(JSON.parse(json) as SerializedVault);
}

export async function getPasskeyConfig(): Promise<PasskeyVaultConfig | null> {
  return loadGlobalPasskey();
}

export async function bumpAddressIndex(activePubkey: string): Promise<number> {
  const vault = await loadVault(activePubkey);
  const index = vault.addressIndex;
  vault.addressIndex = index + 1;
  await saveVault(vault, activePubkey);
  return index;
}

export { hasPasskey, hasWalletSecrets };
