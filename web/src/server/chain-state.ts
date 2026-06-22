import {
  getVaultCommitmentAt,
  getVaultLeafCount,
  getVaultMerkleRoot,
  readVaultTreeState,
  type VaultTreeState,
} from "@/server/soroban-vault";
import { POOL_COUNT } from "@/lib/pool-config";
import {
  fetchVaultChainEvents,
  mergePoolChainCommitments,
  rebuildPoolChainCommitments,
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
  poolCommitments: string[][];
  commitments: string[];
  eventCount: number;
  leafCount: number | null;
  poolLeafCounts: Array<number | null>;
  merkleRoot: string | null;
  poolMerkleRoots: Array<string | null>;
  missing: number | null;
  treeState: VaultTreeState | null;
  canProveWithTreeState: boolean;
};

export async function buildChainState(
  reader?: string,
  localPoolCommitments: string[][] = [],
  notes: Array<{ leafIndex: number; commitment: string; poolId?: number }> = []
): Promise<ChainState> {
  const events = await fetchVaultChainEvents();
  const remote = rebuildPoolChainCommitments(events);
  let leafCount: number | null = null;
  let merkleRoot: string | null = null;
  let treeState: VaultTreeState | null = null;
  const poolLeafCounts: Array<number | null> = Array(POOL_COUNT).fill(null);
  const poolMerkleRoots: Array<string | null> = Array(POOL_COUNT).fill(null);

  if (reader) {
    leafCount = await getVaultLeafCount(reader, 0).catch(() => null);
    merkleRoot = await getVaultMerkleRoot(reader, 0).catch(() => null);
    treeState = await readVaultTreeState(reader, 0).catch(() => null);
    for (let poolId = 0; poolId < POOL_COUNT; poolId++) {
      poolLeafCounts[poolId] = await getVaultLeafCount(reader, poolId).catch(
        () => null
      );
      poolMerkleRoots[poolId] = await getVaultMerkleRoot(reader, poolId).catch(
        () => null
      );
    }
  }

  let merged = mergePoolChainCommitments(
    localPoolCommitments,
    remote,
    poolLeafCounts
  );
  merged = seedCommitmentsFromNotes(merged, notes, poolLeafCounts);

  if (reader) {
    for (let poolId = 0; poolId < POOL_COUNT; poolId++) {
      const count = poolLeafCounts[poolId];
      if (!count) continue;
      for (let i = 0; i < count; i++) {
        if (merged[poolId]![i]) continue;
        const onChain = await getVaultCommitmentAt(reader, poolId, i).catch(
          () => null
        );
        if (onChain) {
          while (merged[poolId]!.length <= i) merged[poolId]!.push("");
          merged[poolId]![i] = onChain;
        }
      }
    }
  }

  let missing: number | null = null;
  for (let poolId = 0; poolId < POOL_COUNT; poolId++) {
    const count = poolLeafCounts[poolId];
    if (!count) continue;
    const gap = missingLeafIndex(merged[poolId] ?? [], count);
    if (gap !== null) {
      missing = gap;
      break;
    }
  }
  const canProveWithTreeState = missing !== null && treeState !== null;

  return {
    events,
    poolCommitments: merged,
    commitments: merged[0] ?? [],
    eventCount: events.length,
    leafCount,
    poolLeafCounts,
    merkleRoot,
    poolMerkleRoots,
    missing: canProveWithTreeState ? null : missing,
    treeState,
    canProveWithTreeState,
  };
}
