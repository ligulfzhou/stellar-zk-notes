#!/usr/bin/env npx tsx
/**
 * Privacy audit: scan UTXO vault events for leaked metadata.
 *
 * Usage:
 *   npx tsx scripts/e2e/privacy-audit.ts --vault <CONTRACT_ID>
 */
import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { config, env, requireVaultId } from "./config.ts";

function parseArgs(): { vaultId: string; startLedger?: number } {
  const args = process.argv.slice(2);
  let vaultId = env("VAULT_ID") || config.vaultId;
  let startLedger: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      console.log(`Usage: npx tsx scripts/e2e/privacy-audit.ts [--vault ID]`);
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
  if (!vaultId) vaultId = requireVaultId();
  return { vaultId, startLedger };
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (value instanceof Map) return Object.fromEntries(value.entries());
  return value as Record<string, unknown>;
}

function eventKind(body: Record<string, unknown>): string {
  if (body.commitment !== undefined && body.leaf_index !== undefined) {
    return "deposit";
  }
  if (body.new_commitment !== undefined || body.newCommitment !== undefined) {
    return "shielded_send";
  }
  if (body.recipient !== undefined && body.amount !== undefined) {
    return "withdraw";
  }
  if (body.nullifier !== undefined) return "exit";
  return "unknown";
}

async function main() {
  const { vaultId, startLedger } = parseArgs();
  const server = new rpc.Server(config.rpcUrl, { allowHttp: true });
  const latest = await server.getLatestLedger();
  const start = startLedger ?? Math.max(1, latest.sequence - 10_000);

  const response = await server.getEvents({
    filters: [{ type: "contract", contractIds: [vaultId] }],
    startLedger: start,
    limit: 500,
  });

  const counts: Record<string, number> = {};
  const violations: string[] = [];

  for (const event of response.events) {
    const body = normalizeRecord(scValToNative(event.value));
    if (!body) continue;
    const kind = eventKind(body);
    counts[kind] = (counts[kind] ?? 0) + 1;

    if (kind === "deposit") {
      if (body.depositor !== undefined || body.amount !== undefined) {
        violations.push(`deposit tx ${event.txHash}: leaks depositor/amount`);
      }
    }
    if (kind === "exit") {
      if (body.recipient !== undefined || body.amount !== undefined) {
        violations.push(`exit tx ${event.txHash}: leaks recipient/amount`);
      }
    }
  }

  console.log("Privacy audit — zk-utxo vault", vaultId);
  console.log("  events scanned:", response.events.length);
  console.log("  by kind:", counts);
  console.log("  note: on-chain withdraw events intentionally expose recipient + amount");
  console.log("  note: relayer exit events expose nullifier only");

  if (violations.length) {
    console.error("\n❌ Violations:");
    for (const v of violations) console.error("  -", v);
    process.exit(1);
  }
  console.log("\n✅ No unexpected identity leaks in deposit/exit events");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
