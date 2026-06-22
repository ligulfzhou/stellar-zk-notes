import { RELAYER_URL } from "./config";

export type RelayerInfo = {
  publicKey: string;
  vaultId: string;
  defaultFeeStroops: number;
  minFeeStroops: number;
};

export async function fetchRelayerInfo(): Promise<RelayerInfo | null> {
  if (!RELAYER_URL) return null;
  const res = await fetch(`${RELAYER_URL.replace(/\/$/, "")}/info`);
  if (!res.ok) return null;
  return (await res.json()) as RelayerInfo;
}

export async function submitExitViaRelayer(params: {
  poolId: number;
  recipient: string;
  relayerFeeStroops: number;
  nullifierHexes: string[];
  merkleRootHex: string;
  publicInputs: Uint8Array;
  proofBytes: Uint8Array;
}): Promise<string> {
  if (!RELAYER_URL) {
    throw new Error("Set NEXT_PUBLIC_RELAYER_URL for relayer exit");
  }
  const publicInputsHex =
    "0x" +
    [...params.publicInputs].map((b) => b.toString(16).padStart(2, "0")).join("");
  const proofHex =
    "0x" +
    [...params.proofBytes].map((b) => b.toString(16).padStart(2, "0")).join("");

  const res = await fetch(`${RELAYER_URL.replace(/\/$/, "")}/exit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      poolId: params.poolId,
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
    throw new Error(data.error ?? "Relayer exit failed");
  }
  return data.txHash;
}
