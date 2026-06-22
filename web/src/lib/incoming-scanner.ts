import { bytesToHex0x, normalizeHex } from "./bytes";
import { tryDecryptNote } from "./ecdh-delivery";
import { createNote } from "./note";
import type { Note, StoredNoteVault } from "./note-types";
import { poolById } from "./pool-config";
import { deriveShieldedReceiveKeysFromRoot } from "./shielded-keys";
import { fetchVaultChainState } from "./vault-events-client";
import type { VaultChainEvent, VaultShieldedSendEvent } from "./vault-events";
import { upsertPoolChainCommitment } from "./vault-events";

function hexToBytes(hex: string): Uint8Array {
  const h = normalizeHex(hex).slice(2);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function scanIncomingEncryptedNotes(params: {
  ownerPubkey: string;
  vault: StoredNoteVault;
  rootSeed: Uint8Array;
}): Promise<{ notes: Note[]; poolChainCommitments: string[][]; imported: number }> {
  const { secretKey } = deriveShieldedReceiveKeysFromRoot(params.rootSeed);

  const chainState = await fetchVaultChainState({
    reader: params.ownerPubkey,
    localPoolCommitments: params.vault.poolChainCommitments,
    notes: params.vault.notes,
  });
  const events = chainState.events;
  let poolChainCommitments = chainState.poolCommitments.map((p) => [...p]);
  const notes = [...params.vault.notes];
  let imported = 0;

  const sends = events.filter(
    (e): e is VaultShieldedSendEvent => e.kind === "shielded_send"
  );

  for (const event of sends) {
    if (event.encryptedNote.length === 0) continue;
    if (notes.some((n) => n.commitment === event.newCommitment)) continue;

    const payload = tryDecryptNote(
      secretKey,
      hexToBytes(event.epk),
      event.encryptedNote
    );
    if (!payload) continue;

    const note = await createNote({
      valueStroops: BigInt(payload.value),
      poolId: event.poolId,
      ownerPubkey: params.ownerPubkey,
      secret: payload.secret,
      nullifierSecret: payload.nullifierSecret,
      commitmentHex: event.newCommitment,
      leafIndex: event.leafIndex,
    });

    poolChainCommitments = upsertPoolChainCommitment(
      poolChainCommitments,
      event.poolId,
      event.leafIndex,
      event.newCommitment
    );
    notes.push(note);
    imported += 1;
  }

  return {
    notes,
    poolChainCommitments,
    imported,
  };
}

export function eventToActivityLabel(event: VaultChainEvent): string {
  if (event.kind === "join") {
    const label = poolById(event.poolId).label;
    return `Join ${label} pool (leaf ${event.leafIndex})`;
  }
  if (event.kind === "exit") {
    return `Exit pool ${event.poolId} (nullifier spent)`;
  }
  const enc =
    event.encryptedNote.length > 0
      ? "encrypted note"
      : "commitment only";
  return `Shielded send → leaf ${event.leafIndex} (${enc})`;
}

export function commitmentHexFromBytes(data: Uint8Array): string {
  return bytesToHex0x(data);
}
