import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import {
  KitEventType,
  Networks,
  SwkAppDarkTheme,
} from "@creit.tech/stellar-wallets-kit/types";
import {
  Networks as StellarNetworks,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { STELLAR_NETWORK } from "./config";
import { formatError } from "./format-error";

let initialized = false;

export function networkPassphrase(): string {
  return STELLAR_NETWORK.toLowerCase() === "mainnet"
    ? StellarNetworks.PUBLIC
    : StellarNetworks.TESTNET;
}

function kitNetwork(): Networks {
  return STELLAR_NETWORK.toLowerCase() === "mainnet"
    ? Networks.PUBLIC
    : Networks.TESTNET;
}

/** Ensure Freighter (or other wallet) matches app network and signing account. */
export async function assertWalletReadyForSigning(
  expectedAddress: string
): Promise<void> {
  initWalletsKit();
  const expectedPassphrase = networkPassphrase();

  let walletPassphrase: string;
  let walletNetwork: string | undefined;
  try {
    const network = await StellarWalletsKit.getNetwork();
    walletPassphrase = network.networkPassphrase;
    walletNetwork = network.network;
  } catch (err) {
    throw new Error(
      `Could not read wallet network: ${formatError(err)}. Open Freighter and set network to Testnet.`
    );
  }

  if (walletPassphrase !== expectedPassphrase) {
    throw new Error(
      `Wallet network mismatch: wallet is on "${walletNetwork ?? "unknown"}" but this app uses ${STELLAR_NETWORK}. In Freighter, switch to Testnet (Settings → Network), then reconnect.`
    );
  }

  const { address } = await StellarWalletsKit.fetchAddress();
  if (address !== expectedAddress) {
    throw new Error(
      `Wallet account mismatch: Freighter is on ${address.slice(0, 8)}… but this action needs ${expectedAddress.slice(0, 8)}…. Switch account in Freighter or reconnect.`
    );
  }
}

export function initWalletsKit(): void {
  if (initialized || typeof window === "undefined") return;

  const network = kitNetwork();

  StellarWalletsKit.init({
    modules: defaultModules(),
    network,
    theme: SwkAppDarkTheme,
  });
  initialized = true;
}

export async function connectWallet(): Promise<string> {
  initWalletsKit();
  const { address } = await StellarWalletsKit.authModal();
  return address;
}

export async function openWalletProfile(): Promise<void> {
  initWalletsKit();
  await StellarWalletsKit.profileModal();
}

export async function disconnectWallet(): Promise<void> {
  initWalletsKit();
  await StellarWalletsKit.disconnect();
}

export async function getPublicKey(): Promise<string | null> {
  initWalletsKit();
  try {
    const { address } = await StellarWalletsKit.getAddress();
    return address || null;
  } catch {
    return null;
  }
}

export async function signTransactionXdr(
  xdr: string,
  address: string
): Promise<string> {
  await assertWalletReadyForSigning(address);
  initWalletsKit();
  const passphrase = networkPassphrase();
  try {
    const { signedTxXdr, signerAddress } = await StellarWalletsKit.signTransaction(
      xdr,
      {
        networkPassphrase: passphrase,
        address,
      }
    );
    if (!signedTxXdr) {
      throw new Error("Wallet returned no signed transaction");
    }
    if (signedTxXdr === xdr) {
      throw new Error(
        "Wallet did not sign the transaction. Confirm the Freighter prompt and ensure the wallet is on Testnet."
      );
    }
    if (signerAddress && signerAddress !== address) {
      throw new Error(
        `Wallet signed with ${signerAddress.slice(0, 8)}… instead of ${address.slice(0, 8)}…`
      );
    }
    const tx = TransactionBuilder.fromXDR(signedTxXdr, passphrase) as Transaction;
    if (tx.signatures.length === 0) {
      throw new Error(
        "Wallet returned an unsigned transaction. Ensure Freighter is on Testnet and approve the signing prompt."
      );
    }
    if (tx.source !== address) {
      throw new Error(
        `Transaction source (${tx.source.slice(0, 8)}…) does not match connected wallet (${address.slice(0, 8)}…)`
      );
    }
    return signedTxXdr;
  } catch (err) {
    throw new Error(formatError(err) || "Wallet signing cancelled");
  }
}

export function subscribeWalletAddress(
  onAddress: (address: string | undefined) => void
): () => void {
  initWalletsKit();
  return StellarWalletsKit.on(KitEventType.STATE_UPDATED, (event) => {
    onAddress(event.payload.address);
  });
}

/** @deprecated Use connectWallet */
export const connectFreighter = connectWallet;
