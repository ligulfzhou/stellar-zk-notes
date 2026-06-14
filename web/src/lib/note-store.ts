import { get, set } from "idb-keyval";
import type { Note, StoredNoteVault } from "./note";
import { defaultVault } from "./note-types";
import {
  deriveNoteSecrets,
  generateWalletMnemonic,
  isValidMnemonic,
  normalizeMnemonic,
} from "./mnemonic";
import {
  decryptMnemonic,
  encryptMnemonic,
  type EncryptedMnemonic,
} from "./mnemonic-crypto";

const VAULT_KEY = "zk-notes:vault";

type LegacyVaultV1 = {
  version?: 1;
  notes?: Note[];
  chainCommitments?: string[];
};

function migrateVault(raw: LegacyVaultV1 | StoredNoteVault | undefined): StoredNoteVault {
  if (!raw) return defaultVault();
  if (raw.version === 2) {
    return {
      version: 2,
      mnemonic: raw.mnemonic ?? null,
      encryptedMnemonic: raw.encryptedMnemonic ?? null,
      nextDerivationIndex: raw.nextDerivationIndex ?? raw.notes.length,
      notes: raw.notes,
      chainCommitments: raw.chainCommitments ?? [],
    };
  }
  const notes = raw.notes ?? [];
  return {
    version: 2,
    mnemonic: null,
    nextDerivationIndex: notes.length,
    notes,
    chainCommitments: raw.chainCommitments ?? [],
  };
}

export async function loadVault(): Promise<StoredNoteVault> {
  const vault = await get<LegacyVaultV1 | StoredNoteVault>(VAULT_KEY);
  return migrateVault(vault);
}

export async function loadNotes(): Promise<Note[]> {
  return (await loadVault()).notes;
}

export async function loadChainCommitments(): Promise<string[]> {
  return (await loadVault()).chainCommitments;
}

export async function saveVault(vault: StoredNoteVault): Promise<void> {
  await set(VAULT_KEY, vault);
}

export async function saveNotes(notes: Note[]): Promise<void> {
  const vault = await loadVault();
  vault.notes = notes;
  await saveVault(vault);
}

export async function getWalletMnemonic(): Promise<string | null> {
  const vault = await loadVault();
  return vault.mnemonic;
}

export async function hasEncryptedMnemonic(): Promise<boolean> {
  const vault = await loadVault();
  return Boolean(vault.encryptedMnemonic && !vault.mnemonic);
}

/** Resolve mnemonic from plain storage or PIN-decrypted vault. */
export async function resolveWalletMnemonic(pin?: string): Promise<string | null> {
  const vault = await loadVault();
  if (vault.mnemonic) return vault.mnemonic;
  if (!vault.encryptedMnemonic) return null;
  if (!pin) return null;
  return decryptMnemonic(vault.encryptedMnemonic, pin);
}

export async function setWalletMnemonic(mnemonic: string): Promise<void> {
  const normalized = normalizeMnemonic(mnemonic);
  if (!isValidMnemonic(normalized)) {
    throw new Error("Invalid recovery phrase");
  }
  const vault = await loadVault();
  vault.mnemonic = normalized;
  vault.encryptedMnemonic = null;
  await saveVault(vault);
}

export async function encryptWalletMnemonicWithPin(pin: string): Promise<void> {
  const vault = await loadVault();
  const phrase = vault.mnemonic;
  if (!phrase) {
    throw new Error("No recovery phrase to encrypt");
  }
  if (pin.length < 4) {
    throw new Error("PIN must be at least 4 characters");
  }
  vault.encryptedMnemonic = await encryptMnemonic(phrase, pin);
  vault.mnemonic = null;
  await saveVault(vault);
}

export async function unlockWalletMnemonic(pin: string): Promise<string> {
  const vault = await loadVault();
  if (vault.mnemonic) return vault.mnemonic;
  if (!vault.encryptedMnemonic) {
    throw new Error("No encrypted recovery phrase");
  }
  const phrase = await decryptMnemonic(vault.encryptedMnemonic, pin);
  vault.mnemonic = phrase;
  await saveVault(vault);
  return phrase;
}

export async function ensureWalletMnemonic(): Promise<{
  mnemonic: string;
  isNew: boolean;
}> {
  const vault = await loadVault();
  if (vault.mnemonic) {
    return { mnemonic: vault.mnemonic, isNew: false };
  }
  if (vault.encryptedMnemonic) {
    throw new Error("Recovery phrase is PIN-locked — unlock in Notes first");
  }
  const mnemonic = generateWalletMnemonic();
  vault.mnemonic = mnemonic;
  await saveVault(vault);
  return { mnemonic, isNew: true };
}

/** Reserve and return the next derivation index (persisted). */
export async function allocateDerivationIndex(): Promise<number> {
  const vault = await loadVault();
  const index = vault.nextDerivationIndex;
  vault.nextDerivationIndex = index + 1;
  await saveVault(vault);
  return index;
}

export async function deriveAndAllocateNoteSecrets(): Promise<{
  secret: string;
  nullifierSecret: string;
  derivationIndex: number;
  mnemonic: string;
  mnemonicIsNew: boolean;
}> {
  const { mnemonic, isNew } = await ensureWalletMnemonic();
  const derivationIndex = await allocateDerivationIndex();
  const { secret, nullifierSecret } = deriveNoteSecrets(mnemonic, derivationIndex);
  return {
    secret,
    nullifierSecret,
    derivationIndex,
    mnemonic,
    mnemonicIsNew: isNew,
  };
}

type SerializedNote = Omit<Note, "value"> & { value: string };

type SerializedVault = {
  version: 2;
  mnemonic?: string | null;
  encryptedMnemonic?: EncryptedMnemonic | null;
  nextDerivationIndex?: number;
  notes: SerializedNote[];
  chainCommitments: string[];
};

function serializeVault(vault: StoredNoteVault): SerializedVault {
  return {
    version: 2,
    mnemonic: vault.mnemonic,
    encryptedMnemonic: vault.encryptedMnemonic,
    nextDerivationIndex: vault.nextDerivationIndex,
    notes: vault.notes.map((n) => ({ ...n, value: n.value.toString() })),
    chainCommitments: vault.chainCommitments,
  };
}

function deserializeVault(data: SerializedVault): StoredNoteVault {
  if (data.version !== 2) {
    throw new Error("Unsupported vault version — import v2 JSON only");
  }
  return migrateVault({
    version: 2,
    mnemonic: data.mnemonic ?? null,
    encryptedMnemonic: data.encryptedMnemonic ?? null,
    nextDerivationIndex: data.nextDerivationIndex ?? data.notes.length,
    notes: data.notes.map((n) => ({ ...n, value: BigInt(n.value) })),
    chainCommitments: data.chainCommitments ?? [],
  });
}

/** Export notes + chain state. Mnemonic is omitted by default for safety. */
export async function exportVaultJson(includeMnemonic = false): Promise<string> {
  const vault = await loadVault();
  const payload = serializeVault(vault);
  if (!includeMnemonic) {
    delete payload.mnemonic;
  }
  return JSON.stringify(payload, null, 2);
}

export function importVaultJson(json: string): StoredNoteVault {
  const parsed = JSON.parse(json) as SerializedVault | LegacyVaultV1;
  if ("version" in parsed && parsed.version === 2) {
    return deserializeVault(parsed as SerializedVault);
  }
  return migrateVault(parsed);
}

/** @deprecated Use exportVaultJson */
export async function exportNotesJson(): Promise<string> {
  return exportVaultJson();
}
