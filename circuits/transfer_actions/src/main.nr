use poseidon::poseidon2::Poseidon2;

/// Merkle tree height - must match the Soroban vault contract.
global TREE_HEIGHT: u32 = 16;

/// Maximum spend (input) action slots - padded with zeros when unused.
global MAX_SPENDS: u32 = 4;

/// Maximum output action slots - padded with zeros when unused.
global MAX_OUTPUTS: u32 = 4;

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

fn verify_spend_slot(
    nullifier: Field,
    value: Field,
    secret: Field,
    nullifier_secret: Field,
    merkle_path: [Field; TREE_HEIGHT],
    path_indices: [bool; TREE_HEIGHT],
    merkle_root: Field,
) {
    if nullifier != 0 {
        let commitment = compute_commitment(value, secret, nullifier_secret);
        let computed_nullifier = compute_nullifier(nullifier_secret, commitment);
        assert(computed_nullifier == nullifier);
        verify_merkle_path(commitment, merkle_path, path_indices, merkle_root);
    } else {
        assert(value == 0);
    }
}

fn verify_output_slot(
    new_commitment: Field,
    out_value: Field,
    out_secret: Field,
    out_nullifier_secret: Field,
) {
    if new_commitment != 0 {
        let expected = compute_commitment(out_value, out_secret, out_nullifier_secret);
        assert(expected == new_commitment);
    } else {
        assert(out_value == 0);
    }
}

/// Action-bundle transfer: up to MAX_SPENDS inputs and MAX_OUTPUTS shielded outputs.
/// Balance: sum(spend_value) == sum(out_value) + public_amount.
/// Unused slots have nullifier=0 / new_commitment=0 (public) and zero private witnesses.
fn main(
    spend_value: [Field; MAX_SPENDS],
    spend_secret: [Field; MAX_SPENDS],
    spend_nullifier_secret: [Field; MAX_SPENDS],
    spend_merkle_path: [[Field; TREE_HEIGHT]; MAX_SPENDS],
    spend_path_indices: [[bool; TREE_HEIGHT]; MAX_SPENDS],
    out_value: [Field; MAX_OUTPUTS],
    out_secret: [Field; MAX_OUTPUTS],
    out_nullifier_secret: [Field; MAX_OUTPUTS],
    merkle_root: pub Field,
    nullifier: pub [Field; MAX_SPENDS],
    new_commitment: pub [Field; MAX_OUTPUTS],
    public_amount: pub Field,
) {
    let mut spend_sum = 0;
    for i in 0..MAX_SPENDS {
        verify_spend_slot(
            nullifier[i],
            spend_value[i],
            spend_secret[i],
            spend_nullifier_secret[i],
            spend_merkle_path[i],
            spend_path_indices[i],
            merkle_root,
        );
        spend_sum += spend_value[i];
    }

    let mut out_sum = 0;
    for j in 0..MAX_OUTPUTS {
        verify_output_slot(
            new_commitment[j],
            out_value[j],
            out_secret[j],
            out_nullifier_secret[j],
        );
        out_sum += out_value[j];
    }

    assert(spend_sum == out_sum + public_amount);
}

// Test helpers

