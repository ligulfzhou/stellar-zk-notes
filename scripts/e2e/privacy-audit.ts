#!/usr/bin/env npx tsx
/**
 * Privacy audit: scan vault contract events for leaked identity metadata.
 *
 * Usage:
 *   npx tsx scripts/e2e/privacy-audit.ts --vault <CONTRACT_ID>
 *   VAULT_ID=... npx tsx scripts/e2e/privacy-audit.ts
 */
import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { config, env, requireVaultId } from "./config.ts";

const FORBIDDEN_KEYS = ["depositor", "recipient", "amount", "owner"] as const;

function parseArgs(): { vaultId: string; startLedger?: number } {
  const args = process.argv.slice(2);
  let vaultId = env("VAULT_ID") || config.vaultId;
  let startLedger: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      console.log(`Usage: npx tsx scripts/e2e/privacy-audit.ts [--vault ID] [--start-ledger N]

Scans vault events and fails if Phase C events expose depositor/recipient/amount/owner.
Also prints a join/exit unlinkability heuristic report.`);
      process.exit(0);
    }
    if (args[i] === "--vault" && args[i + 1]) {
      vaultId = args[i + 1]!;
      i++;
    }
    if (args[i] === "--start-ledger" && args[i + 1]) {
      startLedger = Number(args[i + 1]);
      i++;
    }
  }
  if (!vaultId) {
    vaultId = requireVaultId();
  }
  return { vaultId, startLedger };
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (value instanceof Map) return Object.fromEntries(value.entries());
  return value as Record<string, unknown>;
}

function eventKind(body: Record<string, unknown>): string {
  if (body.commitment !== undefined && body.leaf_index !== undefined) return "join";
  if (
    body.nullifier !== undefined &&
    body.pool_id !== undefined &&
    body.new_commitment === undefined &&
    body.newCommitment === undefined &&
    body.encrypted_note === undefined &&
    body.encryptedNote === undefined
  ) {
    return "exit";
  }
  if (body.encrypted_note !== undefined || body.encryptedNote !== undefined) {
    return "shielded_send";
  }
  if (body.new_commitment !== undefined || body.newCommitment !== undefined) {
    return "shielded_send";
  }
  return "unknown";
}

async function resolveEventsStartLedger(server: rpc.Server): Promise<number> {
  const [latest, health] = await Promise.all([
    server.getLatestLedger(),
    server.getHealth(),
  ]);
  const retention = health.ledgerRetentionWindow ?? 120_960;
  const minAllowed = Math.max(health.oldestLedger, latest.sequence - retention + 16);
  const recentStart = latest.sequence - 10_000;
  return Math.max(minAllowed, recentStart);
}

async function scanEvents(vaultId: string, startLedger?: number) {
  const server = new rpc.Server(config.rpcUrl, { allowHttp: true });
  const start =
    startLedger ?? (await resolveEventsStartLedger(server));

  const joins: Array<{ txHash: string; poolId: number; leafIndex: number }> = [];
  const exits: Array<{ txHash: string; poolId: number; nullifier: string }> = [];
  const violations: string[] = [];
  let cursor: string | undefined;
  let total = 0;

  for (let page = 0; page < 100; page++) {
    const res = cursor
      ? await server.getEvents({
          filters: [{ type: "contract", contractIds: [vaultId] }],
          cursor,
          limit: 200,
        })
      : await server.getEvents({
          filters: [{ type: "contract", contractIds: [vaultId] }],
          startLedger: start,
          limit: 200,
        });

    for (const event of res.events) {
      total++;
      const body = normalizeRecord(scValToNative(event.value));
      if (!body) continue;

      const kind = eventKind(body);
      for (const key of FORBIDDEN_KEYS) {
        if (body[key] !== undefined && body[key] !== null) {
          violations.push(
            `${kind} @ ${event.txHash.slice(0, 12)}… contains forbidden key "${key}"`
          );
        }
      }

      const poolId = Number(body.pool_id ?? body.poolId ?? -1);
      if (kind === "join" && poolId >= 0) {
        joins.push({
          txHash: event.txHash,
          poolId,
          leafIndex: Number(body.leaf_index ?? body.leafIndex ?? -1),
        });
      }
      if (kind === "exit" && poolId >= 0) {
        exits.push({
          txHash: event.txHash,
          poolId,
          nullifier: String(body.nullifier ?? ""),
        });
      }
    }

    if (!res.cursor || res.events.length === 0) break;
    cursor = res.cursor;
  }

  return { joins, exits, violations, total, start };
}

function unlinkabilityReport(
  joins: Array<{ poolId: number }>,
  exits: Array<{ poolId: number }>
): void {
  const byPool = new Map<number, { joins: number; exits: number }>();
  for (const j of joins) {
    const row = byPool.get(j.poolId) ?? { joins: 0, exits: 0 };
    row.joins++;
    byPool.set(j.poolId, row);
  }
  for (const e of exits) {
    const row = byPool.get(e.poolId) ?? { joins: 0, exits: 0 };
    row.exits++;
    byPool.set(e.poolId, row);
  }

  console.log("\nUnlinkability heuristic (random-match baseline):");
  if (byPool.size === 0) {
    console.log("  No join/exit events found in scan window.");
    return;
  }

  for (const [poolId, stats] of byPool) {
    const randomScore =
      stats.joins > 0 && stats.exits > 0
        ? stats.exits / stats.joins
        : 0;
    console.log(
      `  pool ${poolId}: ${stats.joins} join(s), ${stats.exits} exit(s) — ` +
        `random match rate ≈ ${(randomScore * 100).toFixed(1)}% per exit`
    );
  }
  console.log(
    "  (Observer with only vault events cannot do better than random without side channels.)"
  );
}

async function main(): Promise<void> {
  const { vaultId, startLedger } = parseArgs();
  console.log("zk-notes privacy audit");
  console.log(`  vault: ${vaultId}`);
  console.log(`  rpc:   ${config.rpcUrl}`);

  const { joins, exits, violations, total, start } = await scanEvents(
    vaultId,
    startLedger
  );

  console.log(`\nScanned ${total} event(s) from ledger ${start}`);
  console.log(`  joins: ${joins.length}, exits: ${exits.length}`);

  unlinkabilityReport(joins, exits);

  if (violations.length > 0) {
    console.error("\n❌ Privacy audit FAILED — forbidden metadata in events:");
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }

  console.log("\n✅ Privacy audit PASSED — no depositor/recipient/amount/owner in events");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
