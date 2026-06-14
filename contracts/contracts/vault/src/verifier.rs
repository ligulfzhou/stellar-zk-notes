use soroban_sdk::{Address, Bytes, BytesN, Env, IntoVal, Symbol, Val, Vec};

/// Concatenate BN254 public inputs for the `spend_note` circuit (5 × 32 bytes).
pub fn encode_public_inputs(
    env: &Env,
    merkle_root: &BytesN<32>,
    nullifier: &BytesN<32>,
    new_commitment: &BytesN<32>,
    public_amount: &BytesN<32>,
    mode: &BytesN<32>,
) -> Bytes {
    let mut out = Bytes::new(env);
    out.extend_from_slice(&merkle_root.to_array());
    out.extend_from_slice(&nullifier.to_array());
    out.extend_from_slice(&new_commitment.to_array());
    out.extend_from_slice(&public_amount.to_array());
    out.extend_from_slice(&mode.to_array());
    out
}

/// Invoke the deployed UltraHonk verifier contract.
pub fn verify_spend_proof(
    env: &Env,
    verifier: &Address,
    public_inputs: &Bytes,
    proof_bytes: &Bytes,
) {
    let verify = Symbol::new(env, "verify_proof");
    let mut args: Vec<Val> = Vec::new(env);
    args.push_back(public_inputs.into_val(env));
    args.push_back(proof_bytes.into_val(env));
    let _: () = env.invoke_contract(verifier, &verify, args);
}
