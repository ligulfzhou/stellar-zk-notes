import { computeNullifier } from "./commitment-client";
import type { Note, StoredNoteVault } from "./note-types";
import { defaultVault } from "./note-types";
import { tryDecryptNote } from "./note-crypto";
import {
  deriveSpendingKeysFromSeed,
  diversifiedRecipientPk,
} from "./shielded-keys";
import { deriveShieldedReceiveKeysFromSeed } from "./root-seed";
import {
  fetchVaultChainEvents,
  isNullifierSpentOnChain,
  type VaultShieldedSendEvent,
} from "./vault-events";
import { hexToBytes } from "./bytes";

export type RescanResult = {
  vault: StoredNoteVault;
  notesAdded: number;
  eventsParsed: number;
};

async function tryDecryptForWallet(
  masterSeed: Uint8Array,
  maxDiversifier: number,
  epk: Uint8Array,
  encryptedNote: Uint8Array
) {
  for (let d = 0; d <= maxDiversifier; d++) {
    const { secretKey } = deriveShieldedReceiveKeysFromSeed(masterSeed, String(d));
    const payload = tryDecryptNote(secretKey, epk, encryptedNote);
    if (!payload) continue;
    const diversifier = payload.diversifier ?? String(d);
    const { spendingPk } = await deriveSpendingKeysFromSeed(masterSeed);
    const expectedPk = await diversifiedRecipientPk(spendingPk, diversifier);
    if (BigInt(payload.spendingPk) !== BigInt(expectedPk)) continue;
    return { payload, diversifier };
  }
  return null;
}

export async function rescanVaultFromChain(params: {
  ownerPubkey: string;
  rootSeed: Uint8Array;
  existingVault?: StoredNoteVault;
  onProgress?: (message: string) => void;
}): Promise<RescanResult> {
  const existing = params.existingVault ?? defaultVault();
  const { spendingSk } = await deriveSpendingKeysFromSeed(params.rootSeed);
  const maxDiversifier = Math.max(existing.addressIndex, 8);

  params.onProgress?.("Fetching vault events…");
  const events = await fetchVaultChainEvents();

  const notes: Note[] = [];
  const knownCommitments = new Set(
    existing.notes.map((n) => n.commitment.toLowerCase())
  );

  for (const note of existing.notes) {
    const copy = { ...note };
    try {
      const nullifier = await computeNullifier({
        spendingSk,
        valueStroops: copy.value,
        noteRandomness: copy.noteRandomness,
        diversifier: copy.diversifier,
      });
      const spent = await isNullifierSpentOnChain(nullifier, params.ownerPubkey);
      if (spent) copy.status = "spent";
    } catch {
      // keep prior status
    }
    notes.push(copy);
  }

  let notesAdded = 0;
  for (const event of events) {
    if (event.kind !== "shielded_send") continue;
    const send = event as VaultShieldedSendEvent;
    if (knownCommitments.has(send.newCommitment.toLowerCase())) continue;
    if (!send.encryptedNote.length) continue;

    const epk = hexToBytes(send.epk);
    const decrypted = await tryDecryptForWallet(
      params.rootSeed,
      maxDiversifier,
      epk,
      send.encryptedNote
    );
    if (!decrypted) continue;

    notes.push({
      id: crypto.randomUUID(),
      value: BigInt(decrypted.payload.valueStroops),
      noteRandomness: decrypted.payload.noteRandomness,
      spendingPk: decrypted.payload.spendingPk,
      diversifier: decrypted.diversifier,
      commitment: send.newCommitment,
      leafIndex: send.leafIndex,
      status: "unspent",
      createdAt: Date.now(),
      received: true,
    });
    knownCommitments.add(send.newCommitment.toLowerCase());
    notesAdded += 1;
  }

  const chainCommitments: string[] = [];
  for (const event of events) {
    if (event.kind === "deposit") {
      while (chainCommitments.length <= event.leafIndex) chainCommitments.push("");
      chainCommitments[event.leafIndex] = event.commitment;
    } else if (event.kind === "shielded_send") {
      while (chainCommitments.length <= event.leafIndex) chainCommitments.push("");
      chainCommitments[event.leafIndex] = event.newCommitment;
    }
  }

  const vault: StoredNoteVault = {
    ...existing,
    version: 7,
    notes,
    chainCommitments,
  };

  return { vault, notesAdded, eventsParsed: events.length };
}
