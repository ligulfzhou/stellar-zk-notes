#![cfg(test)]

use super::*;
use merkle::MerkleTree;
use soroban_sdk::{
    contract, contractimpl,
    crypto::bn254::Bn254Fr,
    testutils::{Address as _, Events},
    token, Address, Bytes, BytesN, Env, U256,
};

#[contract]
struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    pub fn verify_proof(_env: Env, _public_inputs: Bytes, _proof_bytes: Bytes) {}
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

fn field_from_u32(env: &Env, value: u32) -> BytesN<32> {
    Bn254Fr::from_u256(U256::from_u32(env, value)).to_bytes()
}

fn withdraw_public_inputs(
    env: &Env,
    client: &VaultClient,
    root: &BytesN<32>,
    nullifier: &BytesN<32>,
    amount_stroops: u32,
    relayer_fee_stroops: u32,
) -> Bytes {
    let zero = zero_bytes(env);
    client.build_public_inputs(
        root,
        nullifier,
        &zero,
        &zero,
        &zero,
        &zero,
        &zero,
        &zero,
        &zero,
        &field_from_u32(env, amount_stroops),
        &field_from_u32(env, relayer_fee_stroops),
    )
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
    let (admin, client, _, _) = setup_vault(&env);
    let commitment = BytesN::from_array(&env, &[3u8; 32]);

    client.deposit(&admin, &25_000_000, &commitment);

    assert_eq!(client.leaf_count(), 1);
}

#[test]
fn deposit_transfers_tokens() {
    let env = Env::default();
    let (admin, client, token, vault_addr) = setup_vault(&env);
    let commitment = BytesN::from_array(&env, &[5u8; 32]);
    let sac = token::StellarAssetClient::new(&env, &token);
    let admin_before = sac.balance(&admin);
    let vault_before = sac.balance(&vault_addr);

    client.deposit(&admin, &25_000_000, &commitment);

    assert_eq!(sac.balance(&admin), admin_before - 25_000_000);
    assert_eq!(sac.balance(&vault_addr), vault_before + 25_000_000);
}

#[test]
fn deposit_emits_no_depositor() {
    use soroban_sdk::xdr::{ContractEventBody, ScVal};
    use soroban_sdk::{Map, Symbol, TryFromVal, Val};

    let env = Env::default();
    let (admin, client, _, vault_addr) = setup_vault(&env);
    let commitment = BytesN::from_array(&env, &[6u8; 32]);

    client.deposit(&admin, &10_000_000, &commitment);

    let events = env.events().all().filter_by_contract(&vault_addr);
    assert_eq!(events.events().len(), 1);
    let body = &events.events()[0].body;
    let data = match body {
        ContractEventBody::V0(v0) => &v0.data,
        _ => panic!("unexpected event body version"),
    };
    let val = Val::try_from_val(&env, &ScVal::try_from(data.clone()).unwrap()).unwrap();
    let map = Map::<Symbol, Val>::try_from_val(&env, &val).unwrap();
    assert!(map.get(Symbol::new(&env, "commitment")).is_some());
    assert!(map.get(Symbol::new(&env, "leaf_index")).is_some());
    assert!(map.get(Symbol::new(&env, "depositor")).is_none());
    assert!(map.get(Symbol::new(&env, "amount")).is_none());
}

#[test]
fn withdraw_pays_recipient() {
    let env = Env::default();
    let (admin, client, token, vault_addr) = setup_vault(&env);
    let commitment = BytesN::from_array(&env, &[8u8; 32]);
    client.deposit(&admin, &50_000_000, &commitment);

    let root = client.get_root();
    let nullifier = BytesN::from_array(&env, &[9u8; 32]);
    let recipient = Address::generate(&env);
    let zero = zero_bytes(&env);
    let public_inputs = withdraw_public_inputs(&env, &client, &root, &nullifier, 50_000_000, 0);
    let proof = Bytes::from_array(&env, &[2u8; 32]);

    client.withdraw(
        &recipient,
        &nullifier,
        &zero,
        &zero,
        &zero,
        &root,
        &public_inputs,
        &proof,
    );

    let sac = token::StellarAssetClient::new(&env, &token);
    assert_eq!(sac.balance(&recipient), 50_000_000);
    assert_eq!(sac.balance(&vault_addr), 0);
}

