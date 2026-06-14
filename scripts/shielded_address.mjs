#!/usr/bin/env node
/**
 * Derive zk1 shielded receive address from BIP39 mnemonic.
 * Usage: node scripts/shielded_address.mjs "word1 word2 ..." [testnet|mainnet]
 */
import { hkdf } from "../web/node_modules/@noble/hashes/hkdf.js";
import { sha256 } from "../web/node_modules/@noble/hashes/sha2.js";
import { x25519 } from "../web/node_modules/@noble/curves/ed25519.js";
import { mnemonicToSeedSync, validateMnemonic } from "../web/node_modules/@scure/bip39/index.js";
import { wordlist } from "../web/node_modules/@scure/bip39/wordlists/english.js";

const mnemonic = process.argv[2];
const network = process.argv[3] ?? "testnet";

if (!mnemonic) {
  console.error('usage: node scripts/shielded_address.mjs "mnemonic words" [network]');
  process.exit(1);
}

const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
if (!validateMnemonic(normalized, wordlist)) {
  console.error("error: invalid BIP39 mnemonic");
  process.exit(1);
}

const HKDF_SALT = new TextEncoder().encode("zk-notes-shielded-v1");
const seed = mnemonicToSeedSync(normalized);
const scalar = hkdf(
  sha256,
  seed,
  HKDF_SALT,
  new TextEncoder().encode("receive-sk"),
  32
);
const { publicKey } = x25519.keygen(scalar);
const b64 = Buffer.from(publicKey)
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/g, "");

console.log(`zk1:${network}:${b64}`);
