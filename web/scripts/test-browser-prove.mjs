import { Noir } from "@noir-lang/noir_js";
import { UltraHonkBackend } from "@aztec/bb.js";
import { readFileSync } from "node:fs";

const PROOF_BYTES = 456 * 32;
const circuit = JSON.parse(
  readFileSync("../circuits/transfer_actions/target/transfer_actions.json", "utf8")
);
const inputs = JSON.parse(
  readFileSync("../scripts/fixtures/transfer_actions_1x1.json", "utf8")
);

const noir = new Noir(circuit);
const { witness } = await noir.execute(inputs);
console.log("witness bytes", witness.length);

const backend = new UltraHonkBackend(circuit.bytecode, { threads: 1 });
const { proof, publicInputs } = await backend.generateProof(witness, {
  keccak: true,
});
console.log("proof bytes", proof.length, "expected", PROOF_BYTES);
console.log("public inputs", publicInputs.length, "expected", 10);
const valid = await backend.verifyProof({ proof, publicInputs }, { keccak: true });
console.log("local verify", valid);
await backend.destroy();
