import { bytesToHex0x, normalizeHex } from "./bytes";
import { tryDecryptNote } from "./ecdh-delivery";
import { createNote } from "./note";
import type { Note, StoredNoteVault } from "./note-types";
import { deriveShieldedReceiveKeys } from "./shielded-keys";
import {
  fetchVaultChainEvents,
  type VaultShieldedSendEvent,
} from "./vault-events";

function hexToBytes(hex: string): Uint8Array {
  const h = normalizeHex(hex).slice(2);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function scanIncomingEncryptedNotes(params: {
  mnemonic: string;
  ownerPubkey: string;
  vault: StoredNoteVault;
}): Promise<{ notes: Note[]; chainCommitments: string[]; imported: number }> {
  const { secretKey } = deriveShieldedReceiveKeys(params.mnemonic);
  const events = await fetchVaultChainEvents();
  const chainCommitments = [...params.vault.chainCommitments];
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
      ownerPubkey: params.ownerPubkey,
      secret: payload.secret,
      nullifierSecret: payload.nullifierSecret,
      commitmentHex: event.newCommitment,
      leafIndex: event.leafIndex,
    });

    while (chainCommitments.length <= event.leafIndex) {
      chainCommitments.push("");
    }
    chainCommitments[event.leafIndex] = event.newCommitment;
    notes.push(note);
    imported += 1;
  }

  return {
    notes,
    chainCommitments: chainCommitments.filter(Boolean),
    imported,
  };
}

export function eventToActivityLabel(
  event: Awaited<ReturnType<typeof fetchVaultChainEvents>>[number]
): string {
  if (event.kind === "deposit") {
    return `Deposit ${Number(event.amount) / 1e7} XLM (leaf ${event.leafIndex})`;
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
