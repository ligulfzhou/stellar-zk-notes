export const POOLS = [
  { id: 0, label: "1 XLM", stroops: 10_000_000n },
  { id: 1, label: "10 XLM", stroops: 100_000_000n },
  { id: 2, label: "100 XLM", stroops: 1_000_000_000n },
] as const;

export const POOL_COUNT = POOLS.length;

export const MIN_POOL_SIZE_TESTNET = 3;
export const ENCRYPTED_NOTE_SIZE = 512;
export const ENCRYPTED_EXIT_MAX = 256;

export function poolById(poolId: number) {
  const pool = POOLS.find((p) => p.id === poolId);
  if (!pool) {
    throw new Error(`Invalid pool id ${poolId}`);
  }
  return pool;
}

export function emptyPoolChainCommitments(): string[][] {
  return POOLS.map(() => [] as string[]);
}
