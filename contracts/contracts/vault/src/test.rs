#![cfg(test)]

use super::*;
use merkle::MerkleTree;
use pool::JOIN_AMOUNTS;
use soroban_sdk::{contract, contractimpl, crypto::bn254::Bn254Fr, testutils::{Address as _, Events}, token, Address, Bytes, BytesN, Env, U256};

const POOL_ID: u32 = 0;

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

fn setup_vault(env: &Env) -> (Address, VaultClient<'static>, Address, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token = token_contract.address();
    let verifier_id = env.register(MockVerifier, ());
    let vault_id = env.register(Vault, ());
    let client = VaultClient::new(env, &vault_id);
    client.initialize(&admin, &token, &verifier_id);

    let sac = token::StellarAssetClient::new(env, &token);
    sac.mint(&admin, &1_000_000_000_i128);

    (admin, client, token, vault_id)
}

fn zero_bytes(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn exit_public_inputs(
    env: &Env,
    client: &VaultClient,
    root: &BytesN<32>,
    nullifier: &BytesN<32>,
    relayer_fee_stroops: u32,
) -> Bytes {
    let zero = zero_bytes(env);
    let join_amount = JOIN_AMOUNTS[POOL_ID as usize];
    let public_amount =
        Bn254Fr::from_u256(U256::from_u32(env, join_amount as u32)).to_bytes();
    let relayer_fee =
        Bn254Fr::from_u256(U256::from_u32(env, relayer_fee_stroops)).to_bytes();
    client.build_public_inputs(
        &POOL_ID,
        root,
        nullifier,
        &zero,
        &zero,
        &zero,
        &zero,
        &zero,
        &zero,
        &zero,
        &public_amount,
        &relayer_fee,
    )
}

fn seed_pool(env: &Env, client: &VaultClient, admin: &Address, count: u32) {
    for i in 0..count {
        let mut commitment = [0u8; 32];
        commitment[0] = i as u8 + 1;
        client.join_pool(admin, &POOL_ID, &BytesN::from_array(env, &commitment));
    }
}

fn invoke_exit(
    env: &Env,
    client: &VaultClient,
    recipient: &Address,
    relayer: &Address,
    root: &BytesN<32>,
    nullifier: &BytesN<32>,
    relayer_fee_stroops: u32,
) {
    let zero = zero_bytes(env);
    let public_inputs = exit_public_inputs(env, client, root, nullifier, relayer_fee_stroops);
    let proof = Bytes::from_array(env, &[2u8; 32]);
    client.exit_pool(
        &POOL_ID,
        recipient,
        relayer,
        nullifier,
        &zero,
        &zero,
        &zero,
        root,
        &public_inputs,
        &proof,
        &relayer_fee_stroops,
    );
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
fn pool_leaf_count_starts_at_zero() {
    let env = Env::default();
    let (_, client, _, _) = setup_vault(&env);
    assert_eq!(client.pool_leaf_count(&0), 0);
    assert_eq!(client.pool_leaf_count(&1), 0);
    assert_eq!(client.pool_leaf_count(&2), 0);
}

#[test]
fn join_pool_increments_pool_leaf_count() {
    let env = Env::default();
    let (admin, client, _, _) = setup_vault(&env);
    let commitment = BytesN::from_array(&env, &[3u8; 32]);

    client.join_pool(&admin, &POOL_ID, &commitment);

    assert_eq!(client.pool_leaf_count(&POOL_ID), 1);
}

#[test]
fn join_pool_transfers_fixed_amount() {
    let env = Env::default();
    let (admin, client, token, vault_addr) = setup_vault(&env);
    let commitment = BytesN::from_array(&env, &[5u8; 32]);
    let sac = token::StellarAssetClient::new(&env, &token);
    let admin_before = sac.balance(&admin);
    let vault_before = sac.balance(&vault_addr);

    client.join_pool(&admin, &POOL_ID, &commitment);

    assert_eq!(sac.balance(&admin), admin_before - 10_000_000);
    assert_eq!(sac.balance(&vault_addr), vault_before + 10_000_000);
    assert_eq!(client.pool_leaf_count(&POOL_ID), 1);
}

#[test]
fn join_pool_emits_no_depositor() {
    use soroban_sdk::{Map, Symbol, TryFromVal, Val};
    use soroban_sdk::xdr::{ContractEventBody, ScVal};

    let env = Env::default();
    let (admin, client, _, vault_addr) = setup_vault(&env);
    let commitment = BytesN::from_array(&env, &[6u8; 32]);

    client.join_pool(&admin, &POOL_ID, &commitment);

    let events = env.events().all().filter_by_contract(&vault_addr);
    assert_eq!(events.events().len(), 1);
    let body = &events.events()[0].body;
    let data = match body {
        ContractEventBody::V0(v0) => &v0.data,
        _ => panic!("unexpected event body version"),
    };
    let val = Val::try_from_val(&env, &ScVal::try_from(data.clone()).unwrap()).unwrap();
    let map = Map::<Symbol, Val>::try_from_val(&env, &val).unwrap();
    assert!(map.get(Symbol::new(&env, "pool_id")).is_some());
    assert!(map.get(Symbol::new(&env, "commitment")).is_some());
    assert!(map.get(Symbol::new(&env, "leaf_index")).is_some());
    assert!(map.get(Symbol::new(&env, "depositor")).is_none());
    assert!(map.get(Symbol::new(&env, "amount")).is_none());
}

#[test]
#[should_panic(expected = "pool below min anonymity set size")]
fn exit_reverts_when_pool_below_min_size() {
    let env = Env::default();
    let (admin, client, _, _) = setup_vault(&env);

    let commitment = BytesN::from_array(&env, &[3u8; 32]);
    client.join_pool(&admin, &POOL_ID, &commitment);

    let root = client.get_pool_root(&POOL_ID);
    let nullifier = BytesN::from_array(&env, &[7u8; 32]);
    let recipient = Address::generate(&env);
    let relayer = Address::generate(&env);

    invoke_exit(&env, &client, &recipient, &relayer, &root, &nullifier, 0);
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
fn exit_pool_transfers_to_recipient_and_relayer() {
    let env = Env::default();
    let (admin, client, token, vault_id) = setup_vault(&env);

    seed_pool(&env, &client, &admin, 3);

    let recipient = Address::generate(&env);
    let relayer = Address::generate(&env);
    let sac = token::StellarAssetClient::new(&env, &token);
    sac.mint(&recipient, &0);
    sac.mint(&relayer, &0);

    let vault_balance_before = sac.balance(&vault_id);
    let recipient_before = sac.balance(&recipient);
    let relayer_before = sac.balance(&relayer);

    let root = client.get_pool_root(&POOL_ID);
    let nullifier = BytesN::from_array(&env, &[11u8; 32]);
    let relayer_fee_stroops = 100_000_u32;

    invoke_exit(
        &env,
        &client,
        &recipient,
        &relayer,
        &root,
        &nullifier,
        relayer_fee_stroops,
    );

    let join_amount = JOIN_AMOUNTS[POOL_ID as usize];
    assert!(client.is_spent(&nullifier));
    assert_eq!(
        sac.balance(&vault_id),
        vault_balance_before - join_amount,
        "vault pays join amount"
    );
    assert_eq!(
        sac.balance(&recipient),
        recipient_before + join_amount - relayer_fee_stroops as i128
    );
    assert_eq!(
        sac.balance(&relayer),
        relayer_before + relayer_fee_stroops as i128
    );
}

#[test]
#[should_panic(expected = "relayer_fee mismatch")]
fn exit_pool_wrong_relayer_fee_reverts() {
    let env = Env::default();
    let (admin, client, _, _) = setup_vault(&env);

    seed_pool(&env, &client, &admin, 3);

    let recipient = Address::generate(&env);
    let relayer = Address::generate(&env);
    let root = client.get_pool_root(&POOL_ID);
    let nullifier = BytesN::from_array(&env, &[11u8; 32]);
    let zero = zero_bytes(&env);
    let join_amount = JOIN_AMOUNTS[POOL_ID as usize];
    let relayer_fee_stroops = 100_000_u32;
    let public_amount =
        Bn254Fr::from_u256(U256::from_u32(&env, join_amount as u32)).to_bytes();
    let relayer_fee =
        Bn254Fr::from_u256(U256::from_u32(&env, relayer_fee_stroops)).to_bytes();
    let public_inputs = client.build_public_inputs(
        &POOL_ID,
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
        &relayer_fee,
    );
    let proof = Bytes::from_array(&env, &[2u8; 32]);

    client.exit_pool(
        &POOL_ID,
        &recipient,
        &relayer,
        &nullifier,
        &zero,
        &zero,
        &zero,
        &root,
        &public_inputs,
        &proof,
        &50_000_u32,
    );
}

#[test]
#[should_panic(expected = "nullifier spent")]
fn double_spend_nullifier_reverts() {
    let env = Env::default();
    let (admin, client, _, _) = setup_vault(&env);

    seed_pool(&env, &client, &admin, 3);

    let root = client.get_pool_root(&POOL_ID);
    let nullifier = BytesN::from_array(&env, &[7u8; 32]);
    let recipient = Address::generate(&env);
    let relayer = Address::generate(&env);

    invoke_exit(&env, &client, &recipient, &relayer, &root, &nullifier, 0);
    invoke_exit(&env, &client, &recipient, &relayer, &root, &nullifier, 0);
}

#[test]
#[should_panic(expected = "stale merkle root")]
fn stale_merkle_root_reverts() {
    let env = Env::default();
    let (admin, client, _, _) = setup_vault(&env);

    seed_pool(&env, &client, &admin, 3);

    let stale_root = BytesN::from_array(&env, &[4u8; 32]);
    let nullifier = BytesN::from_array(&env, &[7u8; 32]);
    let recipient = Address::generate(&env);
    let relayer = Address::generate(&env);

    invoke_exit(
        &env,
        &client,
        &recipient,
        &relayer,
        &stale_root,
        &nullifier,
        0,
    );
}

#[test]
#[should_panic(expected = "invalid proof")]
fn reject_verifier_blocks_exit() {
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
    sac.mint(&admin, &1_000_000_000_i128);

    seed_pool(&env, &client, &admin, 3);

    let root = client.get_pool_root(&POOL_ID);
    let nullifier = BytesN::from_array(&env, &[7u8; 32]);
    let recipient = Address::generate(&env);
    let relayer = Address::generate(&env);

    invoke_exit(&env, &client, &recipient, &relayer, &root, &nullifier, 0);
}
