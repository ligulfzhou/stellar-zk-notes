import { Keypair, TransactionBuilder, hash } from "@stellar/stellar-sdk";
import { mnemonicToSeed } from "@scure/bip39";
import { derivePath } from "ed25519-hd-key";
import { wordlist } from "@scure/bip39/wordlists/english";
import { assertValidMnemonic } from "@/lib/mnemonic-wallet";

/** SEP-0005 Stellar account from unified mnemonic. */
export async function deriveStellarKeypairFromMnemonic(
  mnemonic: string,
  accountIndex = 0
): Promise<{ publicKey: string; secretKey: string }> {
  assertValidMnemonic(mnemonic);
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  const seed = await mnemonicToSeed(normalized, "");
  const path = `m/44'/148'/${accountIndex}'`;
  const { key } = derivePath(path, Buffer.from(seed).toString("hex"));
  const kp = Keypair.fromRawEd25519Seed(key);
  return { publicKey: kp.publicKey(), secretKey: kp.secret() };
}

export function signStellarTransactionXdr(
  secretKey: string,
  xdr: string,
  networkPassphrase: string
): string {
  const kp = Keypair.fromSecret(secretKey);
  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  tx.sign(kp);
  return tx.toXDR();
}

/** Sign a Soroban auth-entry preimage (base64 XDR) with the local keypair. */
export function signAuthEntryPreimage(
  secretKey: string,
  preimageXdrBase64: string
): string {
  const kp = Keypair.fromSecret(secretKey);
  const preimage = Buffer.from(preimageXdrBase64, "base64");
  return kp.sign(hash(preimage)).toString("base64");
}
