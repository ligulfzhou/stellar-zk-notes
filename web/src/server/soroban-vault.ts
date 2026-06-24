import {
  Contract,
  TransactionBuilder,
  Address,
  nativeToScVal,
  Networks,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import { STELLAR_NETWORK, VAULT_CONTRACT_ID } from "@/lib/config";
import { loadStellarAccount, sorobanRpc } from "@/server/soroban-rpc";

function bytesToHex(bytes: Buffer | Uint8Array): string {
  return "0x" + Buffer.from(bytes).toString("hex").padStart(64, "0");
}

function networkPassphrase(): string {
  return STELLAR_NETWORK.toLowerCase() === "mainnet"
    ? Networks.PUBLIC
    : Networks.TESTNET;
}

function requireVaultId(): string {
  if (!VAULT_CONTRACT_ID) {
    throw new Error("Set NEXT_PUBLIC_VAULT_CONTRACT_ID in web/.env.local");
  }
  return VAULT_CONTRACT_ID;
}

async function simulateVaultCall(
  sourcePublicKey: string,
  build: (contract: Contract, source: Awaited<ReturnType<typeof loadStellarAccount>>) => TransactionBuilder
) {
  const server = sorobanRpc();
  const contract = new Contract(requireVaultId());
  const source = await loadStellarAccount(sourcePublicKey);
  const tx = build(contract, source).setTimeout(30).build();
  return server.simulateTransaction(tx);
}

export async function getVaultLeafCount(
  sourcePublicKey: string,
  poolId = 0
): Promise<number> {
  const sim = await simulateVaultCall(sourcePublicKey, (contract, source) =>
    new TransactionBuilder(source, {
      fee: "100",
      networkPassphrase: networkPassphrase(),
    }).addOperation(
      contract.call("pool_leaf_count", nativeToScVal(poolId, { type: "u32" }))
    )
  );
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) {
    return 0;
  }
  return Number(scValToNative(sim.result.retval));
}

export async function getVaultMerkleRoot(
  sourcePublicKey: string,
  poolId = 0
): Promise<string> {
  const sim = await simulateVaultCall(sourcePublicKey, (contract, source) =>
    new TransactionBuilder(source, {
      fee: "100",
      networkPassphrase: networkPassphrase(),
    }).addOperation(
      contract.call("get_pool_root", nativeToScVal(poolId, { type: "u32" }))
    )
  );
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) {
    throw new Error("Could not read vault merkle root");
  }
  const bytes = scValToNative(sim.result.retval) as Buffer;
  return "0x" + Buffer.from(bytes).toString("hex").padStart(64, "0");
}

export async function getVaultFilledAtLevel(
  sourcePublicKey: string,
  level: number,
  poolId = 0
): Promise<string | null> {
  const sim = await simulateVaultCall(sourcePublicKey, (contract, source) =>
    new TransactionBuilder(source, {
      fee: "100",
      networkPassphrase: networkPassphrase(),
    }).addOperation(
      contract.call(
        "get_filled_at_level",
        nativeToScVal(poolId, { type: "u32" }),
        nativeToScVal(level, { type: "u32" })
      )
    )
  );
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) {
    return null;
  }
  const bytes = scValToNative(sim.result.retval) as Buffer;
  return "0x" + Buffer.from(bytes).toString("hex").padStart(64, "0");
}

export async function getVaultZeroAtLevel(
  sourcePublicKey: string,
  level: number,
  poolId = 0
): Promise<string | null> {
  const sim = await simulateVaultCall(sourcePublicKey, (contract, source) =>
    new TransactionBuilder(source, {
      fee: "100",
      networkPassphrase: networkPassphrase(),
    }).addOperation(
      contract.call(
        "get_zero_at_level",
        nativeToScVal(poolId, { type: "u32" }),
        nativeToScVal(level, { type: "u32" })
      )
    )
  );
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) {
    return null;
  }
  const bytes = scValToNative(sim.result.retval) as Buffer;
  return "0x" + Buffer.from(bytes).toString("hex").padStart(64, "0");
}

export async function getVaultCommitmentAt(
  sourcePublicKey: string,
  poolId: number,
  leafIndex: number
): Promise<string | null> {
  const sim = await simulateVaultCall(sourcePublicKey, (contract, source) =>
    new TransactionBuilder(source, {
      fee: "100",
      networkPassphrase: networkPassphrase(),
    }).addOperation(
      contract.call(
        "get_commitment_at",
        nativeToScVal(poolId, { type: "u32" }),
        nativeToScVal(leafIndex, { type: "u32" })
      )
    )
  );
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) {
    return null;
  }
  const native = scValToNative(sim.result.retval);
  if (!native) return null;
  const bytes = native as Buffer;
  return "0x" + Buffer.from(bytes).toString("hex").padStart(64, "0");
}

export type VaultTreeState = {
  filled: string[];
  zeros: string[];
};

type MerkleTreeStorage = {
  filled: Buffer[];
  zeros: Buffer[];
};

async function readVaultMerkleTreeFromLedger(): Promise<MerkleTreeStorage | null> {
  const server = sorobanRpc();
  const contractId = requireVaultId();
  const response = await server.getLedgerEntries(new Contract(contractId).getFootprint());
  const entry = response.entries[0]?.val;
  if (!entry || entry.switch().name !== "contractData") return null;

  const storage = entry.contractData().val().instance().storage() as Array<{
    key: () => { vec: () => Array<{ sym: () => Buffer }> };
    val: () => unknown;
  }>;

  for (const item of storage) {
    const keySym = item.key().vec()[0].sym().toString();
    if (keySym !== "MerkleTree") continue;
    const tree = scValToNative(item.val() as Parameters<typeof scValToNative>[0]) as MerkleTreeStorage;
    return tree;
  }
  return null;
}

export async function readVaultTreeState(
  sourcePublicKey: string,
  poolId = 0,
  height = 16
): Promise<VaultTreeState | null> {
  const filled: string[] = [];
  const zeros: string[] = [];
  let usedContractFns = true;

  for (let level = 0; level < height; level++) {
    const f = await getVaultFilledAtLevel(sourcePublicKey, level, poolId);
    const z = await getVaultZeroAtLevel(sourcePublicKey, level, poolId);
    if (!f || !z) {
      usedContractFns = false;
      break;
    }
    filled.push(f);
    zeros.push(z);
  }

  if (usedContractFns && filled.length === height) {
    return { filled, zeros };
  }

  const tree = await readVaultMerkleTreeFromLedger();
  if (!tree) return null;

  return {
    filled: tree.filled.map(bytesToHex),
    zeros: tree.zeros.map(bytesToHex),
  };
}
