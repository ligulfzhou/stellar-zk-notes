#!/usr/bin/env npx tsx
/** Generate transfer_actions witness JSON fixtures (Phase A). */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "scripts", "fixtures");

type MerkleWitnessFn = (
  leaves: bigint[],
  targetIndex: number
) => Promise<{ path: bigint[]; indices: boolean[]; root: bigint }>;

function commit(value: string, secret: string, ns: string): bigint {
  const hex = execFileSync(path.join(root, "scripts", "compute_commitment.sh"), [
    value,
    secret,
    ns,
  ])
    .toString()
    .trim();
  return BigInt(hex.startsWith("0x") ? hex : `0x${hex}`);
}

function nullifier(ns: string, commitment: bigint): bigint {
  const hex = execFileSync(path.join(root, "scripts", "compute_nullifier.sh"), [
    ns,
    "0x" + commitment.toString(16).padStart(64, "0"),
  ])
    .toString()
    .trim();
  return BigInt(hex.startsWith("0x") ? hex : `0x${hex}`);
}

function dec(n: bigint): string {
  return n.toString();
}

function pathDec(pathFields: bigint[]): string[] {
  return pathFields.map((p) => dec(p));
}

function pad4(values: string[]): string[] {
  while (values.length < 4) values.push("0");
  return values.slice(0, 4);
}

async function build1x1(merkleWitness: MerkleWitnessFn) {
  const v = "1000";
  const s = "11";
  const ns = "22";
  const c = commit(v, s, ns);
  const nf = nullifier(ns, c);
  const outS = "33";
  const outNs = "44";
  const nc = commit(v, outS, outNs);
  const { path, indices, root } = await merkleWitness([c], 0);
  const emptyPath = Array(16).fill("0");
  const emptyIdx = Array(16).fill(false);

  return {
    spend_value: pad4([v]),
    spend_secret: pad4([s]),
    spend_nullifier_secret: pad4([ns]),
    spend_merkle_path: [pathDec(path), emptyPath, emptyPath, emptyPath],
    spend_path_indices: [indices, emptyIdx, emptyIdx, emptyIdx],
    out_value: pad4([v]),
    out_secret: pad4([outS]),
    out_nullifier_secret: pad4([outNs]),
    merkle_root: dec(root),
    nullifier: pad4([dec(nf)]),
    new_commitment: pad4([dec(nc)]),
    public_amount: "0",
  };
}

type MerkleRootFn = (leaves: bigint[]) => Promise<bigint>;

async function build4in2out(
  merkleWitness: MerkleWitnessFn,
  merkleRoot: MerkleRootFn
) {
  const notes = [
    { v: "100", s: "1", ns: "2" },
    { v: "200", s: "3", ns: "4" },
    { v: "150", s: "5", ns: "6" },
    { v: "50", s: "7", ns: "8" },
  ];
  const payee = "350";
  const change = "150";

  const cs = notes.map((n) => commit(n.v, n.s, n.ns));
  const nfs = notes.map((n, i) => nullifier(n.ns, cs[i]!));
  const paths: string[][] = [];
  const indices: boolean[][] = [];
  const root = await merkleRoot(cs);

  for (let i = 0; i < 4; i++) {
    const w = await merkleWitness(cs, i);
    paths.push(pathDec(w.path));
    indices.push(w.indices);
  }

  const out0s = "10";
  const out0ns = "11";
  const out1s = "12";
  const out1ns = "13";
  const nc0 = commit(payee, out0s, out0ns);
  const nc1 = commit(change, out1s, out1ns);

  return {
    spend_value: pad4(notes.map((n) => n.v)),
    spend_secret: pad4(notes.map((n) => n.s)),
    spend_nullifier_secret: pad4(notes.map((n) => n.ns)),
    spend_merkle_path: paths,
    spend_path_indices: indices,
    out_value: pad4([payee, change]),
    out_secret: pad4([out0s, out1s]),
    out_nullifier_secret: pad4([out0ns, out1ns]),
    merkle_root: dec(root),
    nullifier: pad4(nfs.map(dec)),
    new_commitment: pad4([dec(nc0), dec(nc1)]),
    public_amount: "0",
  };
}

async function main() {
  process.chdir(path.join(root, "web"));
  const { merkleWitness, merkleRoot } = await import("../web/src/server/merkle.ts");

  fs.mkdirSync(fixtures, { recursive: true });
  fs.writeFileSync(
    path.join(fixtures, "transfer_actions_1x1.json"),
    JSON.stringify(await build1x1(merkleWitness), null, 2)
  );
  fs.writeFileSync(
    path.join(fixtures, "transfer_actions_4in2out.json"),
    JSON.stringify(await build4in2out(merkleWitness, merkleRoot), null, 2)
  );
  console.log("Wrote fixtures to", fixtures);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
