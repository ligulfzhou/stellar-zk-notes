#![no_std]

mod merkle;
mod storage;
mod verifier;

use merkle::{MerkleTree, TREE_HEIGHT};
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, crypto::bn254::Bn254Fr, token, Address,
    Bytes, BytesN, Env,
};
use storage::DataKey;
use verifier::{
    encode_public_inputs, has_active_spend, mark_nullifier_spent, verify_transfer_proof,
    MAX_ACTION_SLOTS,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultConfig {
    pub admin: Address,
    pub token: Address,
    pub verifier: Address,
}

#[contractevent]
pub struct DepositEvent {
    pub commitment: BytesN<32>,
    pub leaf_index: u32,
}

#[contractevent]
pub struct ShieldedSendEvent {
    pub nullifier: BytesN<32>,
    pub new_commitment: BytesN<32>,
    pub leaf_index: u32,
    pub epk: BytesN<32>,
    pub encrypted_note: Bytes,
}

#[contractevent]
pub struct WithdrawEvent {
    pub nullifier: BytesN<32>,
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent]
pub struct ExitEvent {
    pub nullifier: BytesN<32>,
}

#[contract]
pub struct Vault;

fn is_zero_bytes(bytes: &BytesN<32>) -> bool {
    bytes.to_array().iter().all(|b| *b == 0)
}

fn zero_bytes(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn load_tree(env: &Env) -> MerkleTree {
    env.storage()
        .instance()
        .get(&DataKey::Tree)
        .unwrap_or_else(|| MerkleTree::empty(env))
}

fn store_tree(env: &Env, tree: &MerkleTree) {
    env.storage().instance().set(&DataKey::Tree, tree);
}

fn field_at(public_inputs: &Bytes, index: u32) -> [u8; 32] {
    let start = index * 32;
    assert!(
        public_inputs.len() >= start + 32,
        "public_inputs too short"
    );
    let mut out = [0u8; 32];
    public_inputs
        .slice(start..start + 32)
        .copy_into_slice(&mut out);
    out
}

fn stroops_from_field(env: &Env, field: &BytesN<32>) -> i128 {
    let fr = Bn254Fr::from_bytes(field.clone());
    let u = fr.to_u256();
    let v = u.to_u128().expect("amount too large for u128");
    assert!(v <= i128::MAX as u128, "amount exceeds i128");
    v as i128
}

#[contractimpl]
impl Vault {
    pub fn initialize(env: Env, admin: Address, token: Address, verifier: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Verifier, &verifier);
        store_tree(&env, &MerkleTree::empty(&env));
    }

    pub fn deposit(env: Env, from: Address, amount: i128, commitment: BytesN<32>) {
        from.require_auth();
        assert!(amount > 0, "amount must be positive");

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let vault_addr = env.current_contract_address();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&from, &vault_addr, &amount);

        let leaf_index = Self::insert_commitment_leaf(&env, &commitment);

        DepositEvent {
            commitment,
            leaf_index,
        }
        .publish(&env);
    }

    pub fn shielded_transfer(
        env: Env,
        nullifier0: BytesN<32>,
        nullifier1: BytesN<32>,
        nullifier2: BytesN<32>,
        nullifier3: BytesN<32>,
        new_commitment0: BytesN<32>,
        new_commitment1: BytesN<32>,
        new_commitment2: BytesN<32>,
        new_commitment3: BytesN<32>,
        merkle_root: BytesN<32>,
        public_inputs: Bytes,
        proof_bytes: Bytes,
        epk0: BytesN<32>,
        encrypted_note0: Bytes,
        epk1: BytesN<32>,
        encrypted_note1: Bytes,
        epk2: BytesN<32>,
        encrypted_note2: Bytes,
        epk3: BytesN<32>,
        encrypted_note3: Bytes,
    ) {
        let nullifiers = [
            nullifier0.clone(),
            nullifier1.clone(),
            nullifier2.clone(),
            nullifier3.clone(),
        ];
        let commitments = [
            new_commitment0.clone(),
            new_commitment1.clone(),
            new_commitment2.clone(),
            new_commitment3.clone(),
        ];
        let epks = [epk0, epk1, epk2, epk3];
        let notes = [
            encrypted_note0.clone(),
            encrypted_note1.clone(),
            encrypted_note2.clone(),
            encrypted_note3.clone(),
        ];

        for (i, nc) in commitments.iter().enumerate() {
            if !is_zero_bytes(nc) {
                assert!(notes[i].len() > 0, "encrypted_note required for output");
                assert!(notes[i].len() <= 512, "encrypted_note too large");
            }
        }

        Self::verify_shielded_public_inputs(&env, &public_inputs);

        let leaf_indices = Self::apply_transfer(
            &env,
            &nullifiers,
            &commitments,
            merkle_root,
            public_inputs,
            proof_bytes,
        );

        for i in 0..MAX_ACTION_SLOTS {
            if let Some(leaf_index) = leaf_indices[i] {
                ShieldedSendEvent {
                    nullifier: nullifiers[i].clone(),
                    new_commitment: commitments[i].clone(),
                    leaf_index,
                    epk: epks[i].clone(),
                    encrypted_note: notes[i].clone(),
                }
                .publish(&env);
            }
        }
    }

    pub fn withdraw(
        env: Env,
        recipient: Address,
        nullifier0: BytesN<32>,
        nullifier1: BytesN<32>,
        nullifier2: BytesN<32>,
        nullifier3: BytesN<32>,
        merkle_root: BytesN<32>,
        public_inputs: Bytes,
        proof_bytes: Bytes,
    ) {
        let nullifiers = [
            nullifier0.clone(),
            nullifier1.clone(),
            nullifier2.clone(),
            nullifier3.clone(),
        ];
        let zero = zero_bytes(&env);
        let commitments = [zero.clone(), zero.clone(), zero.clone(), zero];

        let amount = Self::verify_withdraw_public_inputs(&env, &public_inputs, 0);

        Self::apply_transfer(
            &env,
            &nullifiers,
            &commitments,
            merkle_root,
            public_inputs,
            proof_bytes,
        );

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let vault_addr = env.current_contract_address();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&vault_addr, &recipient, &amount);

        let primary_nf = nullifiers
            .iter()
            .find(|n| !is_zero_bytes(n))
            .cloned()
            .unwrap_or_else(|| zero_bytes(&env));

        WithdrawEvent {
            nullifier: primary_nf,
            recipient,
            amount,
        }
        .publish(&env);
    }

    pub fn exit_via_relayer(
        env: Env,
        recipient: Address,
        relayer: Address,
        nullifier0: BytesN<32>,
        nullifier1: BytesN<32>,
        nullifier2: BytesN<32>,
        nullifier3: BytesN<32>,
        merkle_root: BytesN<32>,
        public_inputs: Bytes,
        proof_bytes: Bytes,
    ) {
        relayer.require_auth();

        let nullifiers = [
            nullifier0.clone(),
            nullifier1.clone(),
            nullifier2.clone(),
            nullifier3.clone(),
        ];
        let zero = zero_bytes(&env);
        let commitments = [zero.clone(), zero.clone(), zero.clone(), zero];

        let relayer_fee_field = BytesN::from_array(&env, &field_at(&public_inputs, 10));
        let relayer_fee = stroops_from_field(&env, &relayer_fee_field);
        assert!(relayer_fee >= 0, "relayer fee negative");

        let amount = Self::verify_withdraw_public_inputs(&env, &public_inputs, relayer_fee);

        Self::apply_transfer(
            &env,
            &nullifiers,
            &commitments,
            merkle_root,
            public_inputs,
            proof_bytes,
        );

        let payout = amount - relayer_fee;
        assert!(payout > 0, "payout must be positive");

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let vault_addr = env.current_contract_address();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&vault_addr, &recipient, &payout);
        if relayer_fee > 0 {
            token_client.transfer(&vault_addr, &relayer, &relayer_fee);
        }

        let primary_nf = nullifiers
            .iter()
            .find(|n| !is_zero_bytes(n))
            .cloned()
            .unwrap_or_else(|| zero_bytes(&env));

        ExitEvent {
            nullifier: primary_nf,
        }
        .publish(&env);
    }

    pub fn get_root(env: Env) -> BytesN<32> {
        load_tree(&env).root(&env).to_bytes()
    }

    pub fn leaf_count(env: Env) -> u32 {
        load_tree(&env).leaf_count
    }

    pub fn get_filled_at_level(env: Env, level: u32) -> BytesN<32> {
        assert!(level < TREE_HEIGHT, "level out of range");
        let tree = load_tree(&env);
        tree.filled.get(level).unwrap()
    }

    pub fn get_zero_at_level(env: Env, level: u32) -> BytesN<32> {
        assert!(level < TREE_HEIGHT, "level out of range");
        let tree = load_tree(&env);
        tree.zeros.get(level).unwrap()
    }

    pub fn get_commitment_at(env: Env, leaf_index: u32) -> Option<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::LeafCommitment(leaf_index))
    }

    pub fn is_spent(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Nullifier(nullifier))
            .unwrap_or(false)
    }

    pub fn build_public_inputs(
        env: Env,
        merkle_root: BytesN<32>,
        nullifier0: BytesN<32>,
        nullifier1: BytesN<32>,
        nullifier2: BytesN<32>,
        nullifier3: BytesN<32>,
        new_commitment0: BytesN<32>,
        new_commitment1: BytesN<32>,
        new_commitment2: BytesN<32>,
        new_commitment3: BytesN<32>,
        public_amount: BytesN<32>,
        relayer_fee: BytesN<32>,
    ) -> Bytes {
        encode_public_inputs(
            &env,
            &merkle_root,
            &[
                nullifier0,
                nullifier1,
                nullifier2,
                nullifier3,
            ],
            &[
                new_commitment0,
                new_commitment1,
                new_commitment2,
                new_commitment3,
            ],
            &public_amount,
            &relayer_fee,
        )
    }

    fn insert_commitment_leaf(env: &Env, new_commitment: &BytesN<32>) -> u32 {
        let mut tree = load_tree(env);
        let leaf = Bn254Fr::from_bytes(new_commitment.clone());
        let leaf_index = tree.insert(env, leaf);
        env.storage().persistent().set(
            &DataKey::LeafCommitment(leaf_index),
            new_commitment,
        );
        store_tree(env, &tree);
        leaf_index
    }

    fn insert_commitment(env: &Env, new_commitment: &BytesN<32>) -> Option<u32> {
        if is_zero_bytes(new_commitment) {
            return None;
        }
        Some(Self::insert_commitment_leaf(env, new_commitment))
    }

    fn verify_shielded_public_inputs(env: &Env, public_inputs: &Bytes) {
        assert_eq!(
            public_inputs.len(),
            verifier::PUBLIC_INPUTS_LEN,
            "public_inputs must be 11 fields"
        );
        let public_amount = BytesN::from_array(env, &field_at(public_inputs, 9));
        let relayer_fee = BytesN::from_array(env, &field_at(public_inputs, 10));
        let zero = zero_bytes(env);
        assert_eq!(public_amount, zero, "shielded transfer requires public_amount=0");
        assert_eq!(relayer_fee, zero, "shielded transfer requires relayer_fee=0");
    }

    fn verify_withdraw_public_inputs(
        env: &Env,
        public_inputs: &Bytes,
        expected_relayer_fee: i128,
    ) -> i128 {
        assert_eq!(
            public_inputs.len(),
            verifier::PUBLIC_INPUTS_LEN,
            "public_inputs must be 11 fields"
        );

        let public_amount_field = BytesN::from_array(env, &field_at(public_inputs, 9));
        let relayer_fee_field = BytesN::from_array(env, &field_at(public_inputs, 10));
        let amount = stroops_from_field(env, &public_amount_field);
        let fee = stroops_from_field(env, &relayer_fee_field);

        assert!(amount > 0, "withdraw amount must be positive");
        assert!(fee >= 0 && fee <= amount, "relayer fee out of range");
        assert_eq!(fee, expected_relayer_fee, "relayer_fee mismatch");

        for i in 5..9 {
            let nc = BytesN::from_array(env, &field_at(public_inputs, i));
            assert!(is_zero_bytes(&nc), "withdraw must not create shielded outputs");
        }

        amount
    }

    fn apply_transfer(
        env: &Env,
        nullifiers: &[BytesN<32>; MAX_ACTION_SLOTS],
        new_commitments: &[BytesN<32>; MAX_ACTION_SLOTS],
        merkle_root: BytesN<32>,
        public_inputs: Bytes,
        proof_bytes: Bytes,
    ) -> [Option<u32>; MAX_ACTION_SLOTS] {
        for nf in nullifiers {
            mark_nullifier_spent(env, nf);
        }

        if has_active_spend(nullifiers) {
            assert_eq!(
                merkle_root,
                Self::get_root(env.clone()),
                "stale merkle root"
            );
        }

        let verifier: Address = env.storage().instance().get(&DataKey::Verifier).unwrap();
        verify_transfer_proof(env, &verifier, &public_inputs, &proof_bytes);

        let mut out = [None, None, None, None];
        for i in 0..MAX_ACTION_SLOTS {
            out[i] = Self::insert_commitment(env, &new_commitments[i]);
        }
        out
    }
}

mod test;
