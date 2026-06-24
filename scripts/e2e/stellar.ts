import {
  Account,
  Address,
  Contract,
  Keypair,
  rpc,
  scValToNative,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { config, requireVaultId } from "./config.ts";
import { fieldHexToBytes32 } from "./field.ts";

export type Signer = {
  publicKey: string;
  signTransaction: (xdr: string) => Promise<string>;
};

export function signerFromSecret(secret: string): Signer {
  const kp = Keypair.fromSecret(secret);
  return {
    publicKey: kp.publicKey(),
    signTransaction: async (xdrStr: string) => {
      const tx = TransactionBuilder.fromXDR(xdrStr, config.networkPassphrase);
      tx.sign(kp);
      return tx.toXDR();
    },
  };
}

function rpcServer(): rpc.Server {
  return new rpc.Server(config.rpcUrl, { allowHttp: true });
}

export async function requireAccountOnNetwork(publicKey: string): Promise<void> {
  const server = rpcServer();
  try {
    await server.getAccount(publicKey);
  } catch {
    throw new Error(
      `Account ${publicKey} not found on testnet — fund it at https://lab.stellar.org/account/create then retry`
    );
  }
}

async function loadAccount(publicKey: string): Promise<Account> {
  await requireAccountOnNetwork(publicKey);
  return rpcServer().getAccount(publicKey);
}

async function signAndSend(
  signer: Signer,
  build: (source: Account) => TransactionBuilder
): Promise<string> {
  const server = rpcServer();
  const source = await loadAccount(signer.publicKey);
  let tx = build(source).setTimeout(180).build();
  tx = await server.prepareTransaction(tx);
  const signedXdr = await signer.signTransaction(tx.toXDR());
  tx = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase) as Transaction;

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

export async function getVaultLeafCount(reader: string, poolId = 0): Promise<number> {
  const server = rpcServer();
  const contract = new Contract(requireVaultId());
  const source = await loadAccount(reader);
  const tx = new TransactionBuilder(source, {
    fee: "100",
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      contract.call(
        "pool_leaf_count",
        nativeToScVal(poolId, { type: "u32" })
      )
    )
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) return 0;
  return Number(scValToNative(sim.result.retval));
}

export async function getVaultMerkleRoot(reader: string, poolId = 0): Promise<string> {
  const server = rpcServer();
  const contract = new Contract(requireVaultId());
  const source = await loadAccount(reader);
  const tx = new TransactionBuilder(source, {
    fee: "100",
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      contract.call("get_pool_root", nativeToScVal(poolId, { type: "u32" }))
    )
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) {
    throw new Error("get_root simulation failed");
  }
  const bytes = scValToNative(sim.result.retval) as Buffer;
  return "0x" + Buffer.from(bytes).toString("hex").padStart(64, "0");
}

async function waitLeafIncrease(
  before: number,
  reader: string,
  poolId = 0
): Promise<number> {
  for (let i = 0; i < 10; i++) {
    const count = await getVaultLeafCount(reader, poolId);
    if (count > before) return count;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return getVaultLeafCount(reader, poolId);
}

export async function joinPool(params: {
  signer: Signer;
  poolId: number;
  commitmentHex: string;
}): Promise<{ txHash: string; leafIndex: number }> {
  const before = await getVaultLeafCount(params.signer.publicKey, params.poolId).catch(
    () => 0
  );
  const txHash = await signAndSend(params.signer, (source) => {
    const contract = new Contract(requireVaultId());
    const from = new Address(params.signer.publicKey);
    return new TransactionBuilder(source, {
      fee: "1000000",
      networkPassphrase: config.networkPassphrase,
    }).addOperation(
      contract.call(
        "join_pool",
        from.toScVal(),
        nativeToScVal(params.poolId, { type: "u32" }),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.commitmentHex)))
      )
    );
  });
  const after = await waitLeafIncrease(
    before,
    params.signer.publicKey,
    params.poolId
  );
  return { txHash, leafIndex: Math.max(0, after - 1) };
}

export async function exitPool(params: {
  signer: Signer;
  poolId: number;
  recipient: string;
  relayer: string;
  relayerFeeStroops: number;
  nullifierHexes: string[];
  merkleRootHex: string;
  publicInputs: Uint8Array;
  proofBytes: Uint8Array;
}): Promise<string> {
  const padHex = (hexes: string[]) => {
    const out = [...hexes];
    while (out.length < 4) out.push("0x0");
    return out.slice(0, 4);
  };
  const nullifiers = padHex(params.nullifierHexes);
  const recipient = new Address(params.recipient);
  const relayer = new Address(params.relayer);
  return signAndSend(params.signer, (source) => {
    const contract = new Contract(requireVaultId());
    return new TransactionBuilder(source, {
      fee: "1000000",
      networkPassphrase: config.networkPassphrase,
    }).addOperation(
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
        xdr.ScVal.scvBytes(Buffer.from(params.publicInputs)),
        xdr.ScVal.scvBytes(Buffer.from(params.proofBytes)),
        nativeToScVal(params.relayerFeeStroops, { type: "u32" })
      )
    );
  });
}

export async function deposit(params: {
  signer: Signer;
  amountStroops: bigint;
  commitmentHex: string;
}): Promise<{ txHash: string; leafIndex: number }> {
  const before = await getVaultLeafCount(params.signer.publicKey).catch(() => 0);
  const txHash = await signAndSend(params.signer, (source) => {
    const contract = new Contract(requireVaultId());
    const from = new Address(params.signer.publicKey);
    return new TransactionBuilder(source, {
      fee: "1000000",
      networkPassphrase: config.networkPassphrase,
    }).addOperation(
      contract.call(
        "deposit",
        from.toScVal(),
        nativeToScVal(params.amountStroops, { type: "i128" }),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.commitmentHex)))
      )
    );
  });
  const after = await waitLeafIncrease(before, params.signer.publicKey);
  return { txHash, leafIndex: Math.max(0, after - 1) };
}

export async function withdraw(params: {
  signer: Signer;
  recipient: string;
  amountStroops: bigint;
  nullifierHex: string;
  merkleRootHex: string;
  publicInputs: Uint8Array;
  proofBytes: Uint8Array;
}): Promise<string> {
  return signAndSend(params.signer, (source) => {
    const contract = new Contract(requireVaultId());
    const to = new Address(params.recipient);
    return new TransactionBuilder(source, {
      fee: "1000000",
      networkPassphrase: config.networkPassphrase,
    }).addOperation(
      contract.call(
        "withdraw",
        to.toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.nullifierHex))),
        nativeToScVal(params.amountStroops, { type: "i128" }),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.merkleRootHex))),
        xdr.ScVal.scvBytes(Buffer.from(params.publicInputs)),
        xdr.ScVal.scvBytes(Buffer.from(params.proofBytes))
      )
    );
  });
}

export async function waitForTx(hash: string, maxWaitMs = 60_000): Promise<void> {
  const server = rpcServer();
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const tx = await server.getTransaction(hash);
    if (tx.status === rpc.Api.GetTransactionStatus.SUCCESS) return;
    if (tx.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Tx ${hash} failed on-chain`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Tx ${hash} not confirmed in time`);
}
