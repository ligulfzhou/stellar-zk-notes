import {
  getVaultCommitmentAt,
  getVaultLeafCount,
  getVaultMerkleRoot,
  readVaultTreeState,
  type VaultTreeState,
} from "@/server/soroban-vault";
import {
  fetchVaultChainEvents,
  rebuildChainCommitments,
  mergeChainCommitments,
  seedCommitmentsFromNotes,
  type VaultChainEvent,
} from "@/lib/vault-events";

function missingLeafIndex(slots: string[], leafCount: number): number | null {
  for (let i = 0; i < leafCount; i++) {
    if (!slots[i]) return i;
  }
  return null;
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

  const missing =
    leafCount !== null ? missingLeafIndex(merged, leafCount) : null;

  return {
    events,
    commitments: merged,
    eventCount: events.length,
    leafCount,
    merkleRoot,
    missing,
    treeState,
    canProveWithTreeState: missing === null && treeState !== null,
  };
}

export async function fetchCommitmentAt(
  reader: string,
  leafIndex: number
): Promise<string | null> {
  return getVaultCommitmentAt(reader, leafIndex);
}
