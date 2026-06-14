import {
  Account,
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { fieldDecToBytes32, fieldHexToBytes32 } from "./field";
import { SOROBAN_RPC_URL, STELLAR_NETWORK, VAULT_CONTRACT_ID } from "./config";

function networkPassphrase(): string {
  return STELLAR_NETWORK === "mainnet"
    ? Networks.PUBLIC
    : Networks.TESTNET;
}

function requireVaultId(): string {
  if (!VAULT_CONTRACT_ID) {
    throw new Error("Set NEXT_PUBLIC_VAULT_CONTRACT_ID in web/.env.local");
  }
  return VAULT_CONTRACT_ID;
}

function rpcServer(): rpc.Server {
  return new rpc.Server(SOROBAN_RPC_URL, {
    allowHttp: STELLAR_NETWORK !== "mainnet",
  });
}

async function signAndSend(
  sourcePublicKey: string,
  build: (source: Account) => Promise<TransactionBuilder>,
  signTransaction: (xdr: string) => Promise<string>
): Promise<string> {
  const server = rpcServer();
  const source = await server.getAccount(sourcePublicKey);
  let builder = await build(source);
  let tx = builder.setTimeout(180).build();
  tx = await server.prepareTransaction(tx);
  const signed = await signTransaction(tx.toXDR());
  const signedTx = TransactionBuilder.fromXDR(signed, networkPassphrase());
  const result = await server.sendTransaction(signedTx);
  if (result.status !== "PENDING") {
    throw new Error(`Transaction failed: ${result.status}`);
  }
  return result.hash;
}

export async function getVaultLeafCount(
  sourcePublicKey: string
): Promise<number> {
  const server = rpcServer();
  const contract = new Contract(requireVaultId());
  const source = await server.getAccount(sourcePublicKey);

  const tx = new TransactionBuilder(source, {
    fee: "100",
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(contract.call("leaf_count"))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) {
    return 0;
  }
  return Number(scValToNative(sim.result.retval));
}

export async function depositToVault(params: {
  sourcePublicKey: string;
  signTransaction: (xdr: string) => Promise<string>;
  amountStroops: bigint;
  commitmentHex: string;
}): Promise<{ txHash: string; leafIndex: number }> {
  const before = await getVaultLeafCount(params.sourcePublicKey).catch(() => 0);
  const txHash = await signAndSend(
    params.sourcePublicKey,
    async (source) => {
      const contract = new Contract(requireVaultId());
      const commitmentBytes = fieldHexToBytes32(params.commitmentHex);
      const from = new Address(params.sourcePublicKey);
      return new TransactionBuilder(source, {
        fee: "100000",
        networkPassphrase: networkPassphrase(),
      }).addOperation(
        contract.call(
          "deposit",
          from.toScVal(),
          nativeToScVal(params.amountStroops, { type: "i128" }),
          xdr.ScVal.scvBytes(Buffer.from(commitmentBytes))
        )
      );
    },
    params.signTransaction
  );
  const after = await getVaultLeafCount(params.sourcePublicKey).catch(
    () => before + 1
  );
  return { txHash, leafIndex: Math.max(0, after - 1) };
}

export function encodePublicInputs(params: {
  merkleRootHex: string;
  nullifierHex: string;
  newCommitmentHex: string;
  publicAmount: string;
  mode: string;
}): Uint8Array {
  const chunks = [
    fieldHexToBytes32(params.merkleRootHex),
    fieldHexToBytes32(params.nullifierHex),
    fieldHexToBytes32(params.newCommitmentHex),
    fieldDecToBytes32(params.publicAmount),
    fieldDecToBytes32(params.mode),
  ];
  const out = new Uint8Array(160);
  chunks.forEach((chunk, i) => out.set(chunk, i * 32));
  return out;
}

export async function shieldedSendToVault(params: {
  sourcePublicKey: string;
  signTransaction: (xdr: string) => Promise<string>;
  nullifierHex: string;
  newCommitmentHex: string;
  merkleRootHex: string;
  publicInputs: Uint8Array;
  proofBytes: Uint8Array;
  epkBytes?: Uint8Array;
  encryptedNoteBytes?: Uint8Array;
}): Promise<string> {
  const epk = params.epkBytes ?? new Uint8Array(32);
  const encrypted = params.encryptedNoteBytes ?? new Uint8Array();
  return signAndSend(
    params.sourcePublicKey,
    async (source) => {
      const contract = new Contract(requireVaultId());
      return new TransactionBuilder(source, {
        fee: "1000000",
        networkPassphrase: networkPassphrase(),
      }).addOperation(
        contract.call(
          "shielded_send",
          xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.nullifierHex))),
          xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.newCommitmentHex))),
          xdr.ScVal.scvBytes(Buffer.from(fieldHexToBytes32(params.merkleRootHex))),
          xdr.ScVal.scvBytes(Buffer.from(params.publicInputs)),
          xdr.ScVal.scvBytes(Buffer.from(params.proofBytes)),
          xdr.ScVal.scvBytes(Buffer.from(epk)),
          xdr.ScVal.scvBytes(Buffer.from(encrypted))
        )
      );
    },
    params.signTransaction
  );
}

export async function withdrawFromVault(params: {
  sourcePublicKey: string;
  signTransaction: (xdr: string) => Promise<string>;
  recipient: string;
  amountStroops: bigint;
  nullifierHex: string;
  merkleRootHex: string;
  publicInputs: Uint8Array;
  proofBytes: Uint8Array;
}): Promise<string> {
  return signAndSend(
    params.sourcePublicKey,
    async (source) => {
      const contract = new Contract(requireVaultId());
      const to = new Address(params.recipient);
      return new TransactionBuilder(source, {
        fee: "1000000",
        networkPassphrase: networkPassphrase(),
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
    },
    params.signTransaction
  );
}
