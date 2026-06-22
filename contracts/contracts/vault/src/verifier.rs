use soroban_sdk::{Address, Bytes, BytesN, Env, IntoVal, Symbol, Val, Vec};

/// BN254 public inputs for `transfer_actions` (10 x 32 bytes).
pub const PUBLIC_INPUTS_LEN: u32 = 320;
pub const MAX_ACTION_SLOTS: usize = 4;

/// Layout: merkle_root | nullifier[4] | new_commitment[4] | public_amount
pub fn encode_public_inputs(
    env: &Env,
    merkle_root: &BytesN<32>,
    nullifiers: &[BytesN<32>; MAX_ACTION_SLOTS],
    new_commitments: &[BytesN<32>; MAX_ACTION_SLOTS],
    public_amount: &BytesN<32>,
) -> Bytes {
    let mut out = Bytes::new(env);
    out.extend_from_slice(&merkle_root.to_array());
    for nf in nullifiers {
        out.extend_from_slice(&nf.to_array());
    }
    for nc in new_commitments {
        out.extend_from_slice(&nc.to_array());
    }
    out.extend_from_slice(&public_amount.to_array());
    out
}

pub fn verify_transfer_proof(
    env: &Env,
    verifier: &Address,
    public_inputs: &Bytes,
    proof_bytes: &Bytes,
) {
    assert_eq!(
        public_inputs.len(),
        PUBLIC_INPUTS_LEN,
        "public_inputs must be 10 fields"
    );
    let verify = Symbol::new(env, "verify_proof");
    let mut args: Vec<Val> = Vec::new(env);
    args.push_back(public_inputs.into_val(env));
    args.push_back(proof_bytes.into_val(env));
    let _: () = env.invoke_contract(verifier, &verify, args);
}

fn is_zero_bytes(bytes: &BytesN<32>) -> bool {
    bytes.to_array().iter().all(|b| *b == 0)
}

pub fn mark_nullifier_spent(env: &Env, nullifier: &BytesN<32>) {
    if is_zero_bytes(nullifier) {
        return;
    }
    let spent: bool = env
        .storage()
        .persistent()
        .get(&super::storage::DataKey::Nullifier(nullifier.clone()))
        .unwrap_or(false);
    assert!(!spent, "nullifier spent");
    env.storage()
        .persistent()
        .set(&super::storage::DataKey::Nullifier(nullifier.clone()), &true);
}
