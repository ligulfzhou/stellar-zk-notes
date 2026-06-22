use soroban_sdk::{contracttype, Address, BytesN};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    MerkleTree,
    Nullifier(BytesN<32>),
    Verifier,
    LeafCommitment(u32),
    /// G… account → X25519 receive public key (32 bytes).
    ShieldedKey(Address),
}
