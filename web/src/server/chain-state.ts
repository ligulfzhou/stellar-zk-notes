import {
  fetchVaultChainEvents,
  mergeChainCommitments,
  rebuildChainCommitments,
  seedCommitmentsFromNotes,
  type VaultChainEvent,
} from "@/lib/vault-events";
import {
  getVaultCommitmentAt,
  getVaultLeafCount,
  getVaultMerkleRoot,
  readVaultTreeState,
  type VaultTreeState,
} from "@/server/soroban-vault";

function commitmentGaps(slots: string[], leafCount: number): number | null {
  for (let i = 0; i < leafCount; i++) {
    if (!slots[i]) return i;
  }
  return null;
}

/** Read all leaf commitments from vault storage (authoritative for Merkle tree). */
async function syncCommitmentsFromContract(
  reader: string,
  leafCount: number
): Promise<string[]> {
  const slots = await Promise.all(
    Array.from({ length: leafCount }, (_, i) => fetchCommitmentAt(reader, i))
  );
  return slots.map((c) => c ?? "");
}

export type ChainState = {
  events: VaultChainEvent[];
  commitments: string[];
  eventCount: number;
  leafCount: number | null;
  merkleRoot: string | null;
  missing: number | null;
  treeState: VaultTreeState | null;
  canProveWithTreeState: boolean;
};

export async function buildChainState(
  reader?: string,
  localChainCommitments: string[] = [],
  notes: Array<{ leafIndex: number; commitment: string }> = []
): Promise<ChainState> {
  const events = await fetchVaultChainEvents();
  const remote = rebuildChainCommitments(events);
  let leafCount: number | null = null;
  let merkleRoot: string | null = null;
  let treeState: VaultTreeState | null = null;

  if (reader) {
    leafCount = await getVaultLeafCount(reader).catch(() => null);
    merkleRoot = await getVaultMerkleRoot(reader).catch(() => null);
    treeState = await readVaultTreeState(reader).catch(() => null);
  }

  let merged = mergeChainCommitments(localChainCommitments, remote, leafCount);
  merged = seedCommitmentsFromNotes(merged, notes, leafCount);

  if (reader && leafCount !== null && leafCount > 0) {
    merged = await syncCommitmentsFromContract(reader, leafCount);
  }

  const effectiveLeafCount =
    leafCount ?? (merged.length > 0 ? merged.length : null);
  const missing =
    effectiveLeafCount !== null
      ? commitmentGaps(merged, effectiveLeafCount)
      : null;

  return {
    events,
    commitments: merged,
    eventCount: events.length,
    leafCount: leafCount ?? effectiveLeafCount,
    merkleRoot,
    missing,
    treeState,
    canProveWithTreeState:
      missing === null &&
      treeState !== null &&
      treeState.filled.length >= 16 &&
      treeState.zeros.length >= 16,
  };
}

export async function fetchCommitmentAt(
  reader: string,
  leafIndex: number
): Promise<string | null> {
  return getVaultCommitmentAt(reader, leafIndex);
}
