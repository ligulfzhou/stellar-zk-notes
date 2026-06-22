import {
  Account,
  Address,
  Contract,
  Keypair,
  rpc,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { relayerConfig } from "./config.ts";

function fieldHexToBytes32(hex: string): Uint8Array {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  const padded = normalized.padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export type RelayerExitRequest = {
  poolId: number;
  recipient: string;
  relayerFeeStroops: number;
  nullifierHexes: string[];
  merkleRootHex: string;
  publicInputsHex: string;
  proofHex: string;
};

export async function submitExitViaRelayer(
  params: RelayerExitRequest
): Promise<string> {
  if (params.relayerFeeStroops < relayerConfig.minFeeStroops()) {
    throw new Error(
      `relayer fee below minimum (${relayerConfig.minFeeStroops()} stroops)`
    );
  }

  const kp = Keypair.fromSecret(relayerConfig.secret());
  const relayerPub = kp.publicKey();
  if (params.recipient === relayerPub) {
    throw new Error("recipient must differ from relayer");
  }

  const server = new rpc.Server(relayerConfig.sorobanRpc(), { allowHttp: true });
  const source = await server.getAccount(relayerPub);
  const contract = new Contract(relayerConfig.vaultId());

  const padHex = (hexes: string[]) => {
    const out = [...hexes];
    while (out.length < 4) out.push("0x0");
    return out.slice(0, 4);
  };
  const nullifiers = padHex(params.nullifierHexes);
  const recipient = new Address(params.recipient);
  const relayer = new Address(relayerPub);

  let tx = new TransactionBuilder(source, {
    fee: "1000000",
    networkPassphrase: relayerConfig.networkPassphrase(),
  })
    .addOperation(
      contract.call(
        "exit_pool",
        nativeToScVal(params.poolId, { type: "u32" }),
        recipient.toScVal(),
        relayer.toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(nullifiers[0]!))),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(nullifiers[1]!))),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(nullifiers[2]!))),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(nullifiers[3]!))),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.merkleRootHex))),
        xdr.ScVal.scvBytes(Buffer.from(hexToBytes(params.publicInputsHex))),
        xdr.ScVal.scvBytes(Buffer.from(hexToBytes(params.proofHex))),
        nativeToScVal(params.relayerFeeStroops, { type: "u32" })
      )
    )
    .setTimeout(180)
    .build();

  tx = await server.prepareTransaction(tx);
  tx.sign(kp);

  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await server.sendTransaction(tx);
    if (result.status === "PENDING" || result.status === "DUPLICATE") {
      return result.hash;
    }
    if (result.status === "TRY_AGAIN_LATER") {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    throw new Error(`send failed: ${JSON.stringify(result)}`);
  }
  throw new Error("send failed: network busy");
}

export function relayerPublicKey(): string {
  return Keypair.fromSecret(relayerConfig.secret()).publicKey();
}
