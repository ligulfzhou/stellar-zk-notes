import {
  fetchPoolCommitmentsFromChain,
  getVaultCommitmentAt,
  getVaultLeafCount,
  getVaultMerkleRoot,
  readVaultTreeState,
  type VaultTreeState,
} from "@/server/soroban-vault";
import { emptyPoolChainCommitments, POOL_COUNT } from "@/lib/pool-config";
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

async function fillPoolCommitmentGaps(
  reader: string,
  poolId: number,
  slots: string[],
  leafCount: number
): Promise<string[]> {
  const out = [...slots];
  while (out.length < leafCount) out.push("");

  const missingIndices: number[] = [];
  for (let i = 0; i < leafCount; i++) {
    if (!out[i]) missingIndices.push(i);
  }
  if (missingIndices.length === 0) return out.slice(0, leafCount);

  const filled = await Promise.all(
    missingIndices.map(async (i) => ({
      i,
      commitment: await getVaultCommitmentAt(reader, poolId, i).catch(() => null),
    }))
  );
  for (const { i, commitment } of filled) {
    if (commitment) out[i] = commitment;
  }
  return out.slice(0, leafCount);
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

/**
 * Fast exit path: no event scan, no IndexedDB required.
 * Reads leafCount, merkleRoot, treeState, and every commitment from the vault contract.
 */
export async function buildChainStateForProve(
  reader: string,
  poolId: number
): Promise<ChainState> {
  const [leafCount, merkleRoot, treeState] = await Promise.all([
    getVaultLeafCount(reader, poolId).catch(() => 0),
    getVaultMerkleRoot(reader, poolId).catch(() => null),
    readVaultTreeState(reader, poolId).catch(() => null),
  ]);

  if (!leafCount) {
    throw new Error(`Pool ${poolId} is empty on chain`);
  }
  if (!merkleRoot) {
    throw new Error(`Could not read Merkle root for pool ${poolId}`);
  }

  const commitments = await fetchPoolCommitmentsFromChain(
    reader,
    poolId,
    leafCount
  );
  const missing = missingLeafIndex(commitments, leafCount);
  if (missing !== null) {
    throw new Error(
      `Missing on-chain commitment at leaf ${missing} for pool ${poolId}`
    );
  }

  // treeState speeds witness build when present; dense path works without it
  // because every leaf commitment was fetched above.

  const poolCommitments = emptyPoolChainCommitments();
  poolCommitments[poolId] = commitments;

  const poolLeafCounts: Array<number | null> = Array(POOL_COUNT).fill(null);
  const poolMerkleRoots: Array<string | null> = Array(POOL_COUNT).fill(null);
  poolLeafCounts[poolId] = leafCount;
  poolMerkleRoots[poolId] = merkleRoot;

  return {
    events: [],
    poolCommitments,
    commitments,
    eventCount: 0,
    leafCount,
    poolLeafCounts,
    merkleRoot,
    poolMerkleRoots,
    missing: null,
    treeState,
    canProveWithTreeState: false,
  };
}

/** Full sync: event scan + optional local merge (Dashboard, Rescan). */
export async function buildChainState(
  reader?: string,
  localPoolCommitments: string[][] = [],
  notes: Array<{ leafIndex: number; commitment: string; poolId?: number }> = [],
  options?: { poolId?: number }
): Promise<ChainState> {
  const focusPoolId = options?.poolId;
  const events = await fetchVaultChainEvents();
  const remote = rebuildPoolChainCommitments(events);
  let leafCount: number | null = null;
  let merkleRoot: string | null = null;
  let treeState: VaultTreeState | null = null;
  const poolLeafCounts: Array<number | null> = Array(POOL_COUNT).fill(null);
  const poolMerkleRoots: Array<string | null> = Array(POOL_COUNT).fill(null);

  if (reader) {
    const treePoolId = focusPoolId ?? 0;
    leafCount = await getVaultLeafCount(reader, treePoolId).catch(() => null);
    merkleRoot = await getVaultMerkleRoot(reader, treePoolId).catch(() => null);
    treeState = await readVaultTreeState(reader, treePoolId).catch(() => null);
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
    const poolsToFill =
      focusPoolId !== undefined ? [focusPoolId] : [0, 1, 2].slice(0, POOL_COUNT);
    for (const poolId of poolsToFill) {
      const count = poolLeafCounts[poolId];
      if (!count) continue;
      merged[poolId] = await fillPoolCommitmentGaps(
        reader,
        poolId,
        merged[poolId] ?? [],
        count
      );
    }
  }

  let missing: number | null = null;
  const poolsToCheck =
    focusPoolId !== undefined ? [focusPoolId] : [0, 1, 2].slice(0, POOL_COUNT);
  for (const poolId of poolsToCheck) {
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
