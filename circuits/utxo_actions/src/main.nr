use poseidon::poseidon2::Poseidon2;

/// Merkle tree height - must match the Soroban vault contract.
global TREE_HEIGHT: u32 = 16;

/// Maximum spend (input) action slots - padded with zeros when unused.
global MAX_SPENDS: u32 = 4;

/// Maximum output action slots - padded with zeros when unused.
global MAX_OUTPUTS: u32 = 4;

global DOMAIN_SPENDING_PK: Field = 1;
global DOMAIN_NULLIFIER_KEY: Field = 2;

fn derive_spending_pk(spending_sk: Field) -> Field {
    Poseidon2::hash([spending_sk, DOMAIN_SPENDING_PK], 2)
}

fn derive_nullifier_key(spending_sk: Field) -> Field {
    Poseidon2::hash([spending_sk, DOMAIN_NULLIFIER_KEY], 2)
}

fn compute_commitment(value: Field, note_randomness: Field, spending_pk: Field) -> Field {
    Poseidon2::hash([value, note_randomness, spending_pk], 3)
}

fn compute_nullifier(spending_sk: Field, value: Field, note_randomness: Field) -> Field {
    let spending_pk = derive_spending_pk(spending_sk);
    let nk = derive_nullifier_key(spending_sk);
    let commitment = compute_commitment(value, note_randomness, spending_pk);
    Poseidon2::hash([nk, commitment], 2)
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
    note_randomness: Field,
    spending_sk: Field,
    merkle_path: [Field; TREE_HEIGHT],
    path_indices: [bool; TREE_HEIGHT],
    merkle_root: Field,
) {
    if nullifier != 0 {
        let spending_pk = derive_spending_pk(spending_sk);
        let commitment = compute_commitment(value, note_randomness, spending_pk);
        let computed_nullifier = compute_nullifier(spending_sk, value, note_randomness);
        assert(computed_nullifier == nullifier);
        verify_merkle_path(commitment, merkle_path, path_indices, merkle_root);
    } else {
        assert(value == 0);
    }
}

fn verify_output_slot(
    new_commitment: Field,
    out_value: Field,
    out_note_randomness: Field,
    out_recipient_pk: Field,
) {
    if new_commitment != 0 {
        let expected = compute_commitment(out_value, out_note_randomness, out_recipient_pk);
        assert(expected == new_commitment);
    } else {
        assert(out_value == 0);
    }
}

/// Sapling-style UTXO actions: spend requires owner spending_sk; outputs only need recipient_pk + rcm.
fn main(
    spend_value: [Field; MAX_SPENDS],
    spend_note_randomness: [Field; MAX_SPENDS],
    spend_spending_sk: [Field; MAX_SPENDS],
    spend_merkle_path: [[Field; TREE_HEIGHT]; MAX_SPENDS],
    spend_path_indices: [[bool; TREE_HEIGHT]; MAX_SPENDS],
    out_value: [Field; MAX_OUTPUTS],
    out_note_randomness: [Field; MAX_OUTPUTS],
    out_recipient_pk: [Field; MAX_OUTPUTS],
    merkle_root: pub Field,
    nullifier: pub [Field; MAX_SPENDS],
    new_commitment: pub [Field; MAX_OUTPUTS],
    public_amount: pub Field,
    relayer_fee: pub Field,
) {
    let mut spend_sum = 0;
    for i in 0..MAX_SPENDS {
        verify_spend_slot(
            nullifier[i],
            spend_value[i],
            spend_note_randomness[i],
            spend_spending_sk[i],
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
            out_note_randomness[j],
            out_recipient_pk[j],
        );
        out_sum += out_value[j];
    }

    assert(spend_sum == out_sum + public_amount);

    if public_amount != 0 {
        assert(relayer_fee as u64 <= public_amount as u64);
        for j in 0..MAX_OUTPUTS {
            assert(new_commitment[j] == 0);
        }
    } else {
        assert(relayer_fee == 0);
    }
}

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
    spend_note_randomness: [Field; MAX_SPENDS],
    spend_spending_sk: [Field; MAX_SPENDS],
    spend_merkle_path: [[Field; TREE_HEIGHT]; MAX_SPENDS],
    spend_path_indices: [[bool; TREE_HEIGHT]; MAX_SPENDS],
    out_value: [Field; MAX_OUTPUTS],
    out_note_randomness: [Field; MAX_OUTPUTS],
    out_recipient_pk: [Field; MAX_OUTPUTS],
    merkle_root: Field,
    nullifier: [Field; MAX_SPENDS],
    new_commitment: [Field; MAX_OUTPUTS],
    public_amount: Field,
    relayer_fee: Field,
) {
    main(
        spend_value,
        spend_note_randomness,
        spend_spending_sk,
        spend_merkle_path,
        spend_path_indices,
        out_value,
        out_note_randomness,
        out_recipient_pk,
        merkle_root,
        nullifier,
        new_commitment,
        public_amount,
        relayer_fee,
    );
}

