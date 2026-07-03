import {
  deriveIncomingViewingKeyHex,
  deriveShieldedReceiveKeys,
  deriveSpendingSkDecimal,
  bytesToHex,
  fieldDecToHex,
} from "./shielded.js";
import { encodeShieldedAddress } from "./shielded-address.js";
import {
  createWalletMnemonic,
  mnemonicToShieldedMasterSeed,
  assertValidMnemonic,
} from "./mnemonic.js";
import { deriveStellarKeypair } from "./stellar.js";

export const DOMAIN_SPENDING_PK = "1";
export const DOMAIN_NULLIFIER_KEY = "2";

/** Poseidon2 pair hash — inject from Noir (extension / web). */
export type HashPairFn = (left: string, right: string) => Promise<string>;

export async function deriveSpendingPk(
  spendingSk: string,
  hashPair: HashPairFn
): Promise<string> {
  return hashPair(spendingSk, DOMAIN_SPENDING_PK);
}

export async function diversifiedRecipientPk(
  spendingPk: string,
  diversifier: string,
  hashPair: HashPairFn
): Promise<string> {
  if (BigInt(diversifier) === 0n) return spendingPk;
  return hashPair(spendingPk, diversifier);
}

export type ShieldedReceiveBundle = {
  diversifier: string;
  spendingSk: string;
  spendingPk: string;
  recipientPk: string;
  recipientPkHex: string;
  x25519Hex: string;
  address: string;
  incomingViewingKeyHex: string;
};

export async function deriveShieldedReceiveBundle(
  shieldedMaster: Uint8Array,
  diversifier: string | bigint,
  hashPair: HashPairFn
): Promise<ShieldedReceiveBundle> {
  const d =
    typeof diversifier === "bigint" ? diversifier.toString() : diversifier;
  const spendingSk = deriveSpendingSkDecimal(shieldedMaster);
  const spendingPk = await deriveSpendingPk(spendingSk, hashPair);
  const recipientPk = await diversifiedRecipientPk(spendingPk, d, hashPair);
  const { publicKey } = deriveShieldedReceiveKeys(shieldedMaster, d);
  const x25519Hex = bytesToHex(publicKey);
  return {
    diversifier: d,
    spendingSk,
    spendingPk,
    recipientPk,
    recipientPkHex: fieldDecToHex(recipientPk),
    x25519Hex,
    address: encodeShieldedAddress({
      diversifier: d,
      recipientPk,
      x25519Hex,
    }),
    incomingViewingKeyHex: deriveIncomingViewingKeyHex(shieldedMaster),
  };
}

export type UnifiedWallet = {
  mnemonic: string;
  stellarPublicKey: string;
  stellarSecretKey: string;
  shieldedMaster: Uint8Array;
};

export async function createUnifiedWallet(): Promise<UnifiedWallet> {
  const mnemonic = createWalletMnemonic();
  return importUnifiedWallet(mnemonic);
}

export async function importUnifiedWallet(mnemonic: string): Promise<UnifiedWallet> {
  assertValidMnemonic(mnemonic);
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  const { publicKey, secretKey } = await deriveStellarKeypair(normalized, 0);
  const shieldedMaster = await mnemonicToShieldedMasterSeed(normalized);
  return {
    mnemonic: normalized,
    stellarPublicKey: publicKey,
    stellarSecretKey: secretKey,
    shieldedMaster,
  };
}

export {
  createWalletMnemonic,
  assertValidMnemonic,
  mnemonicToShieldedMasterSeed,
  formatMnemonicWords,
} from "./mnemonic.js";
export { deriveStellarKeypair, signStellarTransactionXdr } from "./stellar.js";
export {
  encodeShieldedAddress,
  decodeShieldedAddress,
  SHIELDED_ADDRESS_HRP,
} from "./shielded-address.js";
