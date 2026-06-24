import {
  Account,
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { fieldDecToBytes32, fieldHexToBytes32 } from "./field";
import { formatError } from "./format-error";
import {
  PRIVACY_MODE,
  RELAYER_URL,
  STELLAR_NETWORK,
  VAULT_CONTRACT_ID,
  VAULT_LEGACY_SEND,
} from "./config";
import {
  accountExistsViaApi,
  fetchStellarAccount,
  prepareTransactionViaApi,
  sendTransactionViaApi,
} from "./soroban-client";
import { authorizePreparedTransaction } from "./soroban-auth";

function networkPassphrase(): string {
  return STELLAR_NETWORK.toLowerCase() === "mainnet"
    ? Networks.PUBLIC
    : Networks.TESTNET;
}

function requireVaultId(): string {
  if (!VAULT_CONTRACT_ID) {
    throw new Error("Set NEXT_PUBLIC_VAULT_CONTRACT_ID in web/.env.local");
  }
  return VAULT_CONTRACT_ID;
}

function isTestnet(): boolean {
  return STELLAR_NETWORK.toLowerCase() !== "mainnet";
}

/** Fail fast if the wallet account is missing on-chain (testnet). */
export async function ensureAccountOnNetwork(publicKey: string): Promise<void> {
  if (!isTestnet()) return;
  if (await accountExistsViaApi(publicKey)) return;
  throw new Error(
    "Account not found on testnet — create and fund it at https://lab.stellar.org/account/create, then reconnect"
  );
}

async function loadSourceAccount(sourcePublicKey: string): Promise<Account> {
  try {
    return await fetchStellarAccount(sourcePublicKey);
  } catch (err) {
    throw new Error(formatError(err) || "Account lookup failed");
  }
}

async function signAndSend(
  sourcePublicKey: string,
  build: (source: Account) => Promise<TransactionBuilder>,
  signTransaction: (xdr: string) => Promise<string>
): Promise<string> {
  const source = await loadSourceAccount(sourcePublicKey);
  const builder = await build(source);
  const tx = builder.setTimeout(180).build();
  let txToSign: string;
  try {
    const { xdr: preparedXdr, latestLedger } = await prepareTransactionViaApi(
      tx.toXDR()
    );
    txToSign = await authorizePreparedTransaction(
      preparedXdr,
      sourcePublicKey,
      latestLedger + 100
    );
  } catch (err) {
    throw new Error(formatError(err));
  }
  let signed: string;
  try {
    signed = await signTransaction(txToSign);
  } catch (err) {
    throw new Error(formatError(err) || "Wallet signing cancelled");
  }
  if (PRIVACY_MODE === "strict" && RELAYER_URL) {
    try {
      const res = await fetch(`${RELAYER_URL.replace(/\/$/, "")}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xdr: signed }),
      });
      const data = (await res.json()) as { txHash?: string; error?: string };
      if (!res.ok || !data.txHash) {
        throw new Error(data.error ?? "Relayer submit failed");
      }
      return data.txHash;
    } catch (err) {
      throw new Error(formatError(err));
    }
  }
  try {
    return await sendTransactionViaApi(signed);
  } catch (err) {
    throw new Error(formatError(err));
  }
}

/** True when txs go directly to RPC (dev privacy mode or no relayer URL). */
export function usesDirectSubmit(): boolean {
  return PRIVACY_MODE === "dev" || !RELAYER_URL;
}

export async function getVaultLeafCount(
  sourcePublicKey: string,
  poolId = 0
): Promise<number> {
  const res = await fetch(
    `/api/vault-leaf-count?reader=${encodeURIComponent(sourcePublicKey)}&poolId=${poolId}`
  );
  const data = (await res.json()) as { leafCount?: number; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "leaf count failed");
  }
  return data.leafCount ?? 0;
}

async function waitForLeafCountIncrease(
  sourcePublicKey: string,
  poolId: number,
  before: number,
  attempts = 8,
  delayMs = 1500
): Promise<number> {
  for (let i = 0; i < attempts; i++) {
    const count = await getVaultLeafCount(sourcePublicKey, poolId);
    if (count > before) return count;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return getVaultLeafCount(sourcePublicKey, poolId);
}

export async function joinPoolOnVault(params: {
  sourcePublicKey: string;
  signTransaction: (xdr: string) => Promise<string>;
  poolId: number;
  commitmentHex: string;
}): Promise<{ txHash: string; leafIndex: number }> {
  const before = await getVaultLeafCount(params.sourcePublicKey, params.poolId).catch(
    () => 0
  );
  const txHash = await signAndSend(
    params.sourcePublicKey,
    async (source) => {
      const contract = new Contract(requireVaultId());
      const commitmentBytes = fieldHexToBytes32(params.commitmentHex);
      const from = new Address(params.sourcePublicKey);
      return new TransactionBuilder(source, {
        fee: "100000",
        networkPassphrase: networkPassphrase(),
      }).addOperation(
        contract.call(
          "join_pool",
          from.toScVal(),
          nativeToScVal(params.poolId, { type: "u32" }),
          xdr.ScVal.scvBytes(Buffer.from(commitmentBytes))
        )
      );
    },
    params.signTransaction
  );
  const after = await waitForLeafCountIncrease(
    params.sourcePublicKey,
    params.poolId,
    before
  );
  return { txHash, leafIndex: Math.max(0, after - 1) };
}

export function encodePublicInputs(params: {
  poolId: number;
  merkleRootHex: string;
  nullifierHexes: string[];
  newCommitmentHexes: string[];
  publicAmount: string;
  relayerFeeStroops?: string;
}): Uint8Array {
  const pad = (hexes: string[]) => {
    const out = [...hexes];
    while (out.length < 4) out.push("0x0");
    return out.slice(0, 4);
  };
  const relayerFee = params.relayerFeeStroops ?? "0";
  const chunks = [
    fieldDecToBytes32(params.poolId.toString()),
    fieldHexToBytes32(params.merkleRootHex),
    ...pad(params.nullifierHexes).map(fieldHexToBytes32),
    ...pad(params.newCommitmentHexes).map(fieldHexToBytes32),
    fieldDecToBytes32(params.publicAmount),
    fieldDecToBytes32(relayerFee),
  ];
  const out = new Uint8Array(384);
  chunks.forEach((chunk, i) => out.set(chunk, i * 32));
  return out;
}

function normalizeHex(hex: string): string {
  return (hex.startsWith("0x") ? hex : `0x${hex}`).toLowerCase();
}

export async function exitPoolOnVault(params: {
  sourcePublicKey: string;
  signTransaction: (xdr: string) => Promise<string>;
  poolId: number;
  recipient: string;
  relayer: string;
  relayerFeeStroops: number;
  nullifierHexes: string[];
  merkleRootHex: string;
  publicInputs: Uint8Array;
  proofBytes: Uint8Array;
}): Promise<string> {
  const padHex = (hexes: string[]) => {
    const out = [...hexes];
    while (out.length < 4) out.push("0x0");
    return out.slice(0, 4);
  };
  const nullifiers = padHex(params.nullifierHexes);
  const recipient = new Address(params.recipient);
  const relayer = new Address(params.relayer);

  return signAndSend(
    params.sourcePublicKey,
    async (source) => {
      const contract = new Contract(requireVaultId());
      return new TransactionBuilder(source, {
        fee: "1000000",
        networkPassphrase: networkPassphrase(),
      }).addOperation(
        contract.call(
          "exit_pool",
          nativeToScVal(params.poolId, { type: "u32" }),
          recipient.toScVal(),
          relayer.toScVal(),
          xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(nullifiers[0]!))),
          xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(nullifiers[1]!))),
          xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(nullifiers[2]!))),
          xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(nullifiers[3]!))),
          xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.merkleRootHex))),
          xdr.ScVal.scvBytes(Buffer.from(params.publicInputs)),
          xdr.ScVal.scvBytes(Buffer.from(params.proofBytes)),
          nativeToScVal(params.relayerFeeStroops, { type: "u32" })
        )
      );
    },
    params.signTransaction
  );
}

/** @deprecated use exitPoolOnVault */
export async function withdrawFromVault(params: {
  sourcePublicKey: string;
  signTransaction: (xdr: string) => Promise<string>;
  poolId: number;
  recipient: string;
  amountStroops: bigint;
  nullifierHex: string;
  merkleRootHex: string;
  publicInputs: Uint8Array;
  proofBytes: Uint8Array;
}): Promise<string> {
  throw new Error("withdraw removed — use exitPoolOnVault (Phase C)");
}
