import { computeNullifier } from "./commitment-client";
import type { Note, StoredNoteVault } from "./note-types";
import { defaultVault } from "./note-types";
import { deriveSpendingKeysFromSeed } from "./shielded-keys";
import { deriveShieldedReceiveKeysFromSeed } from "./root-seed";
import { tryDecryptNote } from "./note-crypto";
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

export async function rescanVaultFromChain(params: {
  ownerPubkey: string;
  rootSeed: Uint8Array;
  existingVault?: StoredNoteVault;
  onProgress?: (message: string) => void;
}): Promise<RescanResult> {
  const existing = params.existingVault ?? defaultVault();
  const { spendingSk, spendingPk } = await deriveSpendingKeysFromSeed(params.rootSeed);
  const { secretKey: x25519Sk } = deriveShieldedReceiveKeysFromSeed(params.rootSeed);

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
    const payload = tryDecryptNote(x25519Sk, epk, send.encryptedNote);
    if (!payload) continue;
    if (BigInt(payload.spendingPk) !== BigInt(spendingPk)) continue;

    notes.push({
      id: crypto.randomUUID(),
      value: BigInt(payload.valueStroops),
      noteRandomness: payload.noteRandomness,
      spendingPk: payload.spendingPk,
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
    version: 6,
    notes,
    chainCommitments,
  };

  return { vault, notesAdded, eventsParsed: events.length };
}
