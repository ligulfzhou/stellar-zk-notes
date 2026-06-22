#![no_std]

mod merkle;
mod pool;
mod storage;
mod verifier;

use merkle::{MerkleTree, TREE_HEIGHT};
use pool::{is_valid_pool_id, JOIN_AMOUNTS, POOL_COUNT};
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, crypto::bn254::Bn254Fr, token, Address,
    Bytes, BytesN, Env, U256,
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
pub struct JoinEvent {
    pub pool_id: u32,
    pub commitment: BytesN<32>,
    pub leaf_index: u32,
}

#[contractevent]
pub struct ShieldedSendEvent {
    pub pool_id: u32,
    pub nullifier: BytesN<32>,
    pub new_commitment: BytesN<32>,
    pub leaf_index: u32,
    pub epk: BytesN<32>,
    pub encrypted_note: Bytes,
}

#[contractevent]
pub struct ExitEvent {
    pub pool_id: u32,
    pub nullifier: BytesN<32>,
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

fn field_bytes_from_u32(env: &Env, value: u32) -> BytesN<32> {
    Bn254Fr::from_u256(U256::from_u32(env, value)).to_bytes()
}

fn load_pool_tree(env: &Env, pool_id: u32) -> MerkleTree {
    assert!(is_valid_pool_id(pool_id), "invalid pool_id");
    env.storage()
        .instance()
        .get(&DataKey::PoolTree(pool_id))
        .unwrap()
}

fn store_pool_tree(env: &Env, pool_id: u32, tree: &MerkleTree) {
    env.storage()
        .instance()
        .set(&DataKey::PoolTree(pool_id), tree);
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
        env.storage()
            .instance()
            .set(&DataKey::MinPoolSize, &pool::MIN_POOL_SIZE);
        for pool_id in 0..POOL_COUNT {
            let tree = MerkleTree::empty(&env);
            store_pool_tree(&env, pool_id, &tree);
        }
    }

    pub fn join_pool(env: Env, from: Address, pool_id: u32, commitment: BytesN<32>) {
        from.require_auth();
        assert!(is_valid_pool_id(pool_id), "invalid pool");

        let amount = JOIN_AMOUNTS[pool_id as usize];
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let vault_addr = env.current_contract_address();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&from, &vault_addr, &amount);

        let leaf_index = Self::insert_pool_commitment(&env, pool_id, &commitment);

