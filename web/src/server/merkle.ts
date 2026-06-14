import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TREE_HEIGHT = 16;
const scriptRoot = path.join(process.cwd(), "..", "scripts");

async function hashPair(left: bigint, right: bigint): Promise<bigint> {
  const { stdout } = await execFileAsync(
    path.join(scriptRoot, "hash_pair.sh"),
    [left.toString(), right.toString()]
  );
  const hex = stdout.trim();
  return BigInt(hex);
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
  const path: bigint[] = new Array(TREE_HEIGHT).fill(0n);
  const indices: boolean[] = new Array(TREE_HEIGHT).fill(false);
  let leafCount = 0;

  for (let n = 0; n <= targetIndex; n++) {
    const leaf = leaves[n];
    let currentIndex = leafCount;
    let currentHash = leaf;
    for (let i = 0; i < TREE_HEIGHT; i++) {
      if (n === targetIndex) {
        if (currentIndex % 2 === 0) {
          path[i] = zeros[i];
          indices[i] = false;
        } else {
          path[i] = filled[i];
          indices[i] = true;
        }
      }
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

  const root = await merkleRoot(leaves);
  return { path, indices, root };
}
