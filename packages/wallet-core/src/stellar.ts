import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { derivePath } from "ed25519-hd-key";
import { mnemonicToBip39Seed } from "./mnemonic.js";

/** SEP-0005 Stellar account from unified mnemonic. */
export async function deriveStellarKeypair(
  mnemonic: string,
  accountIndex = 0
): Promise<{ publicKey: string; secretKey: string }> {
  const seed = await mnemonicToBip39Seed(mnemonic);
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
