import { Noir } from "@noir-lang/noir_js";
import type { CompiledCircuit } from "@noir-lang/types";

const BN254_MOD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

let wasmInit: Promise<void> | null = null;
let noir: Noir | null = null;

function fieldToHex(value: string): string {
  const n = BigInt(value.startsWith("0x") ? value : `0x${value}`) % BN254_MOD;
  return "0x" + n.toString(16).padStart(64, "0");
}

function assetUrl(path: string): string {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }
  return path;
}

async function ensureWasm(): Promise<void> {
  if (!wasmInit) {
    wasmInit = (async () => {
      const initAbi = (await import("@noir-lang/noirc_abi")).default;
      const initACVM = (await import("@noir-lang/acvm_js")).default;
      const [abiRes, acvmRes] = await Promise.all([
        fetch(assetUrl("wasm/noirc_abi_wasm_bg.wasm")),
        fetch(assetUrl("wasm/acvm_js_bg.wasm")),
      ]);
      if (!abiRes.ok || !acvmRes.ok) {
        throw new Error("Missing Noir WASM — run npm run sync:assets in extension/");
      }
      await Promise.all([
        initAbi(await abiRes.arrayBuffer()),
        initACVM(await acvmRes.arrayBuffer()),
      ]);
    })();
  }
  await wasmInit;
}

async function getNoir(): Promise<Noir> {
  if (noir) return noir;
  await ensureWasm();
  const res = await fetch(assetUrl("circuits/hash_pair.json"));
  if (!res.ok) throw new Error("Missing hash_pair circuit");
  const circuit = (await res.json()) as CompiledCircuit;
  noir = new Noir(circuit);
  return noir;
}

/** Poseidon2 pair hash — decimal field strings in, decimal out. */
export async function hashPair(left: string, right: string): Promise<string> {
  const instance = await getNoir();
  const { returnValue } = await instance.execute({ left, right });
  if (typeof returnValue !== "string") {
    throw new Error("Unexpected hash_pair return type");
  }
  const hex = fieldToHex(returnValue);
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  return BigInt(`0x${body}`).toString();
}
