#![cfg(test)]

use super::*;
use soroban_sdk::{contract, contractimpl, testutils::Address as _, token, Address, Bytes, BytesN, Env};

#[contract]
struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    pub fn verify_proof(_env: Env, _public_inputs: Bytes, _proof_bytes: Bytes) {}
}

fn setup_vault(env: &Env) -> (Address, VaultClient<'static>, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token = token_contract.address();
    let verifier_id = env.register(MockVerifier, ());
    let vault_id = env.register(Vault, ());
    let client = VaultClient::new(env, &vault_id);
    client.initialize(&admin, &token, &verifier_id);

    let sac = token::StellarAssetClient::new(env, &token);
    sac.mint(&admin, &100_000_i128);

    (admin, client, token)
}

#[test]
fn merkle_insert_updates_root() {
    let env = Env::default();
    let mut tree = MerkleTree::empty(&env);
    let root_before = tree.root(&env);

    let leaf = Bn254Fr::from_bytes(BytesN::from_array(&env, &[1u8; 32]));
    tree.insert(&env, leaf);

    let root_after = tree.root(&env);
    assert_ne!(root_before, root_after);
    assert_eq!(tree.leaf_count, 1);
}

#[test]
fn deposit_increments_leaf_count() {
    let env = Env::default();
    let (admin, client, _) = setup_vault(&env);
    let commitment = BytesN::from_array(&env, &[3u8; 32]);

    client.deposit(&admin, &1_000_i128, &commitment);

    assert_eq!(client.leaf_count(), 1);
}

#[test]
fn shielded_send_records_nullifier_and_new_commitment() {
    let env = Env::default();
    let (admin, client, _) = setup_vault(&env);

    let deposit_commitment = BytesN::from_array(&env, &[3u8; 32]);
    client.deposit(&admin, &1_000_i128, &deposit_commitment);

    let root = client.get_root();
    let nullifier = BytesN::from_array(&env, &[7u8; 32]);
    let new_commitment = BytesN::from_array(&env, &[8u8; 32]);
    let zero = BytesN::from_array(&env, &[0u8; 32]);
    let mode = BytesN::from_array(&env, &[0u8; 32]);
    let public_inputs = client.build_public_inputs(&root, &nullifier, &new_commitment, &zero, &mode);
    let proof = Bytes::from_array(&env, &[1u8; 32]);

    let epk = BytesN::from_array(&env, &[0u8; 32]);
    let encrypted = Bytes::new(&env);

    client.shielded_send(
        &nullifier,
        &new_commitment,
        &root,
        &public_inputs,
        &proof,
        &epk,
        &encrypted,
    );

    assert!(client.is_spent(&nullifier));
    assert_eq!(client.leaf_count(), 2);
}
