import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildShieldedTransferWitness,
  buildSingleNoteRelayerExitWitness,
  buildSingleNoteWithdrawWitness,
} from "../../web/src/lib/action-witness.ts";
import { computeCommitment } from "../../web/src/lib/commitment.ts";
import { computeNullifier } from "../../web/src/lib/commitment-client.ts";
import { bytesToHex0x, encryptNoteForRecipient } from "../../web/src/lib/note-crypto.ts";
import type { Note } from "../../web/src/lib/note-types.ts";
import {
  deriveSpendingKeysFromSeed,
  randomNoteRandomness,
} from "../../web/src/lib/shielded-keys.ts";
import { config } from "./config.ts";
import { fetchDenseCommitments } from "./stellar.ts";
import { mockProofBytes } from "./field.ts";

const execFileAsync = promisify(execFile);
const PROOF_BYTES = 456 * 32;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitForChainNote(params: {
  reader: string;
  commitmentHex: string;
  expectedLeafIndex?: number;
  maxWaitMs?: number;
}): Promise<{ leafIndex: number }> {
  const maxWait = params.maxWaitMs ?? 60_000;
  const target = params.commitmentHex.toLowerCase();
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const dense = await fetchDenseCommitments(params.reader);
    if (params.expectedLeafIndex !== undefined) {
      const at = dense.commitments[params.expectedLeafIndex];
      if (at && at.toLowerCase() === target) {
        return { leafIndex: params.expectedLeafIndex };
      }
    } else {
      const leafIndex = dense.commitments.findLastIndex(
        (c) => c.toLowerCase() === target
      );
      if (leafIndex >= 0) {
        return { leafIndex };
      }
    }
    await sleep(2000);
  }
  throw new Error(
    `Commitment ${params.commitmentHex.slice(0, 12)}… not found on chain`
  );
}

export type DepositNote = {
  noteRandomness: string;
  spendingPk: string;
  spendingSk: string;
  commitmentHex: string;
  nullifierHex: string;
};

export type ProveResult = {
  merkleRoot: string;
  nullifierHexes: string[];
  newCommitmentHexes: string[];
  proofBytes: Uint8Array;
  epkHexes?: string[];
  encryptedNotes?: Uint8Array[];
};

export async function buildDepositNote(
  value: string,
  partySeed: Uint8Array,
  noteRandomness = randomNoteRandomness()
): Promise<DepositNote> {
  const { spendingSk, spendingPk } = await deriveSpendingKeysFromSeed(partySeed);
  const commitmentHex = await computeCommitment({
    valueStroops: BigInt(value),
    noteRandomness,
    spendingPk,
  });
  const nullifierHex = await computeNullifier({
    spendingSk,
    valueStroops: BigInt(value),
    noteRandomness,
  });
  return {
    noteRandomness,
    spendingPk,
    spendingSk,
    commitmentHex,
    nullifierHex,
  };
}

