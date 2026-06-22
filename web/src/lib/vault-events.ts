import {
  Contract,
  Networks,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { bytesToHex0x, normalizeHex } from "./bytes";
import { formatError } from "./format-error";
import { emptyPoolChainCommitments, POOL_COUNT, poolById } from "./pool-config";
import { SOROBAN_RPC_URL, STELLAR_NETWORK, VAULT_CONTRACT_ID } from "./config";

export type VaultJoinEvent = {
  kind: "join";
  poolId: number;
  ledger: number;
  txHash: string;
  commitment: string;
  leafIndex: number;
};

export type VaultExitEvent = {
  kind: "exit";
  poolId: number;
  ledger: number;
  txHash: string;
  nullifier: string;
};

export type VaultShieldedSendEvent = {
  kind: "shielded_send";
  ledger: number;
  txHash: string;
  poolId: number;
  nullifier: string;
  newCommitment: string;
  leafIndex: number;
  epk: string;
  encryptedNote: Uint8Array;
};

export type VaultChainEvent =
  | VaultJoinEvent
  | VaultShieldedSendEvent
  | VaultExitEvent;

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

  const poolIdRaw = record.pool_id ?? record.poolId;
  const commitment = normalizeBytesHex(record.commitment);
  const leafIndex = record.leaf_index ?? record.leafIndex;

  if (
    poolIdRaw !== undefined &&
    commitment &&
    leafIndex !== undefined &&
    normalizeAddress(record.depositor) === null &&
    record.amount === undefined
  ) {
    const poolId = Number(poolIdRaw);
    if (poolId >= 0 && poolId < POOL_COUNT) {
      return {
        kind: "join",
        poolId,
        ledger,
        txHash,
        commitment: normalizeHex(commitment),
        leafIndex: Number(leafIndex),
      };
    }
  }

  const exitNullifier = normalizeBytesHex(record.nullifier);
  if (
    exitNullifier &&
    poolIdRaw !== undefined &&
    normalizeAddress(record.recipient) === null &&
    record.amount === undefined &&
    record.new_commitment === undefined &&
    record.newCommitment === undefined &&
    record.exit_hash === undefined &&
    record.exitHash === undefined &&
    record.encrypted_note === undefined &&
    record.encryptedNote === undefined
  ) {
    return {
      kind: "exit",
      poolId: Number(poolIdRaw),
      ledger,
      txHash,
      nullifier: normalizeHex(exitNullifier),
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
    const poolId = poolIdRaw !== undefined ? Number(poolIdRaw) : 0;
    return {
      kind: "shielded_send",
      ledger,
      txHash,
      nullifier: normalizeHex(nullifier),
      newCommitment: normalizeHex(newCommitment),
      leafIndex: Number(sendLeafIndex),
      epk: epk ? normalizeHex(epk) : "0x" + "00".repeat(32),
      encryptedNote: encryptedNote ?? new Uint8Array(),
      poolId,
    };
  }

  return null;
}

/** How far back Soroban RPC reliably indexes contract events (empirical testnet limit). */
const EVENT_INDEX_LOOKBACK = 10_000;

async function resolveEventsStartLedger(server: rpc.Server): Promise<number> {
  const [latest, health] = await Promise.all([
    server.getLatestLedger(),
    server.getHealth(),
  ]);
  const retention = health.ledgerRetentionWindow ?? 120_960;
  const minAllowed = Math.max(health.oldestLedger, latest.sequence - retention + 16);
  const recentStart = latest.sequence - EVENT_INDEX_LOOKBACK;
  return Math.max(minAllowed, recentStart);
}

async function getEventsPage(
  server: rpc.Server,
  vaultId: string,
  startLedger: number,
  cursor?: string
): Promise<rpc.Api.GetEventsResponse> {
  const filters = [{ type: "contract" as const, contractIds: [vaultId] }];
  try {
    return cursor
      ? await server.getEvents({ filters, cursor, limit: 500 })
      : await server.getEvents({ filters, startLedger, limit: 500 });
  } catch (err) {
    const message = formatError(err);
    const match = message.match(/ledger range:\s*(\d+)\s*-\s*(\d+)/i);
    if (!match || cursor) throw err;
    const minLedger = Number(match[1]);
    return server.getEvents({ filters, startLedger: minLedger, limit: 500 });
  }
}

/** Paginate Soroban RPC for vault contract events (recent window + pagination). */
export async function fetchVaultChainEvents(): Promise<VaultChainEvent[]> {
  const server = rpcServer();
  const vaultId = requireVaultId();
  const startLedger = await resolveEventsStartLedger(server);

  const parsed: VaultChainEvent[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 50; page++) {
    const response = await getEventsPage(server, vaultId, startLedger, cursor);

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

/** Rebuild per-pool commitment lists in Merkle insertion order. */
export function rebuildPoolChainCommitments(
  events: VaultChainEvent[]
): string[][] {
  const pools = emptyPoolChainCommitments();

  for (const event of events) {
    if (event.kind === "join") {
      const slots = pools[event.poolId]!;
      while (slots.length <= event.leafIndex) slots.push("");
      slots[event.leafIndex] = event.commitment;
    } else if (event.kind === "shielded_send") {
      const slots = pools[event.poolId]!;
      while (slots.length <= event.leafIndex) slots.push("");
      slots[event.leafIndex] = event.newCommitment;
    }
  }

  for (const slots of pools) {
    while (slots.length > 0 && slots[slots.length - 1] === "") {
      slots.pop();
    }
  }
  return pools;
}

/** @deprecated use rebuildPoolChainCommitments */
export function rebuildChainCommitments(events: VaultChainEvent[]): string[] {
  return rebuildPoolChainCommitments(events)[0] ?? [];
}

/** Place a commitment at its on-chain leaf index within a pool tree. */
export function upsertPoolChainCommitment(
  pools: string[][],
  poolId: number,
  leafIndex: number,
  commitment: string
): string[][] {
  const updated = pools.map((p) => [...p]);
  while (updated.length <= poolId) {
    updated.push([]);
  }
  const chain = updated[poolId]!;
  while (chain.length <= leafIndex) {
    chain.push("");
  }
  chain[leafIndex] = commitment;
  while (chain.length > 0 && chain[chain.length - 1] === "") {
    chain.pop();
  }
  updated[poolId] = chain;
  return updated;
}

/** @deprecated use upsertPoolChainCommitment */
export function upsertChainCommitment(
  chain: string[],
  leafIndex: number,
  commitment: string
): string[] {
  return upsertPoolChainCommitment([chain], 0, leafIndex, commitment)[0]!;
}

/** Merge local vault commitments with a (possibly partial) chain scan. */
export function mergePoolChainCommitments(
  local: string[][],
  remote: string[][],
  leafCounts?: Array<number | null>
): string[][] {
  const merged = emptyPoolChainCommitments();
  for (let poolId = 0; poolId < POOL_COUNT; poolId++) {
    const size = Math.max(
      leafCounts?.[poolId] ?? 0,
      remote[poolId]?.length ?? 0,
      local[poolId]?.length ?? 0
    );
    const slots: string[] = [];
    const placed = new Set<string>();

    for (let i = 0; i < size; i++) {
      const r = remote[poolId]?.[i] ?? "";
      slots.push(r);
      if (r) placed.add(normalizeHex(r));
    }

    for (let i = 0; i < (local[poolId]?.length ?? 0); i++) {
      const commitment = local[poolId]?.[i];
      if (!commitment) continue;
      const norm = normalizeHex(commitment);
      if (placed.has(norm)) continue;
      while (slots.length <= i) slots.push("");
      if (!slots[i]) {
        slots[i] = commitment;
        placed.add(norm);
      }
    }

    while (slots.length > 0 && slots[slots.length - 1] === "") {
      slots.pop();
    }
    merged[poolId] = slots;
  }
  return merged;
}

/** @deprecated use mergePoolChainCommitments */
export function mergeChainCommitments(
  local: string[],
  remote: string[],
  leafCount?: number | null
): string[] {
  return mergePoolChainCommitments([local], [remote], [leafCount ?? null])[0]!;
}

export function seedCommitmentsFromNotes(
  pools: string[][],
  notes: Array<{ leafIndex: number; commitment: string; poolId?: number }>,
  leafCounts?: Array<number | null>
): string[][] {
  const merged = pools.map((p) => [...p]);
  for (let poolId = 0; poolId < POOL_COUNT; poolId++) {
    const size = Math.max(leafCounts?.[poolId] ?? 0, merged[poolId]!.length);
    while (merged[poolId]!.length < size) merged[poolId]!.push("");
  }

  for (const note of notes) {
    if (!note.commitment) continue;
    const poolId = note.poolId ?? 0;
    while (merged.length <= poolId) merged.push([]);
    while (merged[poolId]!.length <= note.leafIndex) merged[poolId]!.push("");
    if (!merged[poolId]![note.leafIndex]) {
      merged[poolId]![note.leafIndex] = note.commitment;
    }
  }

  for (const slots of merged) {
    while (slots.length > 0 && slots[slots.length - 1] === "") {
      slots.pop();
    }
  }
  return merged;
}

export function findCommitmentLeafIndex(
  commitments: string[],
  commitmentHex: string
): number | null {
  const target = normalizeHex(commitmentHex);
  const index = commitments.findIndex(
    (c) => Boolean(c) && normalizeHex(c) === target
  );
  return index >= 0 ? index : null;
}

/** Ensure slots `0..leafCount-1` are filled for Merkle witness generation. */
export function denseCommitmentSlots(
  commitments: string[],
  leafCount: number
): string[] {
  const slots: string[] = [];
  for (let i = 0; i < leafCount; i++) {
    slots.push(commitments[i] ?? "");
  }
  return slots;
}

export function joinEventAmountStroops(event: VaultJoinEvent): bigint {
  return poolById(event.poolId).stroops;
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
