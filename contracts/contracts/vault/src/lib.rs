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
    encode_public_inputs, mark_nullifier_spent, verify_transfer_proof, MAX_ACTION_SLOTS,
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
    pub depositor: Address,
    pub commitment: BytesN<32>,
    pub leaf_index: u32,
    pub amount: i128,
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
    pub recipient: Address,
    pub nullifier: BytesN<32>,
    pub amount: i128,
}

#[contractevent]
pub struct ShieldedKeyRegisteredEvent {
    pub owner: Address,
    pub receive_pubkey: BytesN<32>,
}

#[contract]
pub struct Vault;

fn is_zero_bytes(bytes: &BytesN<32>) -> bool {
    bytes.to_array().iter().all(|b| *b == 0)
}

fn zero_bytes(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
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
        let tree = MerkleTree::empty(&env);
        env.storage().instance().set(&DataKey::MerkleTree, &tree);
    }

    pub fn deposit(env: Env, from: Address, amount: i128, commitment: BytesN<32>) {
        from.require_auth();
        assert!(amount > 0, "amount must be positive");

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let vault_addr = env.current_contract_address();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&from, &vault_addr, &amount);

        let mut tree: MerkleTree = env.storage().instance().get(&DataKey::MerkleTree).unwrap();
        let leaf = Bn254Fr::from_bytes(commitment.clone());
        let leaf_index = tree.insert(&env, leaf);
        env.storage()
            .persistent()
            .set(&DataKey::LeafCommitment(leaf_index), &commitment);
        env.storage().instance().set(&DataKey::MerkleTree, &tree);

        DepositEvent {
            depositor: from,
            commitment,
            leaf_index,
            amount,
        }
        .publish(&env);
    }

    /// Action-bundle shielded transfer: up to 4 spends and 4 outputs in one proof.
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

        let leaf_indices = Self::apply_transfer(
            &env,
            &nullifiers,
            &commitments,
            merkle_root,
            public_inputs,
            proof_bytes,
            None,
            0,
        );

        let primary_nf = nullifiers
            .iter()
            .find(|n| !is_zero_bytes(n))
            .cloned()
            .unwrap_or_else(|| zero_bytes(&env));

        for i in 0..MAX_ACTION_SLOTS {
            if let Some(leaf_index) = leaf_indices[i] {
                ShieldedSendEvent {
                    nullifier: primary_nf.clone(),
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
        to: Address,
        nullifier: BytesN<32>,
        amount: i128,
        merkle_root: BytesN<32>,
        public_inputs: Bytes,
        proof_bytes: Bytes,
    ) {
        assert!(amount > 0, "amount must be positive");
        let event_nullifier = nullifier.clone();
        let zero = zero_bytes(&env);
        let nullifiers = [nullifier, zero.clone(), zero.clone(), zero.clone()];
        let commitments = [zero.clone(), zero.clone(), zero.clone(), zero];

        Self::apply_transfer(
            &env,
            &nullifiers,
            &commitments,
            merkle_root,
            public_inputs,
            proof_bytes,
            Some(to.clone()),
            amount,
        );

        WithdrawEvent {
            recipient: to,
            nullifier: event_nullifier,
            amount,
        }
        .publish(&env);
    }

    pub fn get_root(env: Env) -> BytesN<32> {
        let tree: MerkleTree = env.storage().instance().get(&DataKey::MerkleTree).unwrap();
        tree.root(&env).to_bytes()
    }

    pub fn leaf_count(env: Env) -> u32 {
        let tree: MerkleTree = env.storage().instance().get(&DataKey::MerkleTree).unwrap();
        tree.leaf_count
    }

    pub fn get_filled_at_level(env: Env, level: u32) -> BytesN<32> {
        assert!(level < TREE_HEIGHT, "level out of range");
        let tree: MerkleTree = env.storage().instance().get(&DataKey::MerkleTree).unwrap();
        tree.filled.get(level).unwrap()
    }

    pub fn get_zero_at_level(env: Env, level: u32) -> BytesN<32> {
        assert!(level < TREE_HEIGHT, "level out of range");
        let tree: MerkleTree = env.storage().instance().get(&DataKey::MerkleTree).unwrap();
        tree.zeros.get(level).unwrap()
    }

    pub fn register_shielded_key(env: Env, owner: Address, receive_pubkey: BytesN<32>) {
        owner.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::ShieldedKey(owner.clone()), &receive_pubkey);
        ShieldedKeyRegisteredEvent {
            owner,
            receive_pubkey,
        }
        .publish(&env);
    }

    pub fn get_shielded_key(env: Env, owner: Address) -> Option<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::ShieldedKey(owner))
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

    fn insert_commitment(env: &Env, new_commitment: &BytesN<32>) -> Option<u32> {
        if is_zero_bytes(new_commitment) {
            return None;
        }
        let mut tree: MerkleTree = env.storage().instance().get(&DataKey::MerkleTree).unwrap();
        let leaf = Bn254Fr::from_bytes(new_commitment.clone());
        let leaf_index = tree.insert(env, leaf);
        env.storage()
            .persistent()
            .set(&DataKey::LeafCommitment(leaf_index), new_commitment);
        env.storage().instance().set(&DataKey::MerkleTree, &tree);
        Some(leaf_index)
    }

    fn apply_transfer(
        env: &Env,
        nullifiers: &[BytesN<32>; MAX_ACTION_SLOTS],
        new_commitments: &[BytesN<32>; MAX_ACTION_SLOTS],
        merkle_root: BytesN<32>,
        public_inputs: Bytes,
        proof_bytes: Bytes,
        withdraw_to: Option<Address>,
        withdraw_amount: i128,
    ) -> [Option<u32>; MAX_ACTION_SLOTS] {
        for nf in nullifiers {
            mark_nullifier_spent(env, nf);
        }
        assert_eq!(merkle_root, Self::get_root(env.clone()), "stale merkle root");

        let verifier: Address = env.storage().instance().get(&DataKey::Verifier).unwrap();
        verify_transfer_proof(env, &verifier, &public_inputs, &proof_bytes);

        if withdraw_amount > 0 {
            assert!(
                new_commitments.iter().all(is_zero_bytes),
                "withdraw must not create shielded outputs"
            );
            let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
            let vault_addr = env.current_contract_address();
            let recipient = withdraw_to.expect("withdraw recipient required");
            let token_client = token::Client::new(env, &token_addr);
            token_client.transfer(&vault_addr, &recipient, &withdraw_amount);
            return [None, None, None, None];
        }

        let mut out = [None, None, None, None];
        for i in 0..MAX_ACTION_SLOTS {
            out[i] = Self::insert_commitment(env, &new_commitments[i]);
        }
        out
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
        )
    }
}

mod test;