async function generateRealProof(witnessPayload: Record<string, unknown>): Promise<Uint8Array> {
  const proveScript = path.join(config.repoRoot, "scripts", "prove_from_witness.sh");
  const proofFile = path.join(config.repoRoot, "artifacts", "utxo_actions", "proof");
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "zk-utxo-e2e-witness-"));
  const witnessPath = path.join(tmpDir, "witness.json");
  try {
    await writeFile(witnessPath, JSON.stringify(witnessPayload));
    await execFileAsync(proveScript, [witnessPath], {
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.bb/bin:${process.env.HOME}/.nargo/bin:${process.env.PATH}`,
      },
      maxBuffer: 32 * 1024 * 1024,
    });
    const proof = await readFile(proofFile);
    if (proof.length !== PROOF_BYTES) {
      throw new Error(
        `Invalid proof size ${proof.length} (expected ${PROOF_BYTES}) — run ./scripts/build_vk_utxo_actions.sh`
      );
    }
    return new Uint8Array(proof);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function loadProveChain(reader: string) {
  const dense = await fetchDenseCommitments(reader);
  return {
    commitments: dense.commitments,
    leafCount: dense.leafCount,
    merkleRoot: dense.merkleRoot,
    treeState: null,
  };
}

async function proveFromNote(params: {
  note: Note;
  spendingSk: string;
  reader: string;
  relayerFeeStroops: string;
}): Promise<ProveResult> {
  const chain = await loadProveChain(params.reader);

  const built =
    params.relayerFeeStroops !== "0"
      ? await buildSingleNoteRelayerExitWitness({
          note: params.note,
          spendingSk: params.spendingSk,
          relayerFeeStroops: params.relayerFeeStroops,
          leafCount: chain.leafCount,
          commitments: chain.commitments,
          onChainMerkleRoot: chain.merkleRoot,
          treeState: chain.treeState ?? undefined,
        })
      : await buildSingleNoteWithdrawWitness({
          note: params.note,
          spendingSk: params.spendingSk,
          leafCount: chain.leafCount,
          commitments: chain.commitments,
          onChainMerkleRoot: chain.merkleRoot,
          treeState: chain.treeState ?? undefined,
        });

  const proofBytes = config.mockProof
    ? mockProofBytes()
    : await generateRealProof(built.witness);

  return {
    merkleRoot: built.merkleRootHex,
    nullifierHexes: built.nullifierHexes,
    newCommitmentHexes: built.newCommitmentHexes,
    proofBytes,
  };
}

export async function proveWithdraw(params: {
  note: Note;
  spendingSk: string;
  reader: string;
}): Promise<ProveResult> {
  return proveFromNote({
    ...params,
    relayerFeeStroops: "0",
  });
}

export async function proveRelayerExit(params: {
  note: Note;
  spendingSk: string;
  reader: string;
  relayerFeeStroops: string;
}): Promise<ProveResult> {
  return proveFromNote(params);
}

export async function proveShieldedSend(params: {
  spendNote: Note;
  spendingSk: string;
  payAmount: bigint;
  changeAmount: bigint;
  payeeRecipientPk: string;
  payeeNoteRandomness: string;
  payeeX25519Hex: string;
  changeRecipientPk: string;
  changeNoteRandomness: string;
  changeX25519Hex: string;
  reader: string;
}): Promise<ProveResult> {
  const chain = await loadProveChain(params.reader);

  const outputs = [
    {
      value: params.payAmount.toString(),
      noteRandomness: params.payeeNoteRandomness,
      recipientPk: params.payeeRecipientPk,
    },
  ];
  if (params.changeAmount > 0n) {
    outputs.push({
      value: params.changeAmount.toString(),
      noteRandomness: params.changeNoteRandomness,
      recipientPk: params.changeRecipientPk,
    });
  }

  const built = await buildShieldedTransferWitness({
    inputs: [
      {
        value: params.spendNote.value.toString(),
        noteRandomness: params.spendNote.noteRandomness,
        spendingSk: params.spendingSk,
        leafIndex: params.spendNote.leafIndex,
        noteCommitment: params.spendNote.commitment,
      },
    ],
    outputs,
    leafCount: chain.leafCount,
    commitments: chain.commitments,
    onChainMerkleRoot: chain.merkleRoot,
    treeState: chain.treeState ?? undefined,
  });

  const proofBytes = config.mockProof
    ? mockProofBytes()
    : await generateRealProof(built.witness);

  const epkHexes: string[] = [];
  const encryptedNotes: Uint8Array[] = [];
  const deliveryKeys = [params.payeeX25519Hex, params.changeX25519Hex];
  for (let i = 0; i < outputs.length; i++) {
    const nc = built.newCommitmentHexes[i];
    if (!nc || nc === "0x0") continue;
    const out = outputs[i]!;
    const enc = encryptNoteForRecipient(deliveryKeys[i]!, {
      valueStroops: out.value,
      noteRandomness: out.noteRandomness,
      spendingPk: out.recipientPk,
    });
    epkHexes.push(bytesToHex0x(enc.epk));
    encryptedNotes.push(enc.encryptedNote);
  }

  return {
    merkleRoot: built.merkleRootHex,
    nullifierHexes: built.nullifierHexes,
    newCommitmentHexes: built.newCommitmentHexes,
    proofBytes,
    epkHexes,
    encryptedNotes,
  };
}
