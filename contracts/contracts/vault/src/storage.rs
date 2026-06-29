use soroban_sdk::{contracttype, BytesN};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    Nullifier(BytesN<32>),
    Verifier,
    /// Single global Merkle tree.
    Tree,
    LeafCommitment(u32),
}
