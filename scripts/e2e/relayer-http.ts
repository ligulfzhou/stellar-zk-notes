import { config } from "./config.ts";
import { proofToHex, publicInputsToHex } from "./field.ts";

export async function submitExitViaRelayerHttp(params: {
  relayerUrl: string;
  recipient: string;
  relayerFeeStroops: number;
  nullifierHexes: string[];
  merkleRootHex: string;
  publicInputs: Uint8Array;
  proofBytes: Uint8Array;
}): Promise<string> {
  const base = params.relayerUrl.replace(/\/$/, "");
  const publicInputsHex = publicInputsToHex(params.publicInputs);
  const proofHex = proofToHex(params.proofBytes);

  const res = await fetch(`${base}/exit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: params.recipient,
      relayerFeeStroops: params.relayerFeeStroops,
      nullifierHexes: params.nullifierHexes,
      merkleRootHex: params.merkleRootHex,
      publicInputsHex,
      proofHex,
    }),
  });
  const data = (await res.json()) as { txHash?: string; error?: string };
  if (!res.ok || !data.txHash) {
    throw new Error(data.error ?? "Relayer HTTP exit failed");
  }
  return data.txHash;
}

export async function fetchRelayerInfo(relayerUrl: string): Promise<{
  publicKey: string;
  defaultFeeStroops: number;
} | null> {
  const base = relayerUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/info`);
  if (!res.ok) return null;
  return (await res.json()) as { publicKey: string; defaultFeeStroops: number };
}
