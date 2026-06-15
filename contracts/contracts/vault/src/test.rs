#![cfg(test)]

use super::*;
use merkle::MerkleTree;
use soroban_sdk::{contract, contractimpl, crypto::bn254::Bn254Fr, testutils::Address as _, token, Address, Bytes, BytesN, Env, U256};

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

#[test]
fn hash_pair_matches_noir_fixture() {
    let env = Env::default();
    use soroban_poseidon::poseidon2_hash;
    let left = Bn254Fr::from_u256(U256::from_u32(&env, 1));
    let right = Bn254Fr::from_u256(U256::from_u32(&env, 2));
    let inputs = soroban_sdk::vec![&env, left.to_u256(), right.to_u256()];
    let hash_t4 = Bn254Fr::from_u256(poseidon2_hash::<4, Bn254Fr>(&env, &inputs));
    let contract = merkle::hash_pair(&env, &left, &right);
    let expected = BytesN::from_array(
        &env,
        &[
            0x03, 0x86, 0x82, 0xaa, 0x1c, 0xb5, 0xae, 0x4e, 0x0a, 0x3f, 0x13, 0xda, 0x43, 0x2a,
            0x95, 0xc7, 0x7c, 0x5c, 0x11, 0x1f, 0x6f, 0x03, 0x0f, 0xaf, 0x9c, 0xad, 0x64, 0x1c,
            0xe1, 0xed, 0x73, 0x83,
        ],
    );
    assert_eq!(hash_t4.to_bytes(), expected);
    assert_eq!(contract.to_bytes(), expected);
}
