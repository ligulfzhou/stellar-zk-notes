import {
  Networks as StellarNetworks,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { STELLAR_NETWORK } from "./config";
import { formatError } from "./format-error";
import {
  signAuthEntryPreimage,
  signStellarTransactionXdr,
} from "./unified-stellar";
import { loadWalletMeta } from "./wallet-meta";
import { useSecretsStore } from "@/store/useSecretsStore";

export type WalletBackend = "unified";

export function networkPassphrase(): string {
  return STELLAR_NETWORK.toLowerCase() === "mainnet"
    ? StellarNetworks.PUBLIC
    : StellarNetworks.TESTNET;
}

export function usesUnifiedWallet(): boolean {
  const { unlocked, stellarPublicKey } = useSecretsStore.getState();
  return Boolean(unlocked && stellarPublicKey);
}

export async function detectWalletBackend(): Promise<WalletBackend | null> {
  if (usesUnifiedWallet()) return "unified";
  const meta = await loadWalletMeta();
  if (meta) return "unified";
  return null;
}

export async function assertWalletReadyForSigning(
  expectedAddress: string
): Promise<void> {
  const { unlocked, stellarPublicKey } = useSecretsStore.getState();
  if (!unlocked || !stellarPublicKey) {
    throw new Error("Unlock your wallet in the Notes tab");
  }
  if (stellarPublicKey !== expectedAddress) {
    throw new Error(
      `Wallet account mismatch: expected ${expectedAddress.slice(0, 8)}…`
    );
  }
}

/** Connect the local unified wallet (unlock required). */
export async function connectWallet(): Promise<string> {
  const secrets = useSecretsStore.getState();
  if (secrets.unlocked && secrets.stellarPublicKey) {
    return secrets.stellarPublicKey;
  }

  const meta = await loadWalletMeta();
  if (meta) {
    throw new Error("Unlock your wallet in the Notes tab");
  }

  throw new Error("Create a wallet in the Notes tab first");
}

export async function getPublicKey(): Promise<string | null> {
  const { unlocked, stellarPublicKey } = useSecretsStore.getState();
  if (unlocked && stellarPublicKey) return stellarPublicKey;
  const meta = await loadWalletMeta();
  return meta?.stellarPublicKey ?? null;
}

export async function signTransactionXdr(
  xdr: string,
  address: string
): Promise<string> {
  await assertWalletReadyForSigning(address);

  const { stellarSecretKey, stellarPublicKey } = useSecretsStore.getState();
  if (!stellarSecretKey || stellarPublicKey !== address) {
    throw new Error("Unlock your wallet in the Notes tab");
  }

  const signedTxXdr = signStellarTransactionXdr(
    stellarSecretKey,
    xdr,
    networkPassphrase()
  );
  return verifySignedXdr(signedTxXdr, xdr, address);
}

export async function signSorobanAuthPreimage(
  preimageXdrBase64: string,
  address: string
): Promise<string> {
  await assertWalletReadyForSigning(address);
  const { stellarSecretKey, stellarPublicKey } = useSecretsStore.getState();
  if (!stellarSecretKey || stellarPublicKey !== address) {
    throw new Error("Unlock your wallet in the Notes tab");
  }
  try {
    return signAuthEntryPreimage(stellarSecretKey, preimageXdrBase64);
  } catch (err) {
    throw new Error(formatError(err) || "Auth entry signing failed");
  }
}

function verifySignedXdr(
  signedTxXdr: string,
  xdr: string,
  address: string,
  signerAddress?: string
): string {
  if (signedTxXdr === xdr) {
    throw new Error("Wallet did not sign the transaction.");
  }
  if (signerAddress && signerAddress !== address) {
    throw new Error(
      `Wallet signed with ${signerAddress.slice(0, 8)}… instead of ${address.slice(0, 8)}…`
    );
  }
  const tx = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase()) as Transaction;
  if (tx.signatures.length === 0) {
    throw new Error("Wallet returned an unsigned transaction.");
  }
  if (tx.source !== address) {
    throw new Error(
      `Transaction source (${tx.source.slice(0, 8)}…) does not match wallet (${address.slice(0, 8)}…)`
    );
  }
  return signedTxXdr;
}
