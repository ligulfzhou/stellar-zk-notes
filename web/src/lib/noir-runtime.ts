import { Noir } from "@noir-lang/noir_js";
import type { CompiledCircuit } from "@noir-lang/types";

const BN254_MOD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export type NoirCircuitName =
  | "note_hash"
  | "hash_pair"
  | "transfer_actions"
  | "pool_actions"
  | "exit_hash";

let wasmInit: Promise<void> | null = null;
const circuitCache = new Map<string, CompiledCircuit>();
const noirCache = new Map<string, Noir>();

function fieldToHex(value: string): string {
  const n = BigInt(value.startsWith("0x") ? value : `0x${value}`) % BN254_MOD;
  return "0x" + n.toString(16).padStart(64, "0");
}

/** Initialize Noir ACVM + ABI WASM in the browser. No-op on server. */
export async function ensureBrowserWasm(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!wasmInit) {
    wasmInit = (async () => {
      const initAbi = (await import("@noir-lang/noirc_abi")).default;
      const initACVM = (await import("@noir-lang/acvm_js")).default;
      const [abiRes, acvmRes] = await Promise.all([
        fetch("/wasm/noirc_abi_wasm_bg.wasm"),
        fetch("/wasm/acvm_js_bg.wasm"),
      ]);
      if (!abiRes.ok || !acvmRes.ok) {
        throw new Error(
          "Failed to load Noir WASM — run npm install && npm run sync:circuits"
        );
      }
      await Promise.all([
        initAbi(await abiRes.arrayBuffer()),
        initACVM(await acvmRes.arrayBuffer()),
      ]);
    })();
  }
  await wasmInit;
}

async function loadCircuit(name: NoirCircuitName): Promise<CompiledCircuit> {
  const cached = circuitCache.get(name);
  if (cached) return cached;

  let circuit: CompiledCircuit;
  if (typeof window === "undefined") {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(
      process.cwd(),
      "..",
      "circuits",
      name,
      "target",
      `${name}.json`
    );
    circuit = JSON.parse(readFileSync(root, "utf8")) as CompiledCircuit;
  } else {
    const res = await fetch(`/circuits/${name}.json`);
    if (!res.ok) {
      throw new Error(`Missing circuit ${name}.json — run npm run sync:circuits`);
    }
    circuit = (await res.json()) as CompiledCircuit;
  }
  circuitCache.set(name, circuit);
  return circuit;
}

export async function loadSpendCircuit(): Promise<CompiledCircuit> {
  return loadCircuit("pool_actions");
}

async function getNoir(
  name: Exclude<NoirCircuitName, "transfer_actions" | "pool_actions">
): Promise<Noir> {
  const cached = noirCache.get(name);
  if (cached) return cached;
  await ensureBrowserWasm();
  const noir = new Noir(await loadCircuit(name));
  noirCache.set(name, noir);
  return noir;
}

/** Execute a Noir circuit and return the public field result as 0x-prefixed hex. */
export async function executeNoirField(
  circuit: Exclude<NoirCircuitName, "transfer_actions" | "pool_actions">,
  inputs: Record<string, string | string[]>
): Promise<string> {
  const noir = await getNoir(circuit);
  const { returnValue } = await noir.execute(inputs);
  if (typeof returnValue !== "string") {
    throw new Error(`Unexpected Noir return type from ${circuit}`);
  }
  return fieldToHex(returnValue);
}
