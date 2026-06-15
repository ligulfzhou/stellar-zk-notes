import {
  getVaultCommitmentAt,
  getVaultLeafCount,
  getVaultMerkleRoot,
  readVaultTreeState,
  type VaultTreeState,
} from "@/server/soroban-vault";
import {
  fetchVaultChainEvents,
  mergeChainCommitments,
  rebuildChainCommitments,
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
  localCommitments: string[] = [],
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

  let merged = mergeChainCommitments(localCommitments, remote, leafCount);
  merged = seedCommitmentsFromNotes(merged, notes, leafCount);

  if (reader && leafCount) {
    for (let i = 0; i < leafCount; i++) {
      if (merged[i]) continue;
      const onChain = await getVaultCommitmentAt(reader, i).catch(() => null);
      if (onChain) {
        while (merged.length <= i) merged.push("");
        merged[i] = onChain;
      }
    }
  }

  const missing = leafCount ? missingLeafIndex(merged, leafCount) : null;
  const canProveWithTreeState = missing !== null && treeState !== null;

  return {
    events,
    commitments: merged,
    eventCount: events.length,
    leafCount,
    merkleRoot,
    missing: canProveWithTreeState ? null : missing,
    treeState,
    canProveWithTreeState,
  };
}
