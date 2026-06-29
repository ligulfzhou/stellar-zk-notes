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
      `Account ${publicKey} not found on testnet — fund it at https://lab.stellar.org/account/create`
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

  for (let attempt = 0; attempt < 4; attempt++) {
    const source = await loadAccount(signer.publicKey);
    let tx = build(source).setTimeout(180).build();
    tx = await server.prepareTransaction(tx);
    const signedXdr = await signer.signTransaction(tx.toXDR());
    tx = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase) as Transaction;

    for (let sendAttempt = 0; sendAttempt < 4; sendAttempt++) {
      const result = await server.sendTransaction(tx);
      if (result.status === "PENDING" || result.status === "DUPLICATE") {
        return result.hash;
      }
      if (result.status === "TRY_AGAIN_LATER") {
        await new Promise((r) => setTimeout(r, 1000 * (sendAttempt + 1)));
        continue;
      }
      if (result.status === "ERROR") {
        const err = JSON.stringify(result.errorResult ?? result);
        if (err.includes("txBadSeq") && attempt < 3) {
          break;
        }
        throw new Error(`send failed: ${JSON.stringify(result)}`);
      }
      throw new Error(`send failed: ${JSON.stringify(result)}`);
    }
  }
  throw new Error("send failed: network busy");
}

function padNullifiers(hexes: string[]): string[] {
  const out = [...hexes];
  while (out.length < 4) out.push("0x0");
  return out.slice(0, 4);
}

export async function getVaultLeafCount(reader: string): Promise<number> {
  const server = rpcServer();
  const contract = new Contract(requireVaultId());
  const source = await loadAccount(reader);
  const tx = new TransactionBuilder(source, {
    fee: "100",
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call("leaf_count"))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) return 0;
  return Number(scValToNative(sim.result.retval));
}

export async function getVaultMerkleRoot(reader: string): Promise<string> {
  const server = rpcServer();
  const contract = new Contract(requireVaultId());
  const source = await loadAccount(reader);
  const tx = new TransactionBuilder(source, {
    fee: "100",
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call("get_root"))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) {
    throw new Error("get_root simulation failed");
  }
  const bytes = scValToNative(sim.result.retval) as Buffer;
  return "0x" + Buffer.from(bytes).toString("hex").padStart(64, "0");
}

async function waitLeafIncrease(before: number, reader: string): Promise<number> {
  for (let i = 0; i < 10; i++) {
    const count = await getVaultLeafCount(reader);
    if (count > before) return count;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return getVaultLeafCount(reader);
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
  nullifierHexes: string[];
  merkleRootHex: string;
  publicInputs: Uint8Array;
  proofBytes: Uint8Array;
}): Promise<string> {
  const nullifiers = padNullifiers(params.nullifierHexes);
  const recipient = new Address(params.recipient);
  return signAndSend(params.signer, (source) => {
    const contract = new Contract(requireVaultId());
    return new TransactionBuilder(source, {
      fee: "1000000",
      networkPassphrase: config.networkPassphrase,
    }).addOperation(
      contract.call(
        "withdraw",
        recipient.toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(nullifiers[0]!))),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(nullifiers[1]!))),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(nullifiers[2]!))),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(nullifiers[3]!))),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.merkleRootHex))),
        xdr.ScVal.scvBytes(Buffer.from(params.publicInputs)),
        xdr.ScVal.scvBytes(Buffer.from(params.proofBytes))
      )
    );
  });
}

function padCommitments(hexes: string[]): string[] {
  const out = [...hexes];
  while (out.length < 4) out.push("0x0");
  return out.slice(0, 4);
}

