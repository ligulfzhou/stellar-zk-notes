import { buildChainState } from "../../web/src/server/chain-state.ts";
import { merkleWitness } from "../../web/src/server/merkle.ts";
import {
  computeCommitmentV2,
  depositSecretToField,
} from "../../web/src/lib/commitment-v2.ts";
import {
  deriveDepositSecretFromSeed,
  deriveNoteSecretsFromSeed,
} from "../../web/src/lib/root-seed.ts";
import { e2ePartySeed } from "./crypto.ts";

const alice = "GBTZVQRXWUTOBJZU5VEZZVNOQIEP7TIHORJFG26FVAHJGCUPDC22BULU";
const derivationIndex = Number(process.env.E2E_DERIVATION_INDEX ?? "0");

async function main() {
  const seed = e2ePartySeed("alice");
  const { secret, nullifierSecret } = deriveNoteSecretsFromSeed(
    seed,
    derivationIndex
  );
  const depositSecret = deriveDepositSecretFromSeed(seed, derivationIndex);
  const poolId = 0;
  const localCommitment = await computeCommitmentV2({
    valueStroops: 10_000_000n,
    secret,
    nullifierSecret,
    depositSecret,
    poolId,
  });

  const chain = await buildChainState(alice, [], [
    {
      leafIndex: 0,
      commitment: localCommitment,
      poolId: 0,
    },
  ]);

  const poolCommits = chain.poolCommitments[0] ?? [];
  const leafCount = chain.poolLeafCounts[0] ?? 0;
  console.log("leafCount", leafCount);
  console.log("onChainRoot", chain.poolMerkleRoots[0]);
  console.log("onChain[0]", poolCommits[0]);
  console.log("local", localCommitment);
  console.log("match0", poolCommits[0]?.toLowerCase() === localCommitment.toLowerCase());

  const leaves = poolCommits.slice(0, leafCount).map((h) =>
    BigInt(h.startsWith("0x") ? h : `0x${h}`)
  );
  const { path, indices, root } = await merkleWitness(leaves, 0);
  const computedRoot =
    "0x" + root.toString(16).padStart(64, "0").toLowerCase();
  console.log("witnessRoot", computedRoot);
  console.log("rootsMatch", computedRoot === chain.poolMerkleRoots[0]?.toLowerCase());

  const spendLeaf = BigInt(
    localCommitment.startsWith("0x") ? localCommitment : `0x${localCommitment}`
  );
  console.log("leafMatch", spendLeaf === leaves[0]);
  console.log("path0", path[0]?.toString());
  console.log("idx0", indices[0]);
  console.log("depositField", depositSecretToField(depositSecret));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
