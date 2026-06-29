use soroban_poseidon::poseidon2_hash;
use soroban_sdk::{contracttype, crypto::bn254::Bn254Fr, vec, BytesN, Env, Vec, U256};

/// Merkle tree height — must match the Noir circuit (`TREE_HEIGHT`).
pub const TREE_HEIGHT: u32 = 16;
pub const MAX_LEAVES: u32 = 1 << TREE_HEIGHT;

fn fr_from_bytes(bytes: &BytesN<32>) -> Bn254Fr {
    Bn254Fr::from_bytes(bytes.clone())
}

fn fr_to_bytes(fr: &Bn254Fr) -> BytesN<32> {
    fr.to_bytes()
}

/// Hash two BN254 field elements with Poseidon2 (matches Noir `Poseidon2::hash([a,b], 2)`).
pub fn hash_pair(env: &Env, left: &Bn254Fr, right: &Bn254Fr) -> Bn254Fr {
    let inputs = vec![env, left.to_u256(), right.to_u256()];
    let hash = poseidon2_hash::<4, Bn254Fr>(env, &inputs);
    Bn254Fr::from_u256(hash)
}

/// Compute Merkle root from a leaf and sibling path.
pub fn compute_root(
    env: &Env,
    leaf: &Bn254Fr,
    path: &[Bn254Fr; TREE_HEIGHT as usize],
    indices: &[bool; TREE_HEIGHT as usize],
) -> Bn254Fr {
    let mut current = leaf.clone();
    for i in 0..TREE_HEIGHT as usize {
        current = if indices[i] {
            hash_pair(env, &path[i], &current)
        } else {
            hash_pair(env, &current, &path[i])
        };
    }
    current
}

/// Incremental Merkle tree (circomlib-style). Field elements stored as `BytesN<32>`.
#[contracttype]
#[derive(Clone)]
pub struct MerkleTree {
    pub leaf_count: u32,
    pub zeros: Vec<BytesN<32>>,
    pub filled: Vec<BytesN<32>>,
}

impl MerkleTree {
    fn read_fr(_env: &Env, levels: &Vec<BytesN<32>>, index: usize) -> Bn254Fr {
        fr_from_bytes(&levels.get(index as u32).unwrap())
    }

    fn write_fr(_env: &Env, levels: &mut Vec<BytesN<32>>, index: usize, value: Bn254Fr) {
        levels.set(index as u32, fr_to_bytes(&value));
    }

    pub fn empty(env: &Env) -> Self {
        let zero = Bn254Fr::from_u256(U256::from_u32(env, 0));
        let mut zeros_vec = Vec::new(env);
        let mut filled_vec = Vec::new(env);
        let mut level = zero.clone();
        for _ in 0..TREE_HEIGHT {
            zeros_vec.push_back(fr_to_bytes(&level));
            filled_vec.push_back(fr_to_bytes(&level));
            level = hash_pair(env, &level, &level);
        }
        Self {
            leaf_count: 0,
            zeros: zeros_vec,
            filled: filled_vec,
        }
    }

    pub fn root(&self, env: &Env) -> Bn254Fr {
        let mut hash = Self::read_fr(env, &self.zeros, 0);
        for i in 0..TREE_HEIGHT as usize {
            if (self.leaf_count >> i) & 1 == 1 {
                let filled = Self::read_fr(env, &self.filled, i);
                hash = hash_pair(env, &filled, &hash);
            } else {
                let zero = Self::read_fr(env, &self.zeros, i);
                hash = hash_pair(env, &hash, &zero);
            }
        }
        hash
    }

    pub fn insert(&mut self, env: &Env, leaf: Bn254Fr) -> u32 {
        assert!(self.leaf_count < MAX_LEAVES, "merkle tree full");
        let index = self.leaf_count;
        let mut current_index = index;
        let mut current_hash = leaf;
        for i in 0..TREE_HEIGHT as usize {
            if current_index % 2 == 0 {
                Self::write_fr(env, &mut self.filled, i, current_hash.clone());
                let zero = Self::read_fr(env, &self.zeros, i);
                current_hash = hash_pair(env, &current_hash, &zero);
            } else {
                let filled = Self::read_fr(env, &self.filled, i);
                current_hash = hash_pair(env, &filled, &current_hash);
            }
            current_index /= 2;
        }
        self.leaf_count += 1;
        index
    }
}