export async function shieldedTransfer(params: {
  signer: Signer;
  nullifierHexes: string[];
  newCommitmentHexes: string[];
  merkleRootHex: string;
  publicInputs: Uint8Array;
  proofBytes: Uint8Array;
  epkHexes: string[];
  encryptedNotes: Uint8Array[];
}): Promise<string> {
  const nullifiers = padNullifiers(params.nullifierHexes);
  const commitments = padCommitments(params.newCommitmentHexes);
  const epks = [...params.epkHexes];
  const notes = [...params.encryptedNotes];
  while (epks.length < 4) epks.push("0x" + "00".repeat(32));
  while (notes.length < 4) notes.push(new Uint8Array(0));

  return signAndSend(params.signer, (source) => {
    const contract = new Contract(requireVaultId());
    const builder = new TransactionBuilder(source, {
      fee: "1000000",
      networkPassphrase: config.networkPassphrase,
    });
    const args: xdr.ScVal[] = [
      ...nullifiers.map((n) => xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(n)))),
      ...commitments.map((c) => xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(c)))),
      xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.merkleRootHex))),
      xdr.ScVal.scvBytes(Buffer.from(params.publicInputs)),
      xdr.ScVal.scvBytes(Buffer.from(params.proofBytes)),
    ];
    for (let i = 0; i < 4; i++) {
      args.push(xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(epks[i]!))));
      args.push(xdr.ScVal.scvBytes(Buffer.from(notes[i]!)));
    }
    return builder.addOperation(contract.call("shielded_transfer", ...args));
  });
}

export async function getVaultCommitmentAt(
  reader: string,
  leafIndex: number
): Promise<string | null> {
  const server = rpcServer();
  const contract = new Contract(requireVaultId());
  const source = await loadAccount(reader);
  const tx = new TransactionBuilder(source, {
    fee: "100",
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      contract.call("get_commitment_at", nativeToScVal(leafIndex, { type: "u32" }))
    )
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) {
    return null;
  }
  const native = scValToNative(sim.result.retval);
  if (!native) return null;
  const bytes = native as Buffer;
  return "0x" + Buffer.from(bytes).toString("hex").padStart(64, "0");
}

export async function fetchDenseCommitments(reader: string): Promise<{
  commitments: string[];
  leafCount: number;
  merkleRoot: string;
}> {
  const leafCount = await getVaultLeafCount(reader);
  const commitments: string[] = [];
  for (let i = 0; i < leafCount; i++) {
    const c = await getVaultCommitmentAt(reader, i);
    if (!c) throw new Error(`Missing commitment at leaf ${i}`);
    commitments.push(c);
  }
  const merkleRoot = await getVaultMerkleRoot(reader);
  return { commitments, leafCount, merkleRoot };
}

export async function exitViaRelayer(params: {
  relayer: Signer;
  recipient: string;
  nullifierHexes: string[];
  merkleRootHex: string;
  publicInputs: Uint8Array;
  proofBytes: Uint8Array;
}): Promise<string> {
  const nullifiers = padNullifiers(params.nullifierHexes);
  const recipient = new Address(params.recipient);
  const relayer = new Address(params.relayer.publicKey);
  return signAndSend(params.relayer, (source) => {
    const contract = new Contract(requireVaultId());
    return new TransactionBuilder(source, {
      fee: "1000000",
      networkPassphrase: config.networkPassphrase,
    }).addOperation(
      contract.call(
        "exit_via_relayer",
        recipient.toScVal(),
        relayer.toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(nullifiers[0]!))),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(nullifiers[1]!))),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(nullifiers[2]!))),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(nullifiers[3]!))),
        xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.merkleRootHex))),
        xdr.ScVal.scvBytes(Buffer.from(params.publicInputs)),
        xdr.ScVal.scvBytes(Buffer.from(params.proofBytes))
      )
    );
  });
}

export async function waitForTx(hash: string, maxWaitMs = 90_000): Promise<void> {
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

/** Fail fast if web/.env.local points at a legacy pool vault. */
export async function assertUtxoVault(reader: string): Promise<void> {
  const server = rpcServer();
  const contract = new Contract(requireVaultId());
  const source = await loadAccount(reader);
  const tx = new TransactionBuilder(source, {
    fee: "100",
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call("leaf_count"))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    const err = JSON.stringify(sim.error);
    if (err.includes("leaf_count") || err.includes("InvalidAction")) {
      throw new Error(
        "Vault contract is not zk-utxo (missing leaf_count) — run ./scripts/deploy_testnet.sh and update web/.env.local"
      );
    }
    throw new Error(`Vault simulation failed: ${err}`);
  }
}