fn empty_tree_zeros() -> [Field; TREE_HEIGHT] {
    let zero = 0;
    let mut zeros = [zero; TREE_HEIGHT];
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

fn first_leaf_merkle_witness_with_sibling(sibling: Field) -> ([Field; TREE_HEIGHT], [bool; TREE_HEIGHT]) {
    let zeros = empty_tree_zeros();
    let mut path = zeros;
    path[0] = sibling;
    (path, [false; TREE_HEIGHT])
}

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

fn zero_spend_paths() -> ([[Field; TREE_HEIGHT]; MAX_SPENDS], [[bool; TREE_HEIGHT]; MAX_SPENDS]) {
    let empty_path = [0; TREE_HEIGHT];
    let empty_idx = [false; TREE_HEIGHT];
    (
        [empty_path, empty_path, empty_path, empty_path],
        [empty_idx, empty_idx, empty_idx, empty_idx],
    )
}

fn invoke_transfer(
    spend_value: [Field; MAX_SPENDS],
    spend_secret: [Field; MAX_SPENDS],
    spend_nullifier_secret: [Field; MAX_SPENDS],
    spend_merkle_path: [[Field; TREE_HEIGHT]; MAX_SPENDS],
    spend_path_indices: [[bool; TREE_HEIGHT]; MAX_SPENDS],
    out_value: [Field; MAX_OUTPUTS],
    out_secret: [Field; MAX_OUTPUTS],
    out_nullifier_secret: [Field; MAX_OUTPUTS],
    merkle_root: Field,
    nullifier: [Field; MAX_SPENDS],
    new_commitment: [Field; MAX_OUTPUTS],
    public_amount: Field,
) {
    main(
        spend_value,
        spend_secret,
        spend_nullifier_secret,
        spend_merkle_path,
        spend_path_indices,
        out_value,
        out_secret,
        out_nullifier_secret,
        merkle_root,
        nullifier,
        new_commitment,
        public_amount,
    );
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

#[test]
fn test_shielded_send_1x1_via_actions() {
    let value = 1_000;
    let secret = 11;
    let ns = 22;
    let c = compute_commitment(value, secret, ns);
    let nf = compute_nullifier(ns, c);

    let out_s = 33;
    let out_ns = 44;
    let nc = compute_commitment(value, out_s, out_ns);

    let (path, idx) = first_leaf_merkle_witness();
    let root = root_for_first_leaf(c);
    let (zero_paths, zero_idx) = zero_spend_paths();

    let mut paths = zero_paths;
    paths[0] = path;
    let mut indices = zero_idx;
    indices[0] = idx;

    invoke_transfer(
        [value, 0, 0, 0],
        [secret, 0, 0, 0],
        [ns, 0, 0, 0],
        paths,
        indices,
        [value, 0, 0, 0],
        [out_s, 0, 0, 0],
        [out_ns, 0, 0, 0],
        root,
        [nf, 0, 0, 0],
        [nc, 0, 0, 0],
        0,
    );
}

#[test]
fn test_withdraw_via_actions() {
    let value = 500;
    let secret = 5;
    let ns = 9;
    let c = compute_commitment(value, secret, ns);
    let nf = compute_nullifier(ns, c);

    let (path, idx) = first_leaf_merkle_witness();
    let root = root_for_first_leaf(c);
    let (zero_paths, zero_idx) = zero_spend_paths();

    let mut paths = zero_paths;
    paths[0] = path;
    let mut indices = zero_idx;
    indices[0] = idx;

    invoke_transfer(
        [value, 0, 0, 0],
        [secret, 0, 0, 0],
        [ns, 0, 0, 0],
        paths,
        indices,
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        root,
        [nf, 0, 0, 0],
        [0, 0, 0, 0],
        value,
    );
}

#[test]
fn test_shielded_send_2x2_via_actions() {
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

    invoke_transfer(
        [v0, v1, 0, 0],
        [s0, s1, 0, 0],
        [ns0, ns1, 0, 0],
        [path0, path1, [0; TREE_HEIGHT], [0; TREE_HEIGHT]],
        [idx0, idx1, [false; TREE_HEIGHT], [false; TREE_HEIGHT]],
        [payee, change, 0, 0],
        [out0s, out1s, 0, 0],
        [out0ns, out1ns, 0, 0],
        root,
        [nf0, nf1, 0, 0],
        [nc0, nc1, 0, 0],
        0,
    );
}

#[test]
fn test_4_in_2_out_via_actions() {
    let v0 = 100;
    let v1 = 200;
    let v2 = 150;
    let v3 = 50;
    let total = 500;
    let payee = 350;
    let change = 150;

    let s0 = 1;
    let ns0 = 2;
    let c0 = compute_commitment(v0, s0, ns0);
    let nf0 = compute_nullifier(ns0, c0);

    let s1 = 3;
    let ns1 = 4;
    let c1 = compute_commitment(v1, s1, ns1);
    let nf1 = compute_nullifier(ns1, c1);

    let s2 = 5;
    let ns2 = 6;
    let c2 = compute_commitment(v2, s2, ns2);
    let nf2 = compute_nullifier(ns2, c2);

    let s3 = 7;
    let ns3 = 8;
    let c3 = compute_commitment(v3, s3, ns3);
    let nf3 = compute_nullifier(ns3, c3);

    assert(v0 + v1 + v2 + v3 == total);
    assert(payee + change == total);

    // Four-leaf tree: leaves at indices 0..3 in order.
    let zeros = empty_tree_zeros();
    let l01 = hash_pair(c0, c1);
    let l23 = hash_pair(c2, c3);
    let l0123 = hash_pair(l01, l23);
    let mut root = l0123;
    for i in 2..TREE_HEIGHT {
        root = hash_pair(root, zeros[i]);
    }

    // Leaf 0: sibling c1 at level 0, then l23 subtree
    let mut path0 = zeros;
    path0[0] = c1;
    path0[1] = l23;
    let mut idx0 = [false; TREE_HEIGHT];
    idx0[0] = false;

    // Leaf 1: sibling c0, right child at level 0
    let mut path1 = zeros;
    path1[0] = c0;
    path1[1] = l23;
    let mut idx1 = [false; TREE_HEIGHT];
    idx1[0] = true;

    // Leaf 2: index 10 - left at L0 (sibling c3), right at L1 (sibling l01)
    let mut path2 = zeros;
    path2[0] = c3;
    path2[1] = l01;
    let mut idx2 = [false; TREE_HEIGHT];
    idx2[0] = false;
    idx2[1] = true;

    // Leaf 3: index 11 - right at L0 (sibling c2), right at L1 (sibling l01)
    let mut path3 = zeros;
    path3[0] = c2;
    path3[1] = l01;
    let mut idx3 = [false; TREE_HEIGHT];
    idx3[0] = true;
    idx3[1] = true;

    let out0s = 10;
    let out0ns = 11;
    let out1s = 12;
    let out1ns = 13;
    let nc0 = compute_commitment(payee, out0s, out0ns);
    let nc1 = compute_commitment(change, out1s, out1ns);

    invoke_transfer(
        [v0, v1, v2, v3],
        [s0, s1, s2, s3],
        [ns0, ns1, ns2, ns3],
        [path0, path1, path2, path3],
        [idx0, idx1, idx2, idx3],
        [payee, change, 0, 0],
        [out0s, out1s, 0, 0],
        [out0ns, out1ns, 0, 0],
        root,
        [nf0, nf1, nf2, nf3],
        [nc0, nc1, 0, 0],
        0,
    );
}

#[test]
fn test_max_4x4_padding_stress() {
    let v = 100;
    let s = 1;
    let ns = 2;
    let c = compute_commitment(v, s, ns);
    let nf = compute_nullifier(ns, c);
    let out_s = 3;
    let out_ns = 4;
    let nc = compute_commitment(v, out_s, out_ns);

    let (path, idx) = first_leaf_merkle_witness();
    let root = root_for_first_leaf(c);

    invoke_transfer(
        [v, 0, 0, 0],
        [s, 0, 0, 0],
        [ns, 0, 0, 0],
        [path, [0; TREE_HEIGHT], [0; TREE_HEIGHT], [0; TREE_HEIGHT]],
        [idx, [false; TREE_HEIGHT], [false; TREE_HEIGHT], [false; TREE_HEIGHT]],
        [v, 0, 0, 0],
        [out_s, 0, 0, 0],
        [out_ns, 0, 0, 0],
        root,
        [nf, 0, 0, 0],
        [nc, 0, 0, 0],
        0,
    );
}
