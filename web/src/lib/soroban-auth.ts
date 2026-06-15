import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import {
  Address,
  Transaction,
  TransactionBuilder,
  authorizeEntry,
  xdr,
} from "@stellar/stellar-sdk";
import { initWalletsKit, networkPassphrase } from "./wallet";

type XdrEnumSwitch = { name?: string; value?: number };

function switchName(switchVal: XdrEnumSwitch): string {
  if (typeof switchVal?.name === "string" && switchVal.name.length > 0) {
    return switchVal.name;
  }
  return "";
}

function isUnsignedAddressAuth(entry: xdr.SorobanAuthorizationEntry): boolean {
  const credentials = entry.credentials();
  if (switchName(credentials.switch()) !== "sorobanCredentialsAddress") {
    return false;
  }
  return credentials.address().signature().switch().name === "scvVoid";
}

/** Sign Soroban auth entries that require a separate wallet auth prompt. */
export async function authorizePreparedTransaction(
  preparedXdr: string,
  address: string,
  validUntilLedgerSeq: number
): Promise<string> {
  initWalletsKit();
  const passphrase = networkPassphrase();
  const tx = TransactionBuilder.fromXDR(preparedXdr, passphrase) as Transaction;
  const op = tx.operations[0];
  if (!op || op.type !== "invokeHostFunction") {
    return preparedXdr;
  }

  const auth = op.auth ?? [];
  if (auth.length === 0) {
    return preparedXdr;
  }

  let signedCount = 0;
  for (let i = 0; i < auth.length; i++) {
    const entry = auth[i];
    const credentials = xdr.SorobanCredentials.fromXDR(entry.credentials().toXDR());
    const credType = switchName(credentials.switch());

    // Source-account auth is satisfied by signing the transaction envelope.
    if (credType === "sorobanCredentialsSourceAccount") {
      continue;
    }

    if (credType !== "sorobanCredentialsAddress" || !isUnsignedAddressAuth(entry)) {
      continue;
    }

    const authEntryAddress = Address.fromScAddress(
      credentials.address().address()
    ).toString();
    if (authEntryAddress !== address) {
      continue;
    }

    auth[i] = await authorizeEntry(
      entry,
      async (preimage) => {
        const { signedAuthEntry } = await StellarWalletsKit.signAuthEntry(
          preimage.toXDR("base64"),
          { networkPassphrase: passphrase, address }
        );
        if (!signedAuthEntry) {
          throw new Error("Wallet returned no signed auth entry");
        }
        return Buffer.from(signedAuthEntry, "base64");
      },
      validUntilLedgerSeq,
      passphrase
    );
    signedCount++;
  }

  if (signedCount > 0) {
    return tx.toXDR();
  }

  const needsOtherSigner = auth.some((entry) => {
    if (!isUnsignedAddressAuth(entry)) return false;
    const cred = entry.credentials();
    const authEntryAddress = Address.fromScAddress(
      cred.address().address()
    ).toString();
    return authEntryAddress !== address;
  });
  if (needsOtherSigner) {
    throw new Error(
      "This transaction needs Soroban auth from a different account than the connected wallet"
    );
  }

  // Only source-account auth (or already-signed address auth): envelope signature is enough.
  return preparedXdr;
}
