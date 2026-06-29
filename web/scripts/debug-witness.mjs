import { buildChainState } from "../src/server/chain-state.ts";
import { merkleWitnessFromTreeState, fieldHexListToBigInt } from "../src/server/merkle.ts";

const reader = "GCMDWFAHD6PYI5SI2N2M6XINZDITECUV4XN7LYQGOWKQSIMQPRNK2DLN";
const noteCommitment =
  "0x0292b24480bbd5dcce07204c283dcbcd1d9630236d6efc26d80a9c583deadc6d";

const state = await buildChainState(reader, [], [
  { leafIndex: 2, commitment: noteCommitment },
]);
const { filled, zeros } = fieldHexListToBigInt(
  state.treeState.filled,
  state.treeState.zeros
);
const spendLeaf = BigInt(noteCommitment);
const leafAt = (i) => {
  const s = state.commitments[i];
  return s ? BigInt(s.startsWith("0x") ? s : `0x${s}`) : undefined;
};
const w = await merkleWitnessFromTreeState({
  leafCount: state.leafCount,
  targetIndex: 2,
  targetLeaf: spendLeaf,
  filled,
  zeros,
  leafAt,
});
const rootHex = `0x${w.root.toString(16).padStart(64, "0")}`;
console.log("computed", rootHex);
console.log("expected", state.merkleRoot);
console.log("match", rootHex.toLowerCase() === state.merkleRoot?.toLowerCase());
console.log("indices L0 L1", w.indices[0], w.indices[1]);
console.log(
  "path1 == filled1",
  w.path[1].toString(16) === state.treeState.filled[1].slice(2)
);
