import {
  computeCommitmentsV2Batch,
  computeNullifier,
  depositSecretToHex,
} from "./commitment-client";
import { hexEquals } from "./bytes";
import { createNote } from "./note";
import type { Note, StoredNoteVault } from "./note-types";
import { defaultVault } from "./note-types";
import {
  deriveDepositSecretFromSeed,
  deriveNoteSecretsFromSeed,
} from "./root-seed";
import { poolById } from "./pool-config";
import {
  fetchVaultChainState,
  isNullifierSpentOnChain,
} from "./vault-events-client";
import type { VaultJoinEvent } from "./vault-events";
import { joinEventAmountStroops } from "./vault-events";

const DEFAULT_MAX_DERIVATION_SCAN = 1024;
const BATCH_SIZE = 16;

type DeriveFn = (index: number) => {
  secret: string;
  nullifierSecret: string;
  depositSecret: Uint8Array;
};

async function findDerivationIndex(params: {
  deriveAt: DeriveFn;
  amount: bigint;
  poolId: number;
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
      const { secret, nullifierSecret, depositSecret } = params.deriveAt(i);
      batch.push({
        id: String(i),
        value: params.amount.toString(),
        secret,
        nullifierSecret,
        depositSecret,
        poolId: params.poolId,
      });
    }
    if (batch.length === 0) continue;
    params.onProgress?.(end, params.maxScan);
    const commitments = await computeCommitmentsV2Batch(batch);
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
  joinsMatched: number;
  joinsSkipped: number;
  eventsParsed: number;
};

/** Rebuild local vault from chain join events + unlocked passkey root. */
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
    localPoolCommitments: existing.poolChainCommitments,
    notes: existing.notes,
  });
  const events = chainState.events;
  const poolChainCommitments = chainState.poolCommitments;
  const joinEvents = events.filter((e): e is VaultJoinEvent => e.kind === "join");

  const usedIndices = new Set<number>();
  const notes: Note[] = [];
  let joinsMatched = 0;
  let joinsSkipped = 0;

  for (const join of joinEvents) {
    params.onProgress?.(
      `Matching passkey indices for pool ${poolById(join.poolId).label}…`
    );
    const amount = joinEventAmountStroops(join);
    const derivationIndex = await findDerivationIndex({
      deriveAt: (i) => ({
        ...deriveNoteSecretsFromSeed(params.rootSeed, i),
        depositSecret: deriveDepositSecretFromSeed(params.rootSeed, i),
      }),
      amount,
      poolId: join.poolId,
      commitment: join.commitment,
      usedIndices,
      maxScan,
      onProgress: (c, t) =>
        params.onProgress?.(`Passkey match ${c}/${t}…`),
    });

    if (derivationIndex === null) {
      joinsSkipped += 1;
      continue;
    }

    usedIndices.add(derivationIndex);
    const { secret, nullifierSecret } = deriveNoteSecretsFromSeed(
      params.rootSeed,
      derivationIndex
    );
    const depositSecret = deriveDepositSecretFromSeed(
      params.rootSeed,
      derivationIndex
    );

    const note = await createNote({
      valueStroops: amount,
      poolId: join.poolId,
      ownerPubkey: params.ownerPubkey,
      secret,
      nullifierSecret,
      depositSecretHex: depositSecretToHex(depositSecret),
      commitmentHex: join.commitment,
      leafIndex: join.leafIndex,
      derivationIndex,
    });

    try {
      const nullifier = await computeNullifier(nullifierSecret, join.commitment);
      const spent = await isNullifierSpentOnChain(nullifier, params.ownerPubkey);
      if (spent) note.status = "spent";
    } catch {
      // keep unspent if RPC check fails
    }

    notes.push(note);
    joinsMatched += 1;
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
    version: 4,
    nextDerivationIndex,
    notes: mergedNotes,
    poolChainCommitments,
  };

  return {
    vault,
    joinsMatched,
    joinsSkipped,
    eventsParsed: events.length,
  };
}