#[test]
fn test_commitment_and_nullifier_consistency() {
    let sk = 42;
    let value = 100;
    let rcm = 7;
    let pk = derive_spending_pk(sk);
    let commitment = compute_commitment(value, rcm, pk);
    let nullifier = compute_nullifier(sk, value, rcm);
    assert(nullifier != 0);
    assert(commitment != 0);
}

#[test]
fn test_shielded_send_payee_output_without_payee_sk() {
    let alice_sk = 11;
    let alice_pk = derive_spending_pk(alice_sk);
    let value = 1_000;
    let alice_rcm = 22;
    let c = compute_commitment(value, alice_rcm, alice_pk);
    let nf = compute_nullifier(alice_sk, value, alice_rcm);

    let bob_pk = derive_spending_pk(777);
    let payee_rcm = 33;
    let nc = compute_commitment(value, payee_rcm, bob_pk);

    let (path, idx) = first_leaf_merkle_witness();
    let root = root_for_first_leaf(c);
    let (zero_paths, zero_idx) = zero_spend_paths();

    let mut paths = zero_paths;
    paths[0] = path;
    let mut indices = zero_idx;
    indices[0] = idx;

    invoke_transfer(
        [value, 0, 0, 0],
        [alice_rcm, 0, 0, 0],
        [alice_sk, 0, 0, 0],
        paths,
        indices,
        [value, 0, 0, 0],
        [payee_rcm, 0, 0, 0],
        [bob_pk, 0, 0, 0],
        root,
        [nf, 0, 0, 0],
        [nc, 0, 0, 0],
        0,
        0,
    );
}

#[test]
fn test_withdraw_via_actions() {
    let sk = 5;
    let pk = derive_spending_pk(sk);
    let value = 500;
    let rcm = 9;
    let c = compute_commitment(value, rcm, pk);
    let nf = compute_nullifier(sk, value, rcm);

    let (path, idx) = first_leaf_merkle_witness();
    let root = root_for_first_leaf(c);
    let (zero_paths, zero_idx) = zero_spend_paths();

    let mut paths = zero_paths;
    paths[0] = path;
    let mut indices = zero_idx;
    indices[0] = idx;

    invoke_transfer(
        [value, 0, 0, 0],
        [rcm, 0, 0, 0],
        [sk, 0, 0, 0],
        paths,
        indices,
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        root,
        [nf, 0, 0, 0],
        [0, 0, 0, 0],
        value,
        0,
    );
}

#[test]
fn test_relayer_exit_via_actions() {
    let sk = 5;
    let pk = derive_spending_pk(sk);
    let value = 1_000_000;
    let fee = 10_000;
    let rcm = 9;
    let c = compute_commitment(value, rcm, pk);
    let nf = compute_nullifier(sk, value, rcm);

    let (path, idx) = first_leaf_merkle_witness();
    let root = root_for_first_leaf(c);
    let (zero_paths, zero_idx) = zero_spend_paths();

    let mut paths = zero_paths;
    paths[0] = path;
    let mut indices = zero_idx;
    indices[0] = idx;

    invoke_transfer(
        [value, 0, 0, 0],
        [rcm, 0, 0, 0],
        [sk, 0, 0, 0],
        paths,
        indices,
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        root,
        [nf, 0, 0, 0],
        [0, 0, 0, 0],
        value,
        fee,
    );
}