        JoinEvent {
            pool_id,
            commitment,
            leaf_index,
        }
        .publish(&env);
    }

    /// Action-bundle shielded transfer scoped to a denomination pool.
    pub fn shielded_transfer(
        env: Env,
        pool_id: u32,
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
            pool_id,
            &nullifiers,
            &commitments,
            merkle_root,
            public_inputs,
            proof_bytes,
        );

        for i in 0..MAX_ACTION_SLOTS {
            if let Some(leaf_index) = leaf_indices[i] {
                ShieldedSendEvent {
                    pool_id,
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

    /// Exit pool: burn shielded note and atomically pay recipient (+ optional relayer fee).
    pub fn exit_pool(
        env: Env,
        pool_id: u32,
        recipient: Address,
        relayer: Address,
        nullifier0: BytesN<32>,
        nullifier1: BytesN<32>,
        nullifier2: BytesN<32>,
        nullifier3: BytesN<32>,
        merkle_root: BytesN<32>,
        public_inputs: Bytes,
        proof_bytes: Bytes,
        relayer_fee_stroops: u32,
    ) {
        assert!(is_valid_pool_id(pool_id), "invalid pool");

        let nullifiers = [
            nullifier0.clone(),
            nullifier1.clone(),
            nullifier2.clone(),
            nullifier3.clone(),
        ];
        let zero = zero_bytes(&env);
        let commitments = [zero.clone(), zero.clone(), zero.clone(), zero];

        Self::verify_exit_public_inputs(&env, pool_id, &public_inputs, relayer_fee_stroops);

        Self::apply_transfer(
            &env,
            pool_id,
            &nullifiers,
            &commitments,
            merkle_root,
            public_inputs,
            proof_bytes,
        );

        let join_amount = JOIN_AMOUNTS[pool_id as usize];
        let fee = relayer_fee_stroops as i128;
        assert!(fee >= 0 && fee <= join_amount, "relayer fee out of range");
        let payout = join_amount - fee;

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let vault_addr = env.current_contract_address();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&vault_addr, &recipient, &payout);
        if fee > 0 {
            token_client.transfer(&vault_addr, &relayer, &fee);
        }

        let primary_nf = nullifiers
            .iter()
            .find(|n| !is_zero_bytes(n))
            .cloned()
            .unwrap_or_else(|| zero_bytes(&env));

        ExitEvent {
            pool_id,
            nullifier: primary_nf,
        }
        .publish(&env);
    }

    pub fn get_pool_root(env: Env, pool_id: u32) -> BytesN<32> {
        let tree = load_pool_tree(&env, pool_id);
        tree.root(&env).to_bytes()
    }

    pub fn pool_leaf_count(env: Env, pool_id: u32) -> u32 {
        load_pool_tree(&env, pool_id).leaf_count
    }

    pub fn get_filled_at_level(env: Env, pool_id: u32, level: u32) -> BytesN<32> {
        assert!(level < TREE_HEIGHT, "level out of range");
        let tree = load_pool_tree(&env, pool_id);
        tree.filled.get(level).unwrap()
    }

    pub fn get_zero_at_level(env: Env, pool_id: u32, level: u32) -> BytesN<32> {
        assert!(level < TREE_HEIGHT, "level out of range");
        let tree = load_pool_tree(&env, pool_id);
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

    pub fn get_commitment_at(env: Env, pool_id: u32, leaf_index: u32) -> Option<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::PoolLeafCommitment(pool_id, leaf_index))
    }

    pub fn is_spent(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Nullifier(nullifier))
            .unwrap_or(false)
    }

    fn insert_pool_commitment(env: &Env, pool_id: u32, new_commitment: &BytesN<32>) -> u32 {
        let mut tree = load_pool_tree(env, pool_id);
        let leaf = Bn254Fr::from_bytes(new_commitment.clone());
        let leaf_index = tree.insert(env, leaf);
        env.storage().persistent().set(
            &DataKey::PoolLeafCommitment(pool_id, leaf_index),
            new_commitment,
        );
        store_pool_tree(env, pool_id, &tree);
        leaf_index
    }

    fn insert_commitment(
        env: &Env,
        pool_id: u32,
        new_commitment: &BytesN<32>,
    ) -> Option<u32> {
        if is_zero_bytes(new_commitment) {
            return None;
        }
        Some(Self::insert_pool_commitment(env, pool_id, new_commitment))
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

    fn verify_exit_public_inputs(
        env: &Env,
        pool_id: u32,
        public_inputs: &Bytes,
        relayer_fee_stroops: u32,
    ) {
        assert_eq!(
            public_inputs.len(),
            verifier::PUBLIC_INPUTS_LEN,
            "public_inputs must be 12 fields"
        );

        let pool_field = BytesN::from_array(env, &Self::field_at(public_inputs, 0));
        let expected_pool = field_bytes_from_u32(env, pool_id);
        assert_eq!(pool_field, expected_pool, "pool_id mismatch in public inputs");

        let amount_field = BytesN::from_array(env, &Self::field_at(public_inputs, 10));
        let join_amount = JOIN_AMOUNTS[pool_id as usize];
        let expected_amount =
            Bn254Fr::from_u256(U256::from_u32(env, join_amount as u32)).to_bytes();
        assert_eq!(
            amount_field, expected_amount,
            "public_amount must match pool join amount"
        );

        let fee_field = BytesN::from_array(env, &Self::field_at(public_inputs, 11));
        let expected_fee =
            Bn254Fr::from_u256(U256::from_u32(env, relayer_fee_stroops)).to_bytes();
        assert_eq!(
            fee_field, expected_fee,
            "relayer_fee mismatch in public inputs"
        );
        assert!(
            (relayer_fee_stroops as i128) <= join_amount,
            "relayer fee exceeds pool amount"
        );

        for i in 6..10 {
            let nc = BytesN::from_array(env, &Self::field_at(public_inputs, i));
            assert!(is_zero_bytes(&nc), "exit must not create shielded outputs");
        }
    }

    fn apply_transfer(
        env: &Env,
        pool_id: u32,
        nullifiers: &[BytesN<32>; MAX_ACTION_SLOTS],
        new_commitments: &[BytesN<32>; MAX_ACTION_SLOTS],
        merkle_root: BytesN<32>,
        public_inputs: Bytes,
        proof_bytes: Bytes,
    ) -> [Option<u32>; MAX_ACTION_SLOTS] {
        assert!(is_valid_pool_id(pool_id), "invalid pool_id");

        for nf in nullifiers {
            mark_nullifier_spent(env, nf);
        }

        if has_active_spend(nullifiers) {
            let min_size: u32 = env
                .storage()
                .instance()
                .get(&DataKey::MinPoolSize)
                .unwrap_or(pool::MIN_POOL_SIZE);
            let count = Self::pool_leaf_count(env.clone(), pool_id);
            assert!(count >= min_size, "pool below min anonymity set size");
        }

        assert_eq!(
            merkle_root,
            Self::get_pool_root(env.clone(), pool_id),
            "stale merkle root"
        );

        let verifier: Address = env.storage().instance().get(&DataKey::Verifier).unwrap();
        verify_transfer_proof(env, &verifier, &public_inputs, &proof_bytes);

        let mut out = [None, None, None, None];
        for i in 0..MAX_ACTION_SLOTS {
            out[i] = Self::insert_commitment(env, pool_id, &new_commitments[i]);
        }
        out
    }

    pub fn build_public_inputs(
        env: Env,
        pool_id: u32,
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
        let pool_id_field = field_bytes_from_u32(&env, pool_id);
        encode_public_inputs(
            &env,
            &pool_id_field,
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
}

mod test;
