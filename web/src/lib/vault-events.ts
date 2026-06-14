import {
  Contract,
  Networks,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { bytesToHex0x, normalizeHex } from "./bytes";
import { SOROBAN_RPC_URL, STELLAR_NETWORK, VAULT_CONTRACT_ID } from "./config";

export type VaultDepositEvent = {
  kind: "deposit";
  ledger: number;
  txHash: string;
  depositor: string;
  commitment: string;
  leafIndex: number;
  amount: bigint;
};

export type VaultShieldedSendEvent = {
  kind: "shielded_send";
  ledger: number;
  txHash: string;
  nullifier: string;
  newCommitment: string;
  leafIndex: number;
  epk: string;
  encryptedNote: Uint8Array;
};

export type VaultChainEvent = VaultDepositEvent | VaultShieldedSendEvent;

function rpcServer(): rpc.Server {
  return new rpc.Server(SOROBAN_RPC_URL, {
    allowHttp: STELLAR_NETWORK !== "mainnet",
  });
}

function requireVaultId(): string {
  if (!VAULT_CONTRACT_ID) {
    throw new Error("Set NEXT_PUBLIC_VAULT_CONTRACT_ID in web/.env.local");
  }
  return VAULT_CONTRACT_ID;
}

function networkPassphrase(): string {
  return STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
}

function normalizeAddress(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.address === "string") return obj.address;
    if (typeof obj.accountId === "string") return obj.accountId;
  }
  return null;
}

function normalizeAmount(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && value) return BigInt(value);
  return null;
}

function normalizeBytesHex(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Uint8Array) return bytesToHex0x(value);
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return bytesToHex0x(value);
  }
  if (typeof value === "string") {
    return value.startsWith("0x") ? value : `0x${value}`;
  }
  return null;
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (value instanceof Map) {
    return Object.fromEntries(value.entries());
  }
  return value as Record<string, unknown>;
}

function parseVaultEvent(
  ledger: number,
  txHash: string,
  value: unknown
): VaultChainEvent | null {
  const record = normalizeRecord(value);
  if (!record) return null;

  const depositor = normalizeAddress(record.depositor);
  const commitment = normalizeBytesHex(record.commitment);
  const leafIndex = record.leaf_index ?? record.leafIndex;
  const amount = normalizeAmount(record.amount);

  if (depositor && commitment && leafIndex !== undefined && amount !== null) {
    return {
      kind: "deposit",
      ledger,
      txHash,
      depositor,
      commitment: normalizeHex(commitment),
      leafIndex: Number(leafIndex),
      amount,
    };
  }

  const nullifier = normalizeBytesHex(record.nullifier);
  const newCommitment = normalizeBytesHex(
    record.new_commitment ?? record.newCommitment
  );
  const sendLeafIndex = record.leaf_index ?? record.leafIndex;
  const epk = normalizeBytesHex(record.epk);
  const encryptedRaw =
    record.encrypted_note ?? record.encryptedNote ?? record.encrypted;
  let encryptedNote: Uint8Array | null = null;
  if (encryptedRaw instanceof Uint8Array) encryptedNote = encryptedRaw;
  else if (typeof Buffer !== "undefined" && Buffer.isBuffer(encryptedRaw)) {
    encryptedNote = new Uint8Array(encryptedRaw);
  }

  if (nullifier && newCommitment && sendLeafIndex !== undefined) {
    return {
      kind: "shielded_send",
      ledger,
      txHash,
      nullifier: normalizeHex(nullifier),
      newCommitment: normalizeHex(newCommitment),
      leafIndex: Number(sendLeafIndex),
      epk: epk ? normalizeHex(epk) : "0x" + "00".repeat(32),
      encryptedNote: encryptedNote ?? new Uint8Array(),
    };
  }

  return null;
}

/** Paginate Soroban RPC for all vault contract events. */
export async function fetchVaultChainEvents(): Promise<VaultChainEvent[]> {
  const server = rpcServer();
  const vaultId = requireVaultId();
  const latest = await server.getLatestLedger();
  const startLedger = Math.max(1, latest.sequence - 300_000);
  const filters = [{ type: "contract" as const, contractIds: [vaultId] }];

  const parsed: VaultChainEvent[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 50; page++) {
    const response = cursor
      ? await server.getEvents({ filters, cursor, limit: 500 })
      : await server.getEvents({ filters, startLedger, limit: 500 });

    for (const event of response.events) {
      const body = scValToNative(event.value);
      const item = parseVaultEvent(event.ledger, event.txHash, body);
      if (item) parsed.push(item);
    }

    if (!response.cursor || response.events.length === 0) break;
    cursor = response.cursor;
  }

  parsed.sort((a, b) => a.ledger - b.ledger || a.txHash.localeCompare(b.txHash));
  return parsed;
}

/** Rebuild on-chain commitment list in Merkle insertion order. */
export function rebuildChainCommitments(events: VaultChainEvent[]): string[] {
  const slots: string[] = [];

  for (const event of events) {
    if (event.kind === "deposit") {
      while (slots.length <= event.leafIndex) slots.push("");
      slots[event.leafIndex] = event.commitment;
    } else {
      while (slots.length <= event.leafIndex) slots.push("");
      slots[event.leafIndex] = event.newCommitment;
    }
  }

  return slots.filter(Boolean);
}

export async function isNullifierSpentOnChain(
  nullifierHex: string,
  readerPublicKey: string
): Promise<boolean> {
  const server = rpcServer();
  const contract = new Contract(requireVaultId());
  const source = await server.getAccount(readerPublicKey);
  const bytes = Buffer.from(normalizeHex(nullifierHex).slice(2), "hex");
  const tx = new TransactionBuilder(source, {
    fee: "100",
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(
      contract.call("is_spent", xdr.ScVal.scvBytes(bytes))
    )
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) {
    return false;
  }
  return Boolean(scValToNative(sim.result.retval));
}
