use soroban_sdk::{contracttype, Address, BytesN};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    Nullifier(BytesN<32>),
    Verifier,
    /// Per-denomination Merkle tree (pool_id 0..POOL_COUNT-1).
    PoolTree(u32),
    PoolLeafCommitment(u32, u32),
    MinPoolSize,
    /// G… account → X25519 receive public key (32 bytes).
    ShieldedKey(Address),
}
