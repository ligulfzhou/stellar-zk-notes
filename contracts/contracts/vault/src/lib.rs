#![no_std]

mod merkle;
mod storage;
mod verifier;

use merkle::MerkleTree;
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, crypto::bn254::Bn254Fr, token, Address,
    Bytes, BytesN, Env,
};
use storage::DataKey;
use verifier::{encode_public_inputs, verify_spend_proof};

pub const MODE_SHIELDED_SEND: u32 = 0;
pub const MODE_WITHDRAW: u32 = 1;

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
    /// X25519 ephemeral public key for encrypted note delivery.
    pub epk: BytesN<32>,
    /// AES-GCM ciphertext (chain stores, does not decrypt).
    pub encrypted_note: Bytes,
}

#[contractevent]
pub struct WithdrawEvent {
    pub recipient: Address,
    pub nullifier: BytesN<32>,
    pub amount: i128,
}

#[contract]
pub struct Vault;

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
        env.storage().instance().set(&DataKey::MerkleTree, &tree);

        DepositEvent {
            depositor: from,
            commitment,
            leaf_index,
            amount,
        }
        .publish(&env);
    }

    /// Spend a note privately: record nullifier and append recipient commitment.
    pub fn shielded_send(
        env: Env,
        nullifier: BytesN<32>,
        new_commitment: BytesN<32>,
        merkle_root: BytesN<32>,
        public_inputs: Bytes,
        proof_bytes: Bytes,
        epk: BytesN<32>,
        encrypted_note: Bytes,
    ) {
        assert!(encrypted_note.len() <= 512, "encrypted_note too large");
        let event_nullifier = nullifier.clone();
        let event_commitment = new_commitment.clone();
        let event_epk = epk.clone();
        let event_encrypted = encrypted_note.clone();
        let leaf_index = Self::spend_note(
            &env,
            nullifier,
            new_commitment,
            merkle_root,
            public_inputs,
            proof_bytes,
            MODE_SHIELDED_SEND,
            None,
            0,
        )
        .expect("shielded send must insert leaf");

        ShieldedSendEvent {
            nullifier: event_nullifier,
            new_commitment: event_commitment,
            leaf_index,
            epk: event_epk,
            encrypted_note: event_encrypted,
        }
        .publish(&env);
    }

    /// Withdraw note value to a public Stellar address.
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
        Self::spend_note(
            &env,
            nullifier,
            BytesN::from_array(&env, &[0u8; 32]),
            merkle_root,
            public_inputs,
            proof_bytes,
            MODE_WITHDRAW,
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

    pub fn is_spent(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Nullifier(nullifier))
            .unwrap_or(false)
    }

    fn spend_note(
        env: &Env,
        nullifier: BytesN<32>,
        new_commitment: BytesN<32>,
        merkle_root: BytesN<32>,
        public_inputs: Bytes,
        proof_bytes: Bytes,
        mode: u32,
        withdraw_to: Option<Address>,
        withdraw_amount: i128,
    ) -> Option<u32> {
        let spent: bool = env
            .storage()
            .persistent()
            .get(&DataKey::Nullifier(nullifier.clone()))
            .unwrap_or(false);
        assert!(!spent, "nullifier spent");
        assert_eq!(merkle_root, Self::get_root(env.clone()), "stale merkle root");

        let verifier: Address = env.storage().instance().get(&DataKey::Verifier).unwrap();
        verify_spend_proof(env, &verifier, &public_inputs, &proof_bytes);

        env.storage()
            .persistent()
            .set(&DataKey::Nullifier(nullifier.clone()), &true);

        if mode == MODE_SHIELDED_SEND {
            let mut tree: MerkleTree = env.storage().instance().get(&DataKey::MerkleTree).unwrap();
            let leaf = Bn254Fr::from_bytes(new_commitment.clone());
            let leaf_index = tree.insert(env, leaf);
            env.storage().instance().set(&DataKey::MerkleTree, &tree);
            Some(leaf_index)
        } else if mode == MODE_WITHDRAW {
            let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
            let vault_addr = env.current_contract_address();
            let recipient = withdraw_to.expect("withdraw recipient required");
            let token_client = token::Client::new(env, &token_addr);
            token_client.transfer(&vault_addr, &recipient, &withdraw_amount);
            None
        } else {
            panic!("invalid spend mode");
        }
    }

    /// Helper for clients building `public_inputs` bytes for the verifier.
    pub fn build_public_inputs(
        env: Env,
        merkle_root: BytesN<32>,
        nullifier: BytesN<32>,
        new_commitment: BytesN<32>,
        public_amount: BytesN<32>,
        mode: BytesN<32>,
    ) -> Bytes {
        encode_public_inputs(
            &env,
            &merkle_root,
            &nullifier,
            &new_commitment,
            &public_amount,
            &mode,
        )
    }
}

mod test;
