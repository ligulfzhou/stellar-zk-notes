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

#[contract]
struct RejectVerifier;

#[contractimpl]
impl RejectVerifier {
    pub fn verify_proof(_env: Env, _public_inputs: Bytes, _proof_bytes: Bytes) {
        panic!("invalid proof");
    }
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

fn zero_bytes(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn transfer_public_inputs(
    env: &Env,
    client: &VaultClient,
    root: &BytesN<32>,
    nullifier: &BytesN<32>,
    new_commitment: &BytesN<32>,
) -> Bytes {
    let zero = zero_bytes(env);
    client.build_public_inputs(
        root,
        nullifier,
        &zero,
        &zero,
        &zero,
        new_commitment,
        &zero,
        &zero,
        &zero,
        &zero,
    )
}

fn encrypted_note(env: &Env) -> Bytes {
    Bytes::from_array(env, &[1u8; 16])
}

fn dummy_enc(env: &Env) -> Bytes {
    Bytes::from_array(env, &[0u8; 1])
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
fn shielded_transfer_records_nullifier_and_commitment() {
    let env = Env::default();
    let (admin, client, _) = setup_vault(&env);

    let deposit_commitment = BytesN::from_array(&env, &[3u8; 32]);
    client.deposit(&admin, &1_000_i128, &deposit_commitment);

    let root = client.get_root();
    let nullifier = BytesN::from_array(&env, &[7u8; 32]);
    let new_commitment = BytesN::from_array(&env, &[8u8; 32]);
    let zero = zero_bytes(&env);
    let public_inputs = transfer_public_inputs(&env, &client, &root, &nullifier, &new_commitment);
    let proof = Bytes::from_array(&env, &[1u8; 32]);
    let epk = zero_bytes(&env);
    let encrypted = encrypted_note(&env);
    let dummy = dummy_enc(&env);

    client.shielded_transfer(
        &nullifier,
        &zero,
        &zero,
        &zero,
        &new_commitment,
        &zero,
        &zero,
        &zero,
        &root,
        &public_inputs,
        &proof,
        &epk,
        &encrypted,
        &epk,
        &dummy,
        &epk,
        &dummy,
        &epk,
        &dummy,
    );

    assert!(client.is_spent(&nullifier));
    assert_eq!(client.leaf_count(), 2);
}

#[test]
fn shielded_transfer_2_outputs() {
    let env = Env::default();
    let (admin, client, _) = setup_vault(&env);

    let c0 = BytesN::from_array(&env, &[3u8; 32]);
    let c1 = BytesN::from_array(&env, &[4u8; 32]);
    client.deposit(&admin, &600_i128, &c0);
    client.deposit(&admin, &400_i128, &c1);

    let root = client.get_root();
    let nf0 = BytesN::from_array(&env, &[7u8; 32]);
    let nf1 = BytesN::from_array(&env, &[9u8; 32]);
    let out0 = BytesN::from_array(&env, &[8u8; 32]);
    let out1 = BytesN::from_array(&env, &[10u8; 32]);
    let zero = zero_bytes(&env);
    let public_inputs = client.build_public_inputs(
        &root,
        &nf0,
        &nf1,
        &zero,
        &zero,
        &out0,
        &out1,
        &zero,
        &zero,
        &zero,
    );
    let proof = Bytes::from_array(&env, &[1u8; 32]);
    let epk = zero_bytes(&env);
    let encrypted = encrypted_note(&env);

    client.shielded_transfer(
        &nf0,
        &nf1,
        &zero,
        &zero,
        &out0,
        &out1,
        &zero,
        &zero,
        &root,
        &public_inputs,
        &proof,
        &epk,
        &encrypted,
        &epk,
        &encrypted,
        &epk,
        &dummy_enc(&env),
        &epk,
        &dummy_enc(&env),
    );

    assert!(client.is_spent(&nf0));
    assert!(client.is_spent(&nf1));
    assert_eq!(client.leaf_count(), 4);
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

#[test]
fn register_and_read_shielded_key() {
    let env = Env::default();
    let (admin, client, _) = setup_vault(&env);
    let receive_pubkey = BytesN::from_array(&env, &[9u8; 32]);

    client.register_shielded_key(&admin, &receive_pubkey);

    let stored = client.get_shielded_key(&admin);
    assert_eq!(stored, Some(receive_pubkey));
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn register_shielded_key_requires_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token = token_contract.address();
    let verifier_id = env.register(MockVerifier, ());
    let vault_id = env.register(Vault, ());
    let client = VaultClient::new(&env, &vault_id);
    client.initialize(&admin, &token, &verifier_id);

    let receive_pubkey = BytesN::from_array(&env, &[9u8; 32]);
    client.register_shielded_key(&owner, &receive_pubkey);
}

#[test]
fn withdraw_transfers_tokens_to_recipient() {
    let env = Env::default();
    let (admin, client, token) = setup_vault(&env);
    let recipient = Address::generate(&env);

    let amount = 5_000_i128;
    let commitment = BytesN::from_array(&env, &[3u8; 32]);
    client.deposit(&admin, &amount, &commitment);

    let sac = token::StellarAssetClient::new(&env, &token);
    let recipient_before = sac.balance(&recipient);

    let root = client.get_root();
    let nullifier = BytesN::from_array(&env, &[11u8; 32]);
    let zero = zero_bytes(&env);
    let public_amount = zero_bytes(&env);
    let public_inputs = client.build_public_inputs(
        &root,
        &nullifier,
        &zero,
        &zero,
        &zero,
        &zero,
        &zero,
        &zero,
        &zero,
        &public_amount,
    );
    let proof = Bytes::from_array(&env, &[2u8; 32]);

    client.withdraw(
        &recipient,
        &nullifier,
        &amount,
        &root,
        &public_inputs,
        &proof,
    );

    assert!(client.is_spent(&nullifier));
    assert_eq!(sac.balance(&recipient), recipient_before + amount);
}

#[test]
#[should_panic(expected = "nullifier spent")]
fn double_spend_nullifier_reverts() {
    let env = Env::default();
    let (admin, client, _) = setup_vault(&env);

    let commitment = BytesN::from_array(&env, &[3u8; 32]);
    client.deposit(&admin, &1_000_i128, &commitment);

    let root = client.get_root();
    let nullifier = BytesN::from_array(&env, &[7u8; 32]);
    let new_commitment = BytesN::from_array(&env, &[8u8; 32]);
    let zero = zero_bytes(&env);
    let public_inputs = transfer_public_inputs(&env, &client, &root, &nullifier, &new_commitment);
    let proof = Bytes::from_array(&env, &[1u8; 32]);
    let epk = zero_bytes(&env);
    let encrypted = encrypted_note(&env);
    let dummy = dummy_enc(&env);

    let args = (
        nullifier.clone(),
        zero.clone(),
        zero.clone(),
        zero.clone(),
        new_commitment.clone(),
        zero.clone(),
        zero.clone(),
        zero.clone(),
        root.clone(),
        public_inputs.clone(),
        proof.clone(),
        epk.clone(),
        encrypted.clone(),
        epk.clone(),
        dummy.clone(),
        epk.clone(),
        dummy.clone(),
        epk.clone(),
        dummy.clone(),
    );

    client.shielded_transfer(
        &args.0, &args.1, &args.2, &args.3, &args.4, &args.5, &args.6, &args.7, &args.8,
        &args.9, &args.10, &args.11, &args.12, &args.13, &args.14, &args.15, &args.16,
        &args.17, &args.18,
    );
    client.shielded_transfer(
        &args.0, &args.1, &args.2, &args.3, &args.4, &args.5, &args.6, &args.7, &args.8,
        &args.9, &args.10, &args.11, &args.12, &args.13, &args.14, &args.15, &args.16,
        &args.17, &args.18,
    );
}

#[test]
#[should_panic(expected = "stale merkle root")]
fn stale_merkle_root_reverts() {
    let env = Env::default();
    let (admin, client, _) = setup_vault(&env);

    let commitment = BytesN::from_array(&env, &[3u8; 32]);
    client.deposit(&admin, &1_000_i128, &commitment);

    let stale_root = BytesN::from_array(&env, &[4u8; 32]);
    let nullifier = BytesN::from_array(&env, &[7u8; 32]);
    let new_commitment = BytesN::from_array(&env, &[8u8; 32]);
    let zero = zero_bytes(&env);
    let public_inputs = transfer_public_inputs(&env, &client, &stale_root, &nullifier, &new_commitment);
    let proof = Bytes::from_array(&env, &[1u8; 32]);
    let epk = zero_bytes(&env);
    let encrypted = encrypted_note(&env);
    let dummy = dummy_enc(&env);

    client.shielded_transfer(
        &nullifier,
        &zero,
        &zero,
        &zero,
        &new_commitment,
        &zero,
        &zero,
        &zero,
        &stale_root,
        &public_inputs,
        &proof,
        &epk,
        &encrypted,
        &epk,
        &dummy,
        &epk,
        &dummy,
        &epk,
        &dummy,
    );
}

#[test]
#[should_panic(expected = "encrypted_note required")]
fn shielded_transfer_empty_encrypted_reverts() {
    let env = Env::default();
    let (admin, client, _) = setup_vault(&env);

    let commitment = BytesN::from_array(&env, &[3u8; 32]);
    client.deposit(&admin, &1_000_i128, &commitment);

    let root = client.get_root();
    let nullifier = BytesN::from_array(&env, &[7u8; 32]);
    let new_commitment = BytesN::from_array(&env, &[8u8; 32]);
    let zero = zero_bytes(&env);
    let public_inputs = transfer_public_inputs(&env, &client, &root, &nullifier, &new_commitment);
    let proof = Bytes::from_array(&env, &[1u8; 32]);
    let epk = zero_bytes(&env);
    let empty = Bytes::new(&env);
    let dummy = dummy_enc(&env);

    client.shielded_transfer(
        &nullifier,
        &zero,
        &zero,
        &zero,
        &new_commitment,
        &zero,
        &zero,
        &zero,
        &root,
        &public_inputs,
        &proof,
        &epk,
        &empty,
        &epk,
        &dummy,
        &epk,
        &dummy,
        &epk,
        &dummy,
    );
}

#[test]
#[should_panic(expected = "invalid proof")]
fn reject_verifier_blocks_spend() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token = token_contract.address();
    let verifier_id = env.register(RejectVerifier, ());
    let vault_id = env.register(Vault, ());
    let client = VaultClient::new(&env, &vault_id);
    client.initialize(&admin, &token, &verifier_id);

    let sac = token::StellarAssetClient::new(&env, &token);
    sac.mint(&admin, &100_000_i128);

    let commitment = BytesN::from_array(&env, &[3u8; 32]);
    client.deposit(&admin, &1_000_i128, &commitment);

    let root = client.get_root();
    let nullifier = BytesN::from_array(&env, &[7u8; 32]);
    let new_commitment = BytesN::from_array(&env, &[8u8; 32]);
    let zero = zero_bytes(&env);
    let public_inputs = transfer_public_inputs(&env, &client, &root, &nullifier, &new_commitment);
    let proof = Bytes::from_array(&env, &[1u8; 32]);
    let epk = zero_bytes(&env);
    let encrypted = encrypted_note(&env);
    let dummy = dummy_enc(&env);

    client.shielded_transfer(
        &nullifier,
        &zero,
        &zero,
        &zero,
        &new_commitment,
        &zero,
        &zero,
        &zero,
        &root,
        &public_inputs,
        &proof,
        &epk,
        &encrypted,
        &epk,
        &dummy,
        &epk,
        &dummy,
        &epk,
        &dummy,
    );
}
