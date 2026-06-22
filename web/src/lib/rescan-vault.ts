import { computeCommitmentsBatch, computeNullifier } from "./commitment-client";
import { hexEquals } from "./bytes";
import { createNote } from "./note";
import type { Note, StoredNoteVault } from "./note-types";
import { defaultVault } from "./note-types";
import { deriveNoteSecretsFromSeed } from "./root-seed";
import {
  fetchVaultChainState,
  isNullifierSpentOnChain,
} from "./vault-events-client";
import type { VaultDepositEvent } from "./vault-events";

const DEFAULT_MAX_DERIVATION_SCAN = 1024;
const BATCH_SIZE = 16;

type DeriveFn = (index: number) => { secret: string; nullifierSecret: string };

async function findDerivationIndex(params: {
  deriveAt: DeriveFn;
  amount: bigint;
  commitment: string;
  usedIndices: Set<number>;
  maxScan: number;
  onProgress?: (current: number, total: number) => void;
}): Promise<number | null> {
  for (let start = 0; start < params.maxScan; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, params.maxScan);
    const batch = [];
    for (let i = start; i < end; i++) {
      if (params.usedIndices.has(i)) continue;
      const { secret, nullifierSecret } = params.deriveAt(i);
      batch.push({
        id: String(i),
        value: params.amount.toString(),
        secret,
        nullifierSecret,
      });
    }
    if (batch.length === 0) continue;
    params.onProgress?.(end, params.maxScan);
    const commitments = await computeCommitmentsBatch(batch);
    for (const [id, computed] of Object.entries(commitments)) {
      if (hexEquals(computed, params.commitment)) {
        return Number(id);
      }
    }
  }
  return null;
}

function mergeIncomingNotes(rescanned: Note[], existing: Note[]): Note[] {
  const byCommitment = new Map(rescanned.map((n) => [n.commitment, n]));
  for (const note of existing) {
    if (note.derivationIndex !== undefined) continue;
    if (!byCommitment.has(note.commitment)) {
      byCommitment.set(note.commitment, note);
    }
  }
  return [...byCommitment.values()].sort((a, b) => a.leafIndex - b.leafIndex);
}

export type RescanResult = {
  vault: StoredNoteVault;
  depositsMatched: number;
  depositsSkipped: number;
  eventsParsed: number;
};

/** Rebuild local vault from chain events + unlocked passkey root. */
export async function rescanVaultFromChain(params: {
  ownerPubkey: string;
  rootSeed: Uint8Array;
  existingVault?: StoredNoteVault;
  maxDerivationScan?: number;
  onProgress?: (message: string) => void;
}): Promise<RescanResult> {
  const maxScan = params.maxDerivationScan ?? DEFAULT_MAX_DERIVATION_SCAN;
  const existing = params.existingVault ?? defaultVault();

  const chainState = await fetchVaultChainState({
    reader: params.ownerPubkey,
    localCommitments: existing.chainCommitments,
  });
  const events = chainState.events;
  const chainCommitments = chainState.commitments;
  const myDeposits = events.filter(
    (e): e is VaultDepositEvent =>
      e.kind === "deposit" && e.depositor === params.ownerPubkey
  );

  const usedIndices = new Set<number>();
  const notes: Note[] = [];
  let depositsMatched = 0;
  let depositsSkipped = 0;

  for (const deposit of myDeposits) {
    params.onProgress?.("Matching passkey-derived indices…");
    const derivationIndex = await findDerivationIndex({
      deriveAt: (i) => deriveNoteSecretsFromSeed(params.rootSeed, i),
      amount: deposit.amount,
      commitment: deposit.commitment,
      usedIndices,
      maxScan,
      onProgress: (c, t) =>
        params.onProgress?.(`Passkey match ${c}/${t}…`),
    });

    if (derivationIndex === null) {
      depositsSkipped += 1;
      continue;
    }

    usedIndices.add(derivationIndex);
    const { secret, nullifierSecret } = deriveNoteSecretsFromSeed(
      params.rootSeed,
      derivationIndex
    );

    const note = await createNote({
      valueStroops: deposit.amount,
      ownerPubkey: params.ownerPubkey,
      secret,
      nullifierSecret,
      commitmentHex: deposit.commitment,
      leafIndex: deposit.leafIndex,
      derivationIndex,
    });

    try {
      const nullifier = await computeNullifier(nullifierSecret, deposit.commitment);
      const spent = await isNullifierSpentOnChain(nullifier, params.ownerPubkey);
      if (spent) note.status = "spent";
    } catch {
      // keep unspent if RPC check fails
    }

    notes.push(note);
    depositsMatched += 1;
  }

  const mergedNotes = mergeIncomingNotes(notes, existing.notes);
  const maxUsedIndex =
    usedIndices.size > 0 ? Math.max(...usedIndices) : -1;
  const nextDerivationIndex = Math.max(
    existing.nextDerivationIndex,
    maxUsedIndex + 1
  );

  const vault: StoredNoteVault = {
    ...existing,
    version: 3,
    nextDerivationIndex,
    notes: mergedNotes,
    chainCommitments,
  };

  return {
    vault,
    depositsMatched,
    depositsSkipped,
    eventsParsed: events.length,
  };
}
