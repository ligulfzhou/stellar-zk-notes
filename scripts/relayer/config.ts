import { Networks } from "@stellar/stellar-sdk";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env ${name}`);
  }
  return value;
}

export const relayerConfig = {
  secret: () => required("RELAYER_SECRET"),
  vaultId: () =>
    process.env.VAULT_ID ??
    process.env.NEXT_PUBLIC_VAULT_CONTRACT_ID ??
    required("VAULT_ID"),
  sorobanRpc: () =>
    process.env.SOROBAN_RPC ??
    process.env.SOROBAN_RPC_URL ??
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
    "https://soroban-rpc.testnet.stellar.gateway.fm",
  networkPassphrase: () =>
    (process.env.STELLAR_NETWORK ?? "testnet").toLowerCase() === "mainnet"
      ? Networks.PUBLIC
      : Networks.TESTNET,
  submitPort: () => Number(process.env.RELAYER_PORT ?? "8787"),
  minFeeStroops: () => Number(process.env.RELAYER_MIN_FEE_STROOPS ?? "10000"),
  defaultFeeStroops: () =>
    Number(process.env.RELAYER_DEFAULT_FEE_STROOPS ?? "100000"),
};
