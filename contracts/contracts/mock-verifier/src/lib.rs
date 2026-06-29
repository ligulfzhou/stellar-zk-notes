#![no_std]

use soroban_sdk::{contract, contractimpl, Bytes, Env};

/// Always-accept verifier for hackathon demos without Barretenberg / UltraHonk deploy.
#[contract]
pub struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    pub fn verify_proof(_env: Env, _public_inputs: Bytes, _proof_bytes: Bytes) {}
}
