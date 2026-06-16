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

export async function ensureFunded(publicKey: string): Promise<void> {
  const server = rpcServer();
  try {
    await server.getAccount(publicKey);
    return;
  } catch {
    /* fund below */
  }

  if (process.env.E2E_SKIP_FUND === "true") {
    throw new Error(
      `Account ${publicKey} not on-chain — fund it first or remove E2E_SKIP_FUND`
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(
      `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`,
      { signal: controller.signal }
    );
    const text = await res.text();
    if (!res.ok && !text.toLowerCase().includes("already funded")) {
      throw new Error(`Friendbot ${res.status}: ${text.slice(0, 120)}`);
    }
  } catch (err) {
    clearTimeout(timer);
    const hint =
      err instanceof Error && err.name === "AbortError"
        ? "Friendbot timed out"
        : String(err);
    throw new Error(
      `${hint}. Fund ${publicKey} manually (lab.stellar.org) or set STELLAR_SECRET to an already-funded key.`
    );
  }
  clearTimeout(timer);

  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await server.getAccount(publicKey);
      return;
    } catch {
      /* retry */
    }
  }
  throw new Error(`Account ${publicKey} not visible after Friendbot`);
}

async function loadAccount(publicKey: string): Promise<Account> {
  await ensureFunded(publicKey);
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

export async function shieldedSend(params: {
  signer: Signer;
  nullifierHex: string;
  newCommitmentHex: string;
  merkleRootHex: string;
  publicInputs: Uint8Array;
  proofBytes: Uint8Array;
}): Promise<string> {
  const args = [
    xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.nullifierHex))),
    xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.newCommitmentHex))),
    xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.merkleRootHex))),
    xdr.ScVal.scvBytes(Buffer.from(params.publicInputs)),
    xdr.ScVal.scvBytes(Buffer.from(params.proofBytes)),
  ];
  return signAndSend(params.signer, (source) => {
    const contract = new Contract(requireVaultId());
    return new TransactionBuilder(source, {
      fee: "1000000",
      networkPassphrase: config.networkPassphrase,
    }).addOperation(contract.call("shielded_send", ...args));
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
