use poseidon::poseidon2::Poseidon2;

/// Merkle tree height — must match the Soroban vault contract.
global TREE_HEIGHT: u32 = 16;

/// Mode 0 = shielded send (public_amount must be 0, new note created).
/// Mode 1 = withdraw (public_amount must equal note value).
global MODE_SHIELDED_SEND: Field = 0;
global MODE_WITHDRAW: Field = 1;

fn compute_commitment(value: Field, secret: Field, nullifier_secret: Field) -> Field {
    Poseidon2::hash([value, secret, nullifier_secret], 3)
}

fn compute_nullifier(nullifier_secret: Field, commitment: Field) -> Field {
    Poseidon2::hash([nullifier_secret, commitment], 2)
}

fn hash_pair(left: Field, right: Field) -> Field {
    Poseidon2::hash([left, right], 2)
}

fn verify_merkle_path(
    leaf: Field,
    path: [Field; TREE_HEIGHT],
    indices: [bool; TREE_HEIGHT],
    root: Field,
) {
    let mut current = leaf;
    for i in 0..TREE_HEIGHT {
        if indices[i] {
            current = hash_pair(path[i], current);
        } else {
            current = hash_pair(current, path[i]);
        }
    }
    assert(current == root);
}

fn main(
    value: Field,
    secret: Field,
    nullifier_secret: Field,
    merkle_path: [Field; TREE_HEIGHT],
    path_indices: [bool; TREE_HEIGHT],
    new_value: Field,
    new_secret: Field,
    new_nullifier_secret: Field,
    merkle_root: pub Field,
    nullifier: pub Field,
    new_commitment: pub Field,
    public_amount: pub Field,
    mode: pub Field,
) {
    let commitment = compute_commitment(value, secret, nullifier_secret);
    let computed_nullifier = compute_nullifier(nullifier_secret, commitment);

    assert(computed_nullifier == nullifier);
    verify_merkle_path(commitment, merkle_path, path_indices, merkle_root);

    if mode == MODE_SHIELDED_SEND {
        assert(public_amount == 0);
        let expected_new = compute_commitment(new_value, new_secret, new_nullifier_secret);
        assert(expected_new == new_commitment);
        assert(new_value == value);
    } else if mode == MODE_WITHDRAW {
        assert(public_amount == value);
        assert(new_commitment == 0);
    } else {
        assert(false, "invalid mode");
    }
}

#[test]
fn test_commitment_and_nullifier_consistency() {
    let value = 100;
    let secret = 42;
    let nullifier_secret = 7;

    let commitment = compute_commitment(value, secret, nullifier_secret);
    let nullifier = compute_nullifier(nullifier_secret, commitment);

    assert(nullifier != 0);
    assert(commitment != 0);
}

fn empty_tree_zeros() -> [Field; TREE_HEIGHT] {
    let zero = 0;
    let mut zeros = [zero; TREE_HEIGHT];
    zeros[0] = zero;
    for i in 1..TREE_HEIGHT {
        zeros[i] = hash_pair(zeros[i - 1], zeros[i - 1]);
    }
    zeros
}

/// Merkle root after inserting `leaf` at index 0 into an empty tree (matches Soroban vault).
fn root_for_first_leaf(leaf: Field) -> Field {
    let zeros = empty_tree_zeros();
    let mut current = hash_pair(leaf, zeros[0]);
    for i in 1..TREE_HEIGHT {
        current = hash_pair(current, zeros[i]);
    }
    current
}

fn first_leaf_merkle_witness() -> ([Field; TREE_HEIGHT], [bool; TREE_HEIGHT]) {
    let zeros = empty_tree_zeros();
    let path = zeros;
    let indices = [false; TREE_HEIGHT];
    (path, indices)
}

#[test]
fn test_shielded_send_constraints() {
    let value = 1_000;
    let secret = 11;
    let nullifier_secret = 22;
    let commitment = compute_commitment(value, secret, nullifier_secret);
    let nullifier = compute_nullifier(nullifier_secret, commitment);

    let new_secret = 33;
    let new_nullifier_secret = 44;
    let new_commitment = compute_commitment(value, new_secret, new_nullifier_secret);

    let (path, indices) = first_leaf_merkle_witness();
    let root = root_for_first_leaf(commitment);

    main(
        value,
        secret,
        nullifier_secret,
        path,
        indices,
        value,
        new_secret,
        new_nullifier_secret,
        root,
        nullifier,
        new_commitment,
        0,
        MODE_SHIELDED_SEND,
    );
}

#[test]
fn test_withdraw_constraints() {
    let value = 500;
    let secret = 5;
    let nullifier_secret = 9;
    let commitment = compute_commitment(value, secret, nullifier_secret);
    let nullifier = compute_nullifier(nullifier_secret, commitment);

    let (path, indices) = first_leaf_merkle_witness();
    let root = root_for_first_leaf(commitment);

    main(
        value,
        secret,
        nullifier_secret,
        path,
        indices,
        0,
        0,
        0,
        root,
        nullifier,
        0,
        value,
        MODE_WITHDRAW,
    );
}
