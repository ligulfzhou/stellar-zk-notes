import { formatError } from "./format-error";
import {
  deserializeVaultEvents,
  type SerializedVaultChainEvent,
} from "./vault-events-serde";
import type { VaultChainEvent } from "./vault-events";

export type VaultChainState = {
  events: VaultChainEvent[];
  commitments: string[];
  eventCount: number;
  leafCount: number | null;
  merkleRoot: string | null;
  missing: number | null;
};

type VaultEventsApiResponse = {
  error?: string;
  events?: SerializedVaultChainEvent[];
  commitments?: string[];
  eventCount?: number;
  leafCount?: number | null;
  merkleRoot?: string | null;
  missing?: number | null;
};

/** Fetch vault events and Merkle state via server API (browser cannot call Soroban RPC). */
export async function fetchVaultChainState(params: {
  reader?: string;
  localCommitments?: string[];
  requireComplete?: boolean;
}): Promise<VaultChainState> {
  const res = await fetch("/api/vault-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reader: params.reader,
      localCommitments: params.localCommitments ?? [],
      requireComplete: params.requireComplete ?? false,
    }),
  });

  let data: VaultEventsApiResponse;
  try {
    data = (await res.json()) as VaultEventsApiResponse;
  } catch {
    throw new Error("Vault events API returned invalid JSON");
  }

  if (!res.ok || !data.events || !data.commitments) {
    throw new Error(data.error ?? formatError(data) ?? "Vault events fetch failed");
  }

  return {
    events: deserializeVaultEvents(data.events),
    commitments: data.commitments,
    eventCount: data.eventCount ?? data.events.length,
    leafCount: data.leafCount ?? null,
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
