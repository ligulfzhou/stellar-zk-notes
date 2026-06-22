import { createServer } from "node:http";
import { rpc, TransactionBuilder } from "@stellar/stellar-sdk";
import { relayerConfig } from "./config.ts";
import { relayerPublicKey, submitExitViaRelayer } from "./exit.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function submitSignedXdr(signedXdr: string): Promise<string> {
  const server = new rpc.Server(relayerConfig.sorobanRpc(), { allowHttp: true });
  const tx = TransactionBuilder.fromXDR(
    signedXdr,
    relayerConfig.networkPassphrase()
  );
  const result = await server.sendTransaction(tx);
  if (result.status === "ERROR") {
    throw new Error(JSON.stringify(result.errorResult));
  }
  return result.hash;
}

async function readJsonBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString());
}

export function startSubmitServer(): void {
  const port = relayerConfig.submitPort();
  createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors).end();
      return;
    }

    if (req.method === "GET" && req.url === "/info") {
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(
        JSON.stringify({
          publicKey: relayerPublicKey(),
          vaultId: relayerConfig.vaultId(),
          defaultFeeStroops: relayerConfig.defaultFeeStroops(),
          minFeeStroops: relayerConfig.minFeeStroops(),
        })
      );
      return;
    }

    if (req.method === "POST" && req.url === "/exit") {
      try {
        const body = (await readJsonBody(req)) as {
          poolId?: number;
          recipient?: string;
          relayerFeeStroops?: number;
          nullifierHexes?: string[];
          merkleRootHex?: string;
          publicInputsHex?: string;
          proofHex?: string;
        };
        if (
          body.poolId === undefined ||
          !body.recipient ||
          body.relayerFeeStroops === undefined ||
          !body.nullifierHexes ||
          !body.merkleRootHex ||
          !body.publicInputsHex ||
          !body.proofHex
        ) {
          res.writeHead(400, { "Content-Type": "application/json", ...cors });
          res.end(JSON.stringify({ error: "missing exit fields" }));
          return;
        }
        const txHash = await submitExitViaRelayer({
          poolId: body.poolId,
          recipient: body.recipient,
          relayerFeeStroops: body.relayerFeeStroops,
          nullifierHexes: body.nullifierHexes,
          merkleRootHex: body.merkleRootHex,
          publicInputsHex: body.publicInputsHex,
          proofHex: body.proofHex,
        });
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ txHash }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === "POST" && req.url === "/submit") {
      try {
        const body = (await readJsonBody(req)) as { xdr?: string };
        if (!body.xdr) {
          res.writeHead(400).end(JSON.stringify({ error: "xdr required" }));
          return;
        }
        const txHash = await submitSignedXdr(body.xdr);
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ txHash }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    res.writeHead(404).end();
  }).listen(port, () => {
    console.log(`Relayer listening on :${port}`);
    console.log(`  GET  /info   — relayer G + default fee`);
    console.log(`  POST /exit   — Tornado-style gasless exit (relayer submits + earns fee)`);
    console.log(`  POST /submit — forward signed XDR`);
    console.log(`  relayer: ${relayerPublicKey()}`);
  });
}
