use soroban_sdk::{contracttype, BytesN};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    MerkleTree,
    Nullifier(BytesN<32>),
    Verifier,
}
