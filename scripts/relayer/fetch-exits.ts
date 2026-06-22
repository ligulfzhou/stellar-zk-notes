import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { relayerConfig } from "./config.ts";
import type { ExitJob } from "./payout-types.ts";

export async function fetchExitJobs(processed: Set<string>): Promise<ExitJob[]> {
  const server = new rpc.Server(relayerConfig.sorobanRpc(), { allowHttp: true });
  const vaultId = relayerConfig.vaultId();
  const latest = await server.getLatestLedger();
  const start = Math.max(1, latest.sequence - 10_000);
  const jobs: ExitJob[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 50; page++) {
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
      const body = scValToNative(event.value) as Record<string, unknown>;
      const exitHash = body.exit_hash ?? body.exitHash;
      const nullifier = body.nullifier;
      if (!exitHash || !nullifier || body.pool_id === undefined) continue;
      const key = `${event.txHash}:${String(exitHash)}`;
      if (processed.has(key)) continue;

      const encryptedExit = await readEncryptedExitFromTx(server, event.txHash);
      if (!encryptedExit) continue;

      jobs.push({
        txHash: event.txHash,
        poolId: Number(body.pool_id),
        nullifier: String(nullifier),
        exitHash: String(exitHash),
        encryptedExit,
      });
    }

    if (!res.cursor || res.events.length === 0) break;
    cursor = res.cursor;
  }

  return jobs;
}

async function readEncryptedExitFromTx(
  server: rpc.Server,
  txHash: string
): Promise<Uint8Array | null> {
  const tx = await server.getTransaction(txHash);
  if (tx.status !== "SUCCESS") return null;
  const envelope = xdr.TransactionEnvelope.fromXDR(tx.envelopeXdr, "base64");
  const ops = envelope.v1()?.tx()?.operations() ?? [];
  for (const op of ops) {
    const body = op.body();
    if (body.switch().name !== "invokeHostFunction") continue;
    const invoke = body.invokeHostFunctionOp();
    const host = invoke.hostFunction();
    if (host.switch().name !== "hostFunctionTypeInvokeContract") continue;
    const invokeContract = host.invokeContract();
    if (invokeContract.functionName().toString() !== "exit_pool") continue;
    const args = invokeContract.args();
    const last = args[args.length - 1];
    if (!last) return null;
    const bytes = scValToNative(last);
    if (bytes instanceof Uint8Array) return bytes;
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(bytes)) {
      return new Uint8Array(bytes);
    }
  }
  return null;
}
