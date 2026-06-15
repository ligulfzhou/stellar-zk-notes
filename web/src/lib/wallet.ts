import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import {
  KitEventType,
  Networks,
  SwkAppDarkTheme,
} from "@creit.tech/stellar-wallets-kit/types";
import { Networks as StellarNetworks } from "@stellar/stellar-sdk";
import { STELLAR_NETWORK } from "./config";
import { formatError } from "./format-error";

let initialized = false;

export function networkPassphrase(): string {
  return STELLAR_NETWORK === "mainnet"
    ? StellarNetworks.PUBLIC
    : StellarNetworks.TESTNET;
}

export function initWalletsKit(): void {
  if (initialized || typeof window === "undefined") return;

  const network =
    STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

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
  initWalletsKit();
  try {
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
      networkPassphrase: networkPassphrase(),
      address,
    });
    if (!signedTxXdr) {
      throw new Error("Wallet returned no signed transaction");
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
