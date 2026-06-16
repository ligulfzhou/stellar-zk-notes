import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.join(import.meta.dirname, "../..");

function loadDotEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const envLocal = loadDotEnv(path.join(repoRoot, "web/.env.local"));
const envExample = loadDotEnv(path.join(repoRoot, "web/.env.local.example"));

export function env(key: string, fallback = ""): string {
  return process.env[key] ?? envLocal[key] ?? envExample[key] ?? fallback;
}

export const config = {
  repoRoot,
  network: env("NEXT_PUBLIC_STELLAR_NETWORK", "TESTNET"),
  rpcUrl: env(
    "NEXT_PUBLIC_SOROBAN_RPC_URL",
    "https://soroban-rpc.testnet.stellar.gateway.fm"
  ),
  vaultId: env("NEXT_PUBLIC_VAULT_CONTRACT_ID"),
  legacySend: env("NEXT_PUBLIC_VAULT_LEGACY_SEND", "true") !== "false",
  mockProof: env("ZK_MOCK_PROOF", "true") === "true",
  networkPassphrase:
    env("STELLAR_NETWORK_PASSPHRASE") ||
    "Test SDF Network ; September 2015",
};

export function requireVaultId(): string {
  if (!config.vaultId) {
    throw new Error("Set NEXT_PUBLIC_VAULT_CONTRACT_ID in web/.env.local");
  }
  return config.vaultId;
}
