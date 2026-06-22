import {
  Asset,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { Horizon } from "@stellar/stellar-sdk/lib/horizon";
import { relayerConfig } from "./config.ts";
import { decryptExit } from "../../web/src/lib/exit-crypto.ts";
import type { ExitJob } from "./payout-types.ts";

function x25519SecretFromHex(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function payoutExit(job: ExitJob): Promise<string> {
  const relayer = Keypair.fromSecret(relayerConfig.secret());
  const sk = x25519SecretFromHex(relayerConfig.x25519SecretHex());
  const payload = decryptExit(sk, job.encryptedExit);

  const horizon = new Horizon.Server(relayerConfig.horizonUrl());
  const account = await horizon.loadAccount(relayer.publicKey());
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: relayerConfig.networkPassphrase(),
  }).addOperation(
    Operation.payment({
      destination: payload.recipient,
      asset: Asset.native(),
      amount: (Number(payload.amountStroops) / 1e7).toFixed(7),
    })
  );

  if (payload.memo && payload.memo.length <= 28) {
    builder.addMemo(Memo.text(payload.memo));
  }

  const tx = builder.setTimeout(60).build();
  tx.sign(relayer);
  const result = await horizon.submitTransaction(tx);
  return result.hash;
}
