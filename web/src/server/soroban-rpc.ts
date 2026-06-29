import {
  Account,
  Networks,
  Transaction,
  TransactionBuilder,
  rpc,
} from "@stellar/stellar-sdk";
import { formatError } from "@/lib/format-error";
import { formatSendTransactionError } from "@/lib/transaction-errors";
import { SOROBAN_RPC_URL, STELLAR_NETWORK } from "@/lib/config";

export function isTestnetNetwork(): boolean {
  return STELLAR_NETWORK.toLowerCase() !== "mainnet";
}

function networkPassphrase(): string {
  return STELLAR_NETWORK.toLowerCase() === "mainnet"
    ? Networks.PUBLIC
    : Networks.TESTNET;
}

export function sorobanRpc(): rpc.Server {
  return new rpc.Server(SOROBAN_RPC_URL, {
    allowHttp: isTestnetNetwork(),
  });
}

export function isAccountNotFoundError(err: unknown): boolean {
  const message = formatError(err).toLowerCase();
  return (
    message.includes("account not found") ||
    message.includes("could not find account")
  );
}

export async function loadStellarAccount(publicKey: string): Promise<Account> {
  return sorobanRpc().getAccount(publicKey);
}

export async function accountExistsOnChain(publicKey: string): Promise<boolean> {
  try {
    await loadStellarAccount(publicKey);
    return true;
  } catch (err) {
    if (isAccountNotFoundError(err)) return false;
    throw err;
  }
}

export async function prepareTransactionXdr(
  xdr: string
): Promise<{ xdr: string; latestLedger: number }> {
  const server = sorobanRpc();
  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase());
  const latest = await server.getLatestLedger();
  const prepared = await server.prepareTransaction(tx);
  return { xdr: prepared.toXDR(), latestLedger: latest.sequence };
}

function formatSendTransactionFailure(
  result: rpc.Api.SendTransactionResponse
): string {
  return formatSendTransactionError(result);
}

export async function sendTransactionXdrOnChain(xdr: string): Promise<string> {
  const server = sorobanRpc();
  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase()) as Transaction;
  if (tx.signatures.length === 0) {
    throw new Error(
      "Transaction has no signatures — wallet did not sign. Check Freighter network (Testnet) and reconnect."
    );
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await server.sendTransaction(tx);
    if (result.status === "PENDING" || result.status === "DUPLICATE") {
      return result.hash;
    }
    if (result.status === "TRY_AGAIN_LATER") {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    throw new Error(
      `Transaction failed: ${formatSendTransactionFailure(result)}`
    );
  }

  throw new Error("Transaction failed: network busy, try again");
}
