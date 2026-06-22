export const STELLAR_NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet";

export const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
  process.env.SOROBAN_RPC_URL ??
  "https://soroban-rpc.testnet.stellar.gateway.fm";

export const HORIZON_URL =
  process.env.HORIZON_URL ??
  process.env.NEXT_PUBLIC_HORIZON_URL ??
  (STELLAR_NETWORK.toLowerCase() === "mainnet"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org");

export const VAULT_CONTRACT_ID =
  process.env.NEXT_PUBLIC_VAULT_CONTRACT_ID ?? "";

export const NATIVE_XLM_SAC =
  process.env.NEXT_PUBLIC_NATIVE_XLM_SAC ??
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/** @deprecated pre-Phase-B vaults only; current vault uses shielded_transfer (16 args). */
export const VAULT_LEGACY_SEND =
  process.env.NEXT_PUBLIC_VAULT_LEGACY_SEND === "true";

export const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL ?? "";

/** Relayer G address (optional; otherwise fetched from GET /info). */
export const RELAYER_G = process.env.NEXT_PUBLIC_RELAYER_G ?? "";

export const DEFAULT_RELAYER_FEE_STROOPS =
  process.env.NEXT_PUBLIC_DEFAULT_RELAYER_FEE_STROOPS ?? "100000";

/** `strict` — submit via relayer when URL set; `dev` — direct submit with UI warning */
export type PrivacyMode = "strict" | "dev";

export const PRIVACY_MODE: PrivacyMode =
  process.env.NEXT_PUBLIC_PRIVACY_MODE === "dev" ? "dev" : "strict";
