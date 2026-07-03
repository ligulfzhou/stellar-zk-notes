import { generateMnemonic, mnemonicToSeed, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const SHIELDED_MASTER_INFO = new TextEncoder().encode("zk-utxo-master-v1");

/** BIP39 24-word mnemonic (256-bit entropy). */
export function createWalletMnemonic(): string {
  return generateMnemonic(wordlist, 256);
}

export function assertValidMnemonic(mnemonic: string): string {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error("Invalid recovery phrase — check words and order");
  }
  return normalized;
}

export async function mnemonicToBip39Seed(
  mnemonic: string,
  passphrase = ""
): Promise<Uint8Array> {
  const normalized = assertValidMnemonic(mnemonic);
  return mnemonicToSeed(normalized, passphrase);
}

/** Shielded master seed — domain-separated from Stellar SEP-0005 paths. */
export async function mnemonicToShieldedMasterSeed(
  mnemonic: string,
  passphrase = ""
): Promise<Uint8Array> {
  const bip39Seed = await mnemonicToBip39Seed(mnemonic, passphrase);
  return hkdf(sha256, bip39Seed, new Uint8Array(), SHIELDED_MASTER_INFO, 32);
}

export function formatMnemonicWords(mnemonic: string): string[] {
  return mnemonic.trim().toLowerCase().split(/\s+/);
}
