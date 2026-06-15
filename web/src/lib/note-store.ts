import { del, get, set } from "idb-keyval";
import type { Note, StoredNoteVault } from "./note";
import { defaultVault, hasPasskey } from "./note-types";
import type { PasskeyVaultConfig } from "./passkey";
import { deriveNoteSecretsFromSeed } from "./root-seed";
import { usePasskeyStore } from "@/store/usePasskeyStore";

const LEGACY_VAULT_KEY = "zk-notes:vault";
const PASSKEY_KEY = "zk-notes:passkey";
const MIGRATED_FLAG = "zk-notes:per-account-migrated";

function vaultKeyFor(pubkey: string): string {
  return `zk-notes:vault:${pubkey}`;
}

type LegacyVault = {
  version?: number;
  mnemonic?: string | null;
  encryptedMnemonic?: unknown;
  legacyMnemonic?: string | null;
  passkey?: PasskeyVaultConfig | null;
  nextDerivationIndex?: number;
  notes?: Note[];
  chainCommitments?: string[];
};

function migrateVault(raw: LegacyVault | StoredNoteVault | undefined): StoredNoteVault {
  if (!raw) return defaultVault();
  if (raw.version === 3 && "passkey" in raw) {
    return raw as StoredNoteVault;
  }
  const notes = (raw.notes ?? []).map((n) => {
    const { keySource: _ks, ...note } = n as Note & { keySource?: string };
    return note;
  });
  return {
    version: 3,
    passkey: raw.passkey ?? null,
    nextDerivationIndex: raw.nextDerivationIndex ?? notes.length,
    notes,
    chainCommitments: raw.chainCommitments ?? [],
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

function withGlobalPasskey(vault: StoredNoteVault, passkey: PasskeyVaultConfig | null): StoredNoteVault {
  return { ...vault, passkey: passkey ?? vault.passkey };
}

async function migrateLegacyVaultIfNeeded(): Promise<void> {
  if (await get<boolean>(MIGRATED_FLAG)) return;

  const legacy = await get<LegacyVault | StoredNoteVault>(LEGACY_VAULT_KEY);
  if (!legacy) {
    await set(MIGRATED_FLAG, true);
    return;
  }

  const vault = migrateVault(legacy);
  const passkey = vault.passkey;
  if (passkey) await saveGlobalPasskey(passkey);

  const byOwner = new Map<string, Note[]>();
  for (const note of vault.notes) {
    const owner = note.ownerPubkey;
    const list = byOwner.get(owner) ?? [];
    list.push(note);
    byOwner.set(owner, list);
  }

  for (const [pubkey, notes] of byOwner) {
    const maxDerivation = notes.reduce(
      (max, note) =>
        note.derivationIndex !== undefined
          ? Math.max(max, note.derivationIndex)
          : max,
      -1
    );
    const accountVault: StoredNoteVault = {
      version: 3,
      passkey,
      nextDerivationIndex: Math.max(
        vault.nextDerivationIndex,
        maxDerivation + 1,
        notes.length
      ),
      notes,
      chainCommitments: [...vault.chainCommitments],
    };
    await set(vaultKeyFor(pubkey), accountVault);
  }

  await del(LEGACY_VAULT_KEY);
  await set(MIGRATED_FLAG, true);
}

/** Load vault for the active Stellar account (notes are per G… address). */
export async function loadVault(
  activePubkey?: string | null
): Promise<StoredNoteVault> {
  await migrateLegacyVaultIfNeeded();
  const passkey = await loadGlobalPasskey();

  if (!activePubkey) {
    return withGlobalPasskey(defaultVault(), passkey);
  }

  const raw = await get<LegacyVault | StoredNoteVault>(vaultKeyFor(activePubkey));
  return withGlobalPasskey(migrateVault(raw), passkey);
}

export async function loadNotes(activePubkey: string): Promise<Note[]> {
  return (await loadVault(activePubkey)).notes;
}

export async function loadChainCommitments(activePubkey: string): Promise<string[]> {
  return (await loadVault(activePubkey)).chainCommitments;
}

export async function saveVault(
  vault: StoredNoteVault,
  activePubkey: string
): Promise<void> {
  if (vault.passkey) {
    await saveGlobalPasskey(vault.passkey);
  }
  await set(vaultKeyFor(activePubkey), vault);
}

export async function saveNotes(notes: Note[], activePubkey: string): Promise<void> {
  const vault = await loadVault(activePubkey);
  vault.notes = notes;
  await saveVault(vault, activePubkey);
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

export async function allocateDerivationIndex(activePubkey: string): Promise<number> {
  const vault = await loadVault(activePubkey);
  const index = vault.nextDerivationIndex;
  vault.nextDerivationIndex = index + 1;
  await saveVault(vault, activePubkey);
  return index;
}

export async function deriveAndAllocateNoteSecrets(activePubkey: string): Promise<{
  secret: string;
  nullifierSecret: string;
  derivationIndex: number;
}> {
  const vault = await loadVault(activePubkey);
  if (!hasPasskey(vault)) {
    throw new Error("Register a passkey first (Notes → Create passkey)");
  }

  const rootSeed = usePasskeyStore.getState().requireSeed();
  const derivationIndex = await allocateDerivationIndex(activePubkey);
  const { secret, nullifierSecret } = deriveNoteSecretsFromSeed(
    rootSeed,
    derivationIndex
  );
  return { secret, nullifierSecret, derivationIndex };
}

type SerializedNote = Omit<Note, "value"> & { value: string };

type SerializedVault = {
  version: 3;
  passkey?: PasskeyVaultConfig | null;
  nextDerivationIndex?: number;
  notes: SerializedNote[];
  chainCommitments: string[];
};

function serializeVault(vault: StoredNoteVault): SerializedVault {
  return {
    version: 3,
    passkey: vault.passkey,
    nextDerivationIndex: vault.nextDerivationIndex,
    notes: vault.notes.map((n) => ({ ...n, value: n.value.toString() })),
    chainCommitments: vault.chainCommitments,
  };
}

function deserializeVault(data: SerializedVault): StoredNoteVault {
  if (data.version !== 3) {
    throw new Error("Unsupported vault version — import v3 JSON only");
  }
  return migrateVault({
    version: 3,
    passkey: data.passkey ?? null,
    nextDerivationIndex: data.nextDerivationIndex ?? data.notes.length,
    notes: data.notes.map((n) => ({ ...n, value: BigInt(n.value) })),
    chainCommitments: data.chainCommitments ?? [],
  });
}

export async function exportVaultJson(activePubkey: string): Promise<string> {
  const vault = await loadVault(activePubkey);
  const payload = serializeVault(vault);
  if (payload.passkey) {
    payload.passkey = { ...payload.passkey, recoveryWraps: [] };
  }
  return JSON.stringify(payload, null, 2);
}

export function importVaultJson(json: string): StoredNoteVault {
  const parsed = JSON.parse(json) as SerializedVault | LegacyVault;
  if ("version" in parsed && parsed.version === 3) {
    return deserializeVault(parsed as SerializedVault);
  }
  return migrateVault(parsed as LegacyVault);
}

export async function exportNotesJson(activePubkey: string): Promise<string> {
  return exportVaultJson(activePubkey);
}

export async function getPasskeyConfig(): Promise<PasskeyVaultConfig | null> {
  return loadGlobalPasskey();
}
