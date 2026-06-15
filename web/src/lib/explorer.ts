import { STELLAR_NETWORK } from "./config";

export function stellarExpertNetwork(): "public" | "testnet" {
  return STELLAR_NETWORK.toLowerCase() === "mainnet" ? "public" : "testnet";
}

export function stellarExpertTxUrl(txHash: string): string {
  return `https://stellar.expert/explorer/${stellarExpertNetwork()}/tx/${txHash}`;
}