#[test]
fn exit_via_relayer_pays_fee() {
    let env = Env::default();
    let (admin, client, token, vault_addr) = setup_vault(&env);
    let commitment = BytesN::from_array(&env, &[11u8; 32]);
    client.deposit(&admin, &30_000_000, &commitment);

    let root = client.get_root();
    let nullifier = BytesN::from_array(&env, &[12u8; 32]);
    let recipient = Address::generate(&env);
    let relayer = Address::generate(&env);
    let zero = zero_bytes(&env);
    let fee = 1_000_000_u32;
    let public_inputs =
        withdraw_public_inputs(&env, &client, &root, &nullifier, 30_000_000, fee);
    let proof = Bytes::from_array(&env, &[3u8; 32]);

    client.exit_via_relayer(
        &recipient,
        &relayer,
        &nullifier,
        &zero,
        &zero,
        &zero,
        &root,
        &public_inputs,
        &proof,
    );

    let sac = token::StellarAssetClient::new(&env, &token);
    assert_eq!(sac.balance(&recipient), 29_000_000);
    assert_eq!(sac.balance(&relayer), 1_000_000);
    assert_eq!(sac.balance(&vault_addr), 0);
}

#[test]
fn exit_emits_nullifier_only() {
    use soroban_sdk::xdr::{ContractEventBody, ScVal};
    use soroban_sdk::{Map, Symbol, TryFromVal, Val};

    let env = Env::default();
    let (admin, client, _, vault_addr) = setup_vault(&env);
    let commitment = BytesN::from_array(&env, &[13u8; 32]);
    client.deposit(&admin, &20_000_000, &commitment);

    let root = client.get_root();
    let nullifier = BytesN::from_array(&env, &[14u8; 32]);
    let recipient = Address::generate(&env);
    let relayer = Address::generate(&env);
    let zero = zero_bytes(&env);
    let public_inputs =
        withdraw_public_inputs(&env, &client, &root, &nullifier, 20_000_000, 0);
    let proof = Bytes::from_array(&env, &[4u8; 32]);

    client.exit_via_relayer(
        &recipient,
        &relayer,
        &nullifier,
        &zero,
        &zero,
        &zero,
        &root,
        &public_inputs,
        &proof,
    );

    let events = env.events().all().filter_by_contract(&vault_addr);
    let exit = events.events().last().unwrap();
    let body = match &exit.body {
        ContractEventBody::V0(v0) => &v0.data,
        _ => panic!("unexpected event body version"),
    };
    let val = Val::try_from_val(&env, &ScVal::try_from(body.clone()).unwrap()).unwrap();
    let map = Map::<Symbol, Val>::try_from_val(&env, &val).unwrap();
    assert!(map.get(Symbol::new(&env, "nullifier")).is_some());
    assert!(map.get(Symbol::new(&env, "recipient")).is_none());
    assert!(map.get(Symbol::new(&env, "amount")).is_none());
}

#[test]
#[should_panic(expected = "nullifier spent")]
fn rejects_double_spend() {
    let env = Env::default();
    let (admin, client, _, _) = setup_vault(&env);
    let commitment = BytesN::from_array(&env, &[15u8; 32]);
    client.deposit(&admin, &10_000_000, &commitment);

    let root = client.get_root();
    let nullifier = BytesN::from_array(&env, &[16u8; 32]);
    let recipient = Address::generate(&env);
    let zero = zero_bytes(&env);
    let public_inputs = withdraw_public_inputs(&env, &client, &root, &nullifier, 10_000_000, 0);
    let proof = Bytes::from_array(&env, &[5u8; 32]);

    client.withdraw(
        &recipient,
        &nullifier,
        &zero,
        &zero,
        &zero,
        &root,
        &public_inputs,
        &proof,
    );
    client.withdraw(
        &recipient,
        &nullifier,
        &zero,
        &zero,
        &zero,
        &root,
        &public_inputs,
        &proof,
    );
}
