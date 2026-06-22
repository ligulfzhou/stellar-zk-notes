import { hashPair } from "./hash-pair-client";

const TREE_HEIGHT = 16;

function hexToBigInt(hex: string): bigint {
  const h = hex.startsWith("0x") ? hex : `0x${hex}`;
  return BigInt(h);
}

async function emptyTreeZeros(): Promise<bigint[]> {
  const zeros: bigint[] = new Array(TREE_HEIGHT).fill(0n);
  zeros[0] = 0n;
  for (let i = 1; i < TREE_HEIGHT; i++) {
    zeros[i] = await hashPair(zeros[i - 1], zeros[i - 1]);
  }
  return zeros;
}

export async function merkleRoot(leaves: bigint[]): Promise<bigint> {
  const zeros = await emptyTreeZeros();
  const filled = [...zeros];
  let leafCount = 0;

  for (const leaf of leaves) {
    let currentIndex = leafCount;
    let currentHash = leaf;
    for (let i = 0; i < TREE_HEIGHT; i++) {
      if (currentIndex % 2 === 0) {
        filled[i] = currentHash;
        currentHash = await hashPair(currentHash, zeros[i]);
      } else {
        currentHash = await hashPair(filled[i], currentHash);
      }
      currentIndex = Math.floor(currentIndex / 2);
    }
    leafCount += 1;
  }

  let hash = zeros[0];
  for (let i = 0; i < TREE_HEIGHT; i++) {
    if ((leafCount >> i) & 1) {
      hash = await hashPair(filled[i], hash);
    } else {
      hash = await hashPair(hash, zeros[i]);
    }
  }
  return hash;
}

export async function merkleWitness(
  leaves: bigint[],
  targetIndex: number
): Promise<{ path: bigint[]; indices: boolean[]; root: bigint }> {
  if (targetIndex >= leaves.length) {
    throw new Error("leaf index out of range");
  }

  const zeros = await emptyTreeZeros();
  const filled = [...zeros];
  let leafCount = 0;

  for (const leaf of leaves) {
    let currentIndex = leafCount;
    let currentHash = leaf;
    for (let i = 0; i < TREE_HEIGHT; i++) {
      if (currentIndex % 2 === 0) {
        filled[i] = currentHash;
        currentHash = await hashPair(currentHash, zeros[i]);
      } else {
        currentHash = await hashPair(filled[i], currentHash);
      }
      currentIndex = Math.floor(currentIndex / 2);
    }
    leafCount += 1;
  }

  const leafAt = (index: number) => leaves[index];
  return merkleWitnessFromTreeState({
    leafCount: leaves.length,
    targetIndex,
    targetLeaf: leaves[targetIndex]!,
    filled,
    zeros,
    leafAt,
  });
}

async function alignedRangeRoot(
  start: number,
  width: number,
  leafCount: number,
  leafAt: (index: number) => bigint | undefined,
  zeros: bigint[],
  level: number
): Promise<bigint> {
  const end = Math.min(leafCount, start + width);
  const actual = end - start;
  if (actual <= 0) return zeros[level];
  if (actual === 1) {
    const leaf = leafAt(start);
    if (leaf === undefined) {
      throw new Error(`Missing leaf commitment at index ${start}`);
    }
    return leaf;
  }
  const half = width / 2;
  const left = await alignedRangeRoot(start, half, leafCount, leafAt, zeros, level + 1);
  const right = await alignedRangeRoot(
    start + half,
    half,
    leafCount,
    leafAt,
    zeros,
    level + 1
  );
  return hashPair(left, right);
}

async function merkleRootFromState(
  leafCount: number,
  filled: bigint[],
  zeros: bigint[]
): Promise<bigint> {
  let hash = zeros[0]!;
  for (let i = 0; i < TREE_HEIGHT; i++) {
    if ((leafCount >> i) & 1) {
      hash = await hashPair(filled[i]!, hash);
    } else {
      hash = await hashPair(hash, zeros[i]!);
    }
  }
  return hash;
}

export type VaultTreeState = {
  filled: string[];
  zeros: string[];
};

export function fieldHexListToBigInt(
  filled: string[],
  zeros: string[]
): { filled: bigint[]; zeros: bigint[] } {
  return {
    filled: filled.map(hexToBigInt),
    zeros: zeros.map(hexToBigInt),
  };
}

export async function merkleWitnessFromTreeState(params: {
  leafCount: number;
  targetIndex: number;
  targetLeaf: bigint;
  filled: bigint[];
  zeros: bigint[];
  leafAt: (index: number) => bigint | undefined;
}): Promise<{ path: bigint[]; indices: boolean[]; root: bigint }> {
  const { leafCount, targetIndex, targetLeaf, filled, zeros, leafAt } = params;
  const path: bigint[] = new Array(TREE_HEIGHT).fill(0n);
  const indices: boolean[] = new Array(TREE_HEIGHT).fill(false);

  for (let level = 0; level < TREE_HEIGHT; level++) {
    const nodeIndexAtLevel = targetIndex >> level;
    const isRight = (nodeIndexAtLevel & 1) === 1;
    indices[level] = isRight;
    const width = 1 << level;
    const siblingStart = isRight
      ? (nodeIndexAtLevel - 1) << level
      : (nodeIndexAtLevel + 1) << level;
    if (siblingStart >= leafCount) {
      path[level] = zeros[level];
    } else {
      path[level] = await alignedRangeRoot(
        siblingStart,
        width,
        leafCount,
        leafAt,
        zeros,
        level
      );
    }
  }

  const root = await merkleRootFromState(leafCount, filled, zeros);
  return { path, indices, root };
}
