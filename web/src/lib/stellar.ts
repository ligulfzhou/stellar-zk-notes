import {
  Account,
  Address,
  Contract,
  Networks,
  Transaction,
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

/** Create and fund a testnet account via Friendbot when missing on-chain. */
export async function ensureAccountOnNetwork(publicKey: string): Promise<void> {
  if (!isTestnet()) return;
  if (await accountExistsViaApi(publicKey)) return;

  const res = await fetch("/api/fund-testnet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: publicKey }),
  });
  const data = (await res.json()) as { error?: string; funded?: boolean };
  if (!res.ok || !data.funded) {
    throw new Error(
      data.error ??
        "Could not fund testnet account — open https://lab.stellar.org/account/create and fund this G… address"
    );
  }

  for (let attempt = 0; attempt < 12; attempt++) {
    if (await accountExistsViaApi(publicKey)) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(
    "Testnet account funding submitted but not visible yet — wait a few seconds and retry"
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
  let builder = await build(source);
  let tx = builder.setTimeout(180).build();
  try {
    const { xdr: preparedXdr, latestLedger } = await prepareTransactionViaApi(
      tx.toXDR()
    );
    const authedXdr = await authorizePreparedTransaction(
      preparedXdr,
      sourcePublicKey,
      latestLedger + 100
    );
    tx = TransactionBuilder.fromXDR(
      authedXdr,
      networkPassphrase()
    ) as Transaction;
  } catch (err) {
    throw new Error(formatError(err));
  }
  let signed: string;
  try {
    signed = await signTransaction(tx.toXDR());
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
  nullifierHex: string;
  newCommitmentHex: string;
  publicAmount: string;
  mode: string;
}): Uint8Array {
  const chunks = [
    fieldHexToBytes32(params.merkleRootHex),
    fieldHexToBytes32(params.nullifierHex),
    fieldHexToBytes32(params.newCommitmentHex),
    fieldDecToBytes32(params.publicAmount),
    fieldDecToBytes32(params.mode),
  ];
  const out = new Uint8Array(160);
  chunks.forEach((chunk, i) => out.set(chunk, i * 32));
  return out;
}

export async function shieldedSendToVault(params: {
  sourcePublicKey: string;
  signTransaction: (xdr: string) => Promise<string>;
  nullifierHex: string;
  newCommitmentHex: string;
  merkleRootHex: string;
  publicInputs: Uint8Array;
  proofBytes: Uint8Array;
  epkBytes?: Uint8Array;
  encryptedNoteBytes?: Uint8Array;
}): Promise<string> {
  const epk = params.epkBytes ?? new Uint8Array(32);
  const encrypted = params.encryptedNoteBytes ?? new Uint8Array();
  const args = [
    xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.nullifierHex))),
    xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.newCommitmentHex))),
    xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.merkleRootHex))),
    xdr.ScVal.scvBytes(Buffer.from(params.publicInputs)),
    xdr.ScVal.scvBytes(Buffer.from(params.proofBytes)),
  ];
  if (!VAULT_LEGACY_SEND) {
    args.push(xdr.ScVal.scvBytes(Buffer.from(epk)));
    args.push(xdr.ScVal.scvBytes(Buffer.from(encrypted)));
  }
  return signAndSend(
    params.sourcePublicKey,
    async (source) => {
      const contract = new Contract(requireVaultId());
      return new TransactionBuilder(source, {
        fee: "1000000",
        networkPassphrase: networkPassphrase(),
      }).addOperation(contract.call("shielded_send", ...args));
    },
    params.signTransaction
  );
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
