import { generateMnemonic, mnemonicToSeed, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

const MNEMONIC_INFO = new TextEncoder().encode("zk-utxo-master-v1");

/** BIP39 24-word mnemonic (256-bit entropy). */
export function createWalletMnemonic(): string {
  return generateMnemonic(wordlist, 256);
}

export function assertValidMnemonic(mnemonic: string): void {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error("Invalid recovery phrase — check words and order");
  }
}

/** Derive 32-byte privacy wallet master seed from mnemonic (domain-separated from BIP44). */
export async function mnemonicToMasterSeed(
  mnemonic: string,
  passphrase = ""
): Promise<Uint8Array> {
  assertValidMnemonic(mnemonic);
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  const bip39Seed = await mnemonicToSeed(normalized, passphrase);
  return hkdf(sha256, bip39Seed, new Uint8Array(), MNEMONIC_INFO, 32);
}

export function formatMnemonicWords(mnemonic: string): string[] {
  return mnemonic.trim().toLowerCase().split(/\s+/);
}
