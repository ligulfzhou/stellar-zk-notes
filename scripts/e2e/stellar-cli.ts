import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { config, requireVaultId } from "./config.ts";

const execFileAsync = promisify(execFile);

function hexToBytes(hex: string): Uint8Array {
  const normalized = strip0x(hex);
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** UltraHonk proofs are ~14KB — pass via file-path, not inline CLI hex. */
async function zkProofArgs(
  publicInputsHex: string,
  proofHex: string
): Promise<{ args: string[]; cleanup: () => Promise<void> }> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "zk-e2e-stellar-"));
  const publicInputsPath = path.join(tmpDir, "public_inputs");
  const proofPath = path.join(tmpDir, "proof");
  await writeFile(publicInputsPath, hexToBytes(publicInputsHex));
  await writeFile(proofPath, hexToBytes(proofHex));
  return {
    args: [
      "--public_inputs-file-path",
      publicInputsPath,
      "--proof_bytes-file-path",
      proofPath,
    ],
    cleanup: () => rm(tmpDir, { recursive: true, force: true }),
  };
}

function cliEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    STELLAR_NETWORK_PASSPHRASE: config.networkPassphrase,
    STELLAR_RPC_URL: config.rpcUrl,
  };
}

function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function bytesArg(hex: string): string {
  return strip0x(hex).padStart(64, "0");
}

function parseTxHash(output: string): string | null {
  const m = output.match(/explorer\/testnet\/tx\/([a-f0-9]{64})/i);
  return m?.[1] ?? null;
}

export async function cliPublicKey(source: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "stellar",
    ["keys", "address", source],
    { env: cliEnv() }
  );
  return stdout.trim();
}

async function cliInvoke(
  source: string,
  fn: string,
  args: string[],
  send: boolean
): Promise<{ stdout: string; txHash: string | null }> {
  const cmd = [
    "contract",
    "invoke",
    "--id",
    requireVaultId(),
    "--source",
    source,
    "--network",
    "testnet",
  ];
  if (send) cmd.push("--send=yes");
  // spend_note UltraHonk verify is heavy — raise simulation leeway for real ZK txs.
  if (send) {
    cmd.push("--instruction-leeway", process.env.STELLAR_INSTRUCTION_LEEWAY ?? "50000000");
    cmd.push("--resource-fee", process.env.STELLAR_RESOURCE_FEE ?? "500000000");
  }
  cmd.push("--", fn, ...args);

  const { stdout, stderr } = await execFileAsync("stellar", cmd, {
    env: cliEnv(),
    maxBuffer: 16 * 1024 * 1024,
  });
  const combined = `${stdout}\n${stderr}`;
  return { stdout: combined, txHash: parseTxHash(combined) };
}

export async function cliLeafCount(source: string): Promise<number> {
  const { stdout } = await cliInvoke(source, "leaf_count", [], false);
  const matches = stdout.match(/\b(\d+)\b/g);
  if (!matches?.length) return 0;
  return Number(matches[matches.length - 1]);
}

export async function cliMerkleRoot(source: string): Promise<string> {
  const { stdout } = await cliInvoke(source, "get_root", [], false);
  const m = stdout.match(/"([0-9a-f]{64})"/i) ?? stdout.match(/([0-9a-f]{64})/i);
  if (!m) throw new Error("Could not parse get_root output");
  return `0x${m[1]}`;
}

export async function cliDeposit(params: {
  source: string;
  from: string;
  amountStroops: bigint;
  commitmentHex: string;
}): Promise<{ txHash: string; leafIndex: number }> {
  const { stdout, txHash } = await cliInvoke(
    params.source,
    "deposit",
    [
      "--from",
      params.from,
      "--amount",
      params.amountStroops.toString(),
      "--commitment",
      bytesArg(params.commitmentHex),
    ],
    true
  );
  if (!txHash) throw new Error("deposit: no tx hash in CLI output");

  const leafMatch = stdout.match(/leaf_index:\s*(\d+)/);
  const leafIndex = leafMatch ? Number(leafMatch[1]) : (await cliLeafCount(params.source)) - 1;

  return { txHash, leafIndex: Math.max(0, leafIndex) };
}

export async function cliWithdraw(params: {
  source: string;
  recipient: string;
  amountStroops: bigint;
  nullifierHex: string;
  merkleRootHex: string;
  publicInputsHex: string;
  proofHex: string;
}): Promise<string> {
  const zk = await zkProofArgs(params.publicInputsHex, params.proofHex);
  try {
    const { txHash } = await cliInvoke(
      params.source,
      "withdraw",
      [
        "--to",
        params.recipient,
        "--nullifier",
        bytesArg(params.nullifierHex),
        "--amount",
        params.amountStroops.toString(),
        "--merkle_root",
        bytesArg(params.merkleRootHex),
        ...zk.args,
      ],
      true
    );
    if (!txHash) throw new Error("withdraw: no tx hash in CLI output");
    return txHash;
  } finally {
    await zk.cleanup();
  }
}

export function publicInputsToHex(publicInputs: Uint8Array): string {
  return Buffer.from(publicInputs).toString("hex");
}

export function proofToHex(proof: Uint8Array): string {
  return Buffer.from(proof).toString("hex");
}
