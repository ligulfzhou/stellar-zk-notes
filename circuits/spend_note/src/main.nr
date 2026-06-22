use poseidon::poseidon2::Poseidon2;

/// Merkle tree height - must match the Soroban vault contract.
global TREE_HEIGHT: u32 = 16;

/// Mode 0 = shielded send 1-in-1-out (legacy).
/// Mode 1 = withdraw 1-in.
/// Mode 2 = shielded send 2-in-2-out (payee + change or split).
global MODE_SHIELDED_SEND_1: Field = 0;
global MODE_WITHDRAW: Field = 1;
global MODE_SHIELDED_SEND_2: Field = 2;

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
    value0: Field,
    secret0: Field,
    nullifier_secret0: Field,
    merkle_path0: [Field; TREE_HEIGHT],
    path_indices0: [bool; TREE_HEIGHT],
    value1: Field,
    secret1: Field,
    nullifier_secret1: Field,
    merkle_path1: [Field; TREE_HEIGHT],
    path_indices1: [bool; TREE_HEIGHT],
    out0_value: Field,
    out0_secret: Field,
    out0_nullifier_secret: Field,
    out1_value: Field,
    out1_secret: Field,
    out1_nullifier_secret: Field,
    merkle_root: pub Field,
    nullifier0: pub Field,
    nullifier1: pub Field,
    new_commitment0: pub Field,
    new_commitment1: pub Field,
    public_amount: pub Field,
    mode: pub Field,
) {
    let commitment0 = compute_commitment(value0, secret0, nullifier_secret0);
    let computed_nullifier0 = compute_nullifier(nullifier_secret0, commitment0);
    assert(computed_nullifier0 == nullifier0);
    verify_merkle_path(commitment0, merkle_path0, path_indices0, merkle_root);

    if mode == MODE_SHIELDED_SEND_2 {
        let commitment1 = compute_commitment(value1, secret1, nullifier_secret1);
        let computed_nullifier1 = compute_nullifier(nullifier_secret1, commitment1);
        assert(computed_nullifier1 == nullifier1);
        verify_merkle_path(commitment1, merkle_path1, path_indices1, merkle_root);

        assert(public_amount == 0);
        assert(value0 + value1 == out0_value + out1_value);

        let expected_out0 =
            compute_commitment(out0_value, out0_secret, out0_nullifier_secret);
        let expected_out1 =
            compute_commitment(out1_value, out1_secret, out1_nullifier_secret);
        assert(expected_out0 == new_commitment0);
        assert(expected_out1 == new_commitment1);
    } else if mode == MODE_SHIELDED_SEND_1 {
        assert(nullifier1 == 0);
        assert(new_commitment1 == 0);
        assert(value1 == 0);
        assert(out1_value == 0);
        assert(public_amount == 0);

        let expected_out0 =
            compute_commitment(out0_value, out0_secret, out0_nullifier_secret);
        assert(expected_out0 == new_commitment0);
        assert(out0_value == value0);
    } else if mode == MODE_WITHDRAW {
        assert(nullifier1 == 0);
        assert(new_commitment0 == 0);
        assert(new_commitment1 == 0);
        assert(value1 == 0);
        assert(public_amount == value0);
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
    (zeros, [false; TREE_HEIGHT])
}

/// First leaf witness when a second leaf exists at index 1.
fn first_leaf_merkle_witness_with_sibling(sibling: Field) -> ([Field; TREE_HEIGHT], [bool; TREE_HEIGHT]) {
    let zeros = empty_tree_zeros();
    let mut path = zeros;
    path[0] = sibling;
    (path, [false; TREE_HEIGHT])
}

/// Second leaf witness when first leaf is at index 0.
fn second_leaf_merkle_witness(first_leaf: Field) -> ([Field; TREE_HEIGHT], [bool; TREE_HEIGHT]) {
    let zeros = empty_tree_zeros();
    let mut path = zeros;
    path[0] = first_leaf;
    let mut indices = [false; TREE_HEIGHT];
    indices[0] = true;
    (path, indices)
}

fn root_for_two_leaves(left: Field, right: Field) -> Field {
    let zeros = empty_tree_zeros();
    let mut current = hash_pair(left, right);
    for i in 1..TREE_HEIGHT {
        current = hash_pair(current, zeros[i]);
    }
    current
}

#[test]
fn test_shielded_send_1x1_constraints() {
    let value = 1_000;
    let secret = 11;
    let nullifier_secret = 22;
    let commitment = compute_commitment(value, secret, nullifier_secret);
    let nullifier = compute_nullifier(nullifier_secret, commitment);

    let out_secret = 33;
    let out_nullifier_secret = 44;
    let new_commitment = compute_commitment(value, out_secret, out_nullifier_secret);

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
        [0; TREE_HEIGHT],
        [false; TREE_HEIGHT],
        value,
        out_secret,
        out_nullifier_secret,
        0,
        0,
        0,
        root,
        nullifier,
        0,
        new_commitment,
        0,
        0,
        MODE_SHIELDED_SEND_1,
    );
}

#[test]
fn test_shielded_send_2x2_constraints() {
    let v0 = 600;
    let s0 = 11;
    let ns0 = 22;
    let c0 = compute_commitment(v0, s0, ns0);
    let nf0 = compute_nullifier(ns0, c0);

    let v1 = 400;
    let s1 = 33;
    let ns1 = 44;
    let c1 = compute_commitment(v1, s1, ns1);
    let nf1 = compute_nullifier(ns1, c1);

    let payee = 700;
    let change = 300;
    let out0s = 55;
    let out0ns = 66;
    let out1s = 77;
    let out1ns = 88;
    let nc0 = compute_commitment(payee, out0s, out0ns);
    let nc1 = compute_commitment(change, out1s, out1ns);

    let (path0, idx0) = first_leaf_merkle_witness_with_sibling(c1);
    let (path1, idx1) = second_leaf_merkle_witness(c0);
    let root = root_for_two_leaves(c0, c1);

    main(
        v0,
        s0,
        ns0,
        path0,
        idx0,
        v1,
        s1,
        ns1,
        path1,
        idx1,
        payee,
        out0s,
        out0ns,
        change,
        out1s,
        out1ns,
        root,
        nf0,
        nf1,
        nc0,
        nc1,
        0,
        MODE_SHIELDED_SEND_2,
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
        [0; TREE_HEIGHT],
        [false; TREE_HEIGHT],
        0,
        0,
        0,
        0,
        0,
        0,
        root,
        nullifier,
        0,
        0,
        0,
        value,
        MODE_WITHDRAW,
    );
}
