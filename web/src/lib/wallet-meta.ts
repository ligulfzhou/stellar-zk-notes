import { get, set } from "idb-keyval";

const META_KEY = "zk-utxo:wallet-meta";

export type WalletMeta = {
  stellarPublicKey: string;
};

export async function loadWalletMeta(): Promise<WalletMeta | null> {
  return (await get<WalletMeta | null>(META_KEY)) ?? null;
}

export async function saveWalletMeta(meta: WalletMeta): Promise<void> {
  await set(META_KEY, meta);
}
