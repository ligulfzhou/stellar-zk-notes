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
import { STELLAR_NETWORK, VAULT_CONTRACT_ID, VAULT_LEGACY_SEND } from "./config";
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
  await ensureAccountOnNetwork(sourcePublicKey);
  try {
    return await fetchStellarAccount(sourcePublicKey);
  } catch (err) {
    throw new Error(`Account lookup failed: ${formatError(err)}`);
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
  try {
    return await sendTransactionViaApi(signed);
  } catch (err) {
    throw new Error(formatError(err));
  }
}

export async function getVaultLeafCount(
  sourcePublicKey: string
): Promise<number> {
  const res = await fetch(
    `/api/vault-leaf-count?reader=${encodeURIComponent(sourcePublicKey)}`
  );
  const data = (await res.json()) as { leafCount?: number; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "leaf count failed");
  }
  return data.leafCount ?? 0;
}

async function waitForLeafCountIncrease(
  sourcePublicKey: string,
  before: number,
  attempts = 8,
  delayMs = 1500
): Promise<number> {
  for (let i = 0; i < attempts; i++) {
    const count = await getVaultLeafCount(sourcePublicKey);
    if (count > before) return count;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return getVaultLeafCount(sourcePublicKey);
}

export async function depositToVault(params: {
  sourcePublicKey: string;
  signTransaction: (xdr: string) => Promise<string>;
  amountStroops: bigint;
  commitmentHex: string;
}): Promise<{ txHash: string; leafIndex: number }> {
  const before = await getVaultLeafCount(params.sourcePublicKey).catch(() => 0);
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
          "deposit",
          from.toScVal(),
          nativeToScVal(params.amountStroops, { type: "i128" }),
          xdr.ScVal.scvBytes(Buffer.from(commitmentBytes))
        )
      );
    },
    params.signTransaction
  );
  const after = await waitForLeafCountIncrease(
    params.sourcePublicKey,
    before
  );
  return { txHash, leafIndex: Math.max(0, after - 1) };
}

export function encodePublicInputs(params: {
  merkleRootHex: string;
  nullifierHexes: string[];
  newCommitmentHexes: string[];
  publicAmount: string;
}): Uint8Array {
  const pad = (hexes: string[]) => {
    const out = [...hexes];
    while (out.length < 4) out.push("0x0");
    return out.slice(0, 4);
  };
  const chunks = [
    fieldHexToBytes32(params.merkleRootHex),
    ...pad(params.nullifierHexes).map(fieldHexToBytes32),
    ...pad(params.newCommitmentHexes).map(fieldHexToBytes32),
    fieldDecToBytes32(params.publicAmount),
  ];
  const out = new Uint8Array(320);
  chunks.forEach((chunk, i) => out.set(chunk, i * 32));
  return out;
}

export async function registerShieldedKeyOnVault(params: {
  sourcePublicKey: string;
  signTransaction: (xdr: string) => Promise<string>;
  receivePubkeyBytes: Uint8Array;
}): Promise<string> {
  return signAndSend(
    params.sourcePublicKey,
    async (source) => {
      const contract = new Contract(requireVaultId());
      const owner = new Address(params.sourcePublicKey);
      return new TransactionBuilder(source, {
        fee: "100000",
        networkPassphrase: networkPassphrase(),
      }).addOperation(
        contract.call(
          "register_shielded_key",
          owner.toScVal(),
          xdr.ScVal.scvBytes(Buffer.from(params.receivePubkeyBytes))
        )
      );
    },
    params.signTransaction
  );
}

export async function shieldedTransferToVault(params: {
  sourcePublicKey: string;
  signTransaction: (xdr: string) => Promise<string>;
  nullifierHexes: string[];
  newCommitmentHexes: string[];
  merkleRootHex: string;
  publicInputs: Uint8Array;
  proofBytes: Uint8Array;
  epkBytes: Uint8Array[];
  encryptedNoteBytes: Uint8Array[];
}): Promise<string> {
  const padHex = (hexes: string[]) => {
    const out = [...hexes];
    while (out.length < 4) out.push("0x0");
    return out.slice(0, 4);
  };
  const nullifiers = padHex(params.nullifierHexes);
  const commitments = padHex(params.newCommitmentHexes);
  const zero32 = new Uint8Array(32);
  const dummyEnc = new Uint8Array([0]);

  const epks = [...params.epkBytes];
  const encs = [...params.encryptedNoteBytes];
  while (epks.length < 4) epks.push(zero32);
  while (encs.length < 4) encs.push(dummyEnc);

  if (encs[0]!.length === 0) {
    throw new Error("Encrypted note payload required for first output");
  }
  for (let i = 0; i < 4; i++) {
    if (commitments[i] !== "0x0" && normalizeHex(commitments[i]!) !== "0x" + "0".repeat(64)) {
      if (encs[i]!.length === 0) {
        throw new Error(`Encrypted note required for output ${i}`);
      }
    }
  }

  const args = [
    ...nullifiers.map((h) => xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(h)))),
    ...commitments.map((h) => xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(h)))),
    xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.merkleRootHex))),
    xdr.ScVal.scvBytes(Buffer.from(params.publicInputs)),
    xdr.ScVal.scvBytes(Buffer.from(params.proofBytes)),
    ...epks.flatMap((epk, i) => [
      xdr.ScVal.scvBytes(Buffer.from(epk)),
      xdr.ScVal.scvBytes(Buffer.from(encs[i]!)),
    ]),
  ];

  return signAndSend(
    params.sourcePublicKey,
    async (source) => {
      const contract = new Contract(requireVaultId());
      return new TransactionBuilder(source, {
        fee: "1000000",
        networkPassphrase: networkPassphrase(),
      }).addOperation(contract.call("shielded_transfer", ...args));
    },
    params.signTransaction
  );
}

/** @deprecated use shieldedTransferToVault */
export const shieldedSendToVault = shieldedTransferToVault;

function normalizeHex(hex: string): string {
  return (hex.startsWith("0x") ? hex : `0x${hex}`).toLowerCase();
}

export async function withdrawFromVault(params: {
  sourcePublicKey: string;
  signTransaction: (xdr: string) => Promise<string>;
  recipient: string;
  amountStroops: bigint;
  nullifierHex: string;
  merkleRootHex: string;
  publicInputs: Uint8Array;
  proofBytes: Uint8Array;
}): Promise<string> {
  return signAndSend(
    params.sourcePublicKey,
    async (source) => {
      const contract = new Contract(requireVaultId());
      const to = new Address(params.recipient);
      return new TransactionBuilder(source, {
        fee: "1000000",
        networkPassphrase: networkPassphrase(),
      }).addOperation(
        contract.call(
          "withdraw",
          to.toScVal(),
          xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.nullifierHex))),
          nativeToScVal(params.amountStroops, { type: "i128" }),
          xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.merkleRootHex))),
          xdr.ScVal.scvBytes(Buffer.from(params.publicInputs)),
          xdr.ScVal.scvBytes(Buffer.from(params.proofBytes))
        )
      );
    },
    params.signTransaction
  );
}
