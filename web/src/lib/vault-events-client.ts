import { formatError } from "./format-error";
import {
  deserializeVaultEvents,
  type SerializedVaultChainEvent,
} from "./vault-events-serde";
import type { VaultChainEvent } from "./vault-events";

export type VaultChainState = {
  events: VaultChainEvent[];
  poolCommitments: string[][];
  commitments: string[];
  eventCount: number;
  leafCount: number | null;
  poolLeafCounts: Array<number | null>;
  merkleRoot: string | null;
  missing: number | null;
};

type VaultEventsApiResponse = {
  error?: string;
  events?: SerializedVaultChainEvent[];
  poolCommitments?: string[][];
  commitments?: string[];
  eventCount?: number;
  leafCount?: number | null;
  poolLeafCounts?: Array<number | null>;
  merkleRoot?: string | null;
  missing?: number | null;
};

type VaultNoteRef = {
  leafIndex: number;
  commitment: string;
  poolId?: number;
};

function notesForApi(notes: VaultNoteRef[]) {
  return notes.map((n) => ({
    leafIndex: n.leafIndex,
    commitment: n.commitment,
    poolId: n.poolId ?? 0,
  }));
}

/** Fetch vault events and Merkle state via server API (browser cannot call Soroban RPC). */
export async function fetchVaultChainState(params: {
  reader?: string;
  localChainCommitments?: string[];
  /** @deprecated use localChainCommitments */
  localPoolCommitments?: string[][];
  localCommitments?: string[];
  notes?: VaultNoteRef[];
  requireComplete?: boolean;
}): Promise<VaultChainState> {
  const localChain =
    params.localChainCommitments ??
    params.localCommitments ??
    params.localPoolCommitments?.[0] ??
    [];

  const res = await fetch("/api/vault-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reader: params.reader,
      localChainCommitments: localChain,
      notes: notesForApi(params.notes ?? []),
      requireComplete: params.requireComplete ?? false,
    }),
  });

  let data: VaultEventsApiResponse;
  try {
    data = (await res.json()) as VaultEventsApiResponse;
  } catch {
    throw new Error("Vault events API returned invalid JSON");
  }

  if (!res.ok || !data.events) {
    throw new Error(data.error ?? formatError(data) ?? "Vault events fetch failed");
  }

  const commitments = data.commitments ?? data.poolCommitments?.[0] ?? [];

  return {
    events: deserializeVaultEvents(data.events),
    poolCommitments: data.poolCommitments ?? [commitments],
    commitments,
    eventCount: data.eventCount ?? data.events.length,
    leafCount: data.leafCount ?? null,
    poolLeafCounts: data.poolLeafCounts ?? [],
    merkleRoot: data.merkleRoot ?? null,
    missing: data.missing ?? null,
  };
}

export async function isNullifierSpentOnChain(
  nullifierHex: string,
  readerPublicKey: string
): Promise<boolean> {
  const res = await fetch("/api/nullifier-spent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nullifierHex, reader: readerPublicKey }),
  });
  const data = (await res.json()) as { spent?: boolean; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "nullifier spent check failed");
  }
  return Boolean(data.spent);
}