#[test]
fn test_shielded_send_2x2_via_actions() {
    let sk0 = 11;
    let pk0 = derive_spending_pk(sk0);
    let v0 = 600;
    let rcm0 = 22;
    let c0 = compute_commitment(v0, rcm0, pk0);
    let nf0 = compute_nullifier(sk0, v0, rcm0);

    let sk1 = 33;
    let pk1 = derive_spending_pk(sk1);
    let v1 = 400;
    let rcm1 = 44;
    let c1 = compute_commitment(v1, rcm1, pk1);
    let nf1 = compute_nullifier(sk1, v1, rcm1);

    let bob_pk = derive_spending_pk(999);
    let payee = 700;
    let change = 300;
    let payee_rcm = 55;
    let change_rcm = 77;
    let nc0 = compute_commitment(payee, payee_rcm, bob_pk);
    let nc1 = compute_commitment(change, change_rcm, pk0);

    let (path0, idx0) = first_leaf_merkle_witness_with_sibling(c1);
    let (path1, idx1) = second_leaf_merkle_witness(c0);
    let root = root_for_two_leaves(c0, c1);

    invoke_transfer(
        [v0, v1, 0, 0],
        [rcm0, rcm1, 0, 0],
        [sk0, sk1, 0, 0],
        [path0, path1, [0; TREE_HEIGHT], [0; TREE_HEIGHT]],
        [idx0, idx1, [false; TREE_HEIGHT], [false; TREE_HEIGHT]],
        [payee, change, 0, 0],
        [payee_rcm, change_rcm, 0, 0],
        [bob_pk, pk0, 0, 0],
        root,
        [nf0, nf1, 0, 0],
        [nc0, nc1, 0, 0],
        0,
        0,
    );
}

#[test]
fn test_4_in_2_out_via_actions() {
    let sk0 = 1;
    let pk0 = derive_spending_pk(sk0);
    let v0 = 100;
    let rcm0 = 2;
    let c0 = compute_commitment(v0, rcm0, pk0);
    let nf0 = compute_nullifier(sk0, v0, rcm0);

    let sk1 = 3;
    let pk1 = derive_spending_pk(sk1);
    let v1 = 200;
    let rcm1 = 4;
    let c1 = compute_commitment(v1, rcm1, pk1);
    let nf1 = compute_nullifier(sk1, v1, rcm1);

    let sk2 = 5;
    let pk2 = derive_spending_pk(sk2);
    let v2 = 150;
    let rcm2 = 6;
    let c2 = compute_commitment(v2, rcm2, pk2);
    let nf2 = compute_nullifier(sk2, v2, rcm2);

    let sk3 = 7;
    let pk3 = derive_spending_pk(sk3);
    let v3 = 50;
    let rcm3 = 8;
    let c3 = compute_commitment(v3, rcm3, pk3);
    let nf3 = compute_nullifier(sk3, v3, rcm3);

    let total = 500;
    let payee = 350;
    let change = 150;
    assert(v0 + v1 + v2 + v3 == total);
    assert(payee + change == total);

    let bob_pk = derive_spending_pk(888);
    let payee_rcm = 10;
    let change_rcm = 12;
    let nc0 = compute_commitment(payee, payee_rcm, bob_pk);
    let nc1 = compute_commitment(change, change_rcm, pk0);

    let zeros = empty_tree_zeros();
    let l01 = hash_pair(c0, c1);
    let l23 = hash_pair(c2, c3);
    let l0123 = hash_pair(l01, l23);
    let mut root = l0123;
    for i in 2..TREE_HEIGHT {
        root = hash_pair(root, zeros[i]);
    }

    let mut path0 = zeros;
    path0[0] = c1;
    path0[1] = l23;
    let mut idx0 = [false; TREE_HEIGHT];

    let mut path1 = zeros;
    path1[0] = c0;
    path1[1] = l23;
    let mut idx1 = [false; TREE_HEIGHT];
    idx1[0] = true;

    let mut path2 = zeros;
    path2[0] = c3;
    path2[1] = l01;
    let mut idx2 = [false; TREE_HEIGHT];
    idx2[1] = true;

    let mut path3 = zeros;
    path3[0] = c2;
    path3[1] = l01;
    let mut idx3 = [false; TREE_HEIGHT];
    idx3[0] = true;
    idx3[1] = true;

    invoke_transfer(
        [v0, v1, v2, v3],
        [rcm0, rcm1, rcm2, rcm3],
        [sk0, sk1, sk2, sk3],
        [path0, path1, path2, path3],
        [idx0, idx1, idx2, idx3],
        [payee, change, 0, 0],
        [payee_rcm, change_rcm, 0, 0],
        [bob_pk, pk0, 0, 0],
        root,
        [nf0, nf1, nf2, nf3],
        [nc0, nc1, 0, 0],
        0,
        0,
    );
}
