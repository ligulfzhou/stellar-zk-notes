use poseidon::poseidon2::Poseidon2;

/// Merkle tree height - must match the Soroban vault contract.
global TREE_HEIGHT: u32 = 16;

/// Maximum spend (input) action slots - padded with zeros when unused.
global MAX_SPENDS: u32 = 4;

/// Maximum output action slots - padded with zeros when unused.
global MAX_OUTPUTS: u32 = 4;

/// Pool 0 join amount (1 XLM in stroops).
global JOIN_AMOUNT_0: Field = 10_000_000;
/// Pool 1 join amount (10 XLM in stroops).
global JOIN_AMOUNT_1: Field = 100_000_000;
/// Pool 2 join amount (100 XLM in stroops).
global JOIN_AMOUNT_2: Field = 1_000_000_000;

fn join_amount_for_pool(pool_id: Field) -> Field {
  if pool_id == 0 {
    JOIN_AMOUNT_0
  } else if pool_id == 1 {
    JOIN_AMOUNT_1
  } else {
    assert(pool_id == 2);
    JOIN_AMOUNT_2
  }
}

fn compute_commitment_v2(
  value: Field,
  secret: Field,
  nullifier_secret: Field,
  deposit_secret: Field,
  pool_id: Field,
) -> Field {
  Poseidon2::hash([value, secret, nullifier_secret, deposit_secret, pool_id], 5)
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
  deposit_secret: Field,
  merkle_path: [Field; TREE_HEIGHT],
  path_indices: [bool; TREE_HEIGHT],
  merkle_root: Field,
  pool_id: Field,
) {
  if nullifier != 0 {
    let expected_value = join_amount_for_pool(pool_id);
    assert(value == expected_value);
    let commitment = compute_commitment_v2(value, secret, nullifier_secret, deposit_secret, pool_id);
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
  out_deposit_secret: Field,
  pool_id: Field,
) {
  if new_commitment != 0 {
    let expected = compute_commitment_v2(
      out_value,
      out_secret,
      out_nullifier_secret,
      out_deposit_secret,
      pool_id,
    );
    assert(expected == new_commitment);
  } else {
    assert(out_value == 0);
  }
}

/// Pool-scoped exit proof: spend note(s) and withdraw public_amount (Tornado-style).
/// In-pool shielded transfers are not supported (public_amount must be non-zero).
fn main(
  spend_value: [Field; MAX_SPENDS],
  spend_secret: [Field; MAX_SPENDS],
  spend_nullifier_secret: [Field; MAX_SPENDS],
  spend_deposit_secret: [Field; MAX_SPENDS],
  spend_merkle_path: [[Field; TREE_HEIGHT]; MAX_SPENDS],
  spend_path_indices: [[bool; TREE_HEIGHT]; MAX_SPENDS],
  out_value: [Field; MAX_OUTPUTS],
  out_secret: [Field; MAX_OUTPUTS],
  out_nullifier_secret: [Field; MAX_OUTPUTS],
  out_deposit_secret: [Field; MAX_OUTPUTS],
  pool_id: pub Field,
  merkle_root: pub Field,
  nullifier: pub [Field; MAX_SPENDS],
  new_commitment: pub [Field; MAX_OUTPUTS],
  public_amount: pub Field,
  relayer_fee: pub Field,
) {
  if pool_id != 0 {
    if pool_id != 1 {
      assert(pool_id == 2);
    }
  }

  assert(public_amount != 0);
  assert(relayer_fee as u64 <= public_amount as u64);
  for j in 0..MAX_OUTPUTS {
    assert(new_commitment[j] == 0);
  }

  let mut spend_sum = 0;
  for i in 0..MAX_SPENDS {
    verify_spend_slot(
      nullifier[i],
      spend_value[i],
      spend_secret[i],
      spend_nullifier_secret[i],
      spend_deposit_secret[i],
      spend_merkle_path[i],
      spend_path_indices[i],
      merkle_root,
      pool_id,
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
      out_deposit_secret[j],
      pool_id,
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

fn zero_spend_paths() -> ([[Field; TREE_HEIGHT]; MAX_SPENDS], [[bool; TREE_HEIGHT]; MAX_SPENDS]) {
  let empty_path = [0; TREE_HEIGHT];
  let empty_idx = [false; TREE_HEIGHT];
  (
    [empty_path, empty_path, empty_path, empty_path],
    [empty_idx, empty_idx, empty_idx, empty_idx],
  )
}

fn zero_out_deposit_secrets() -> [Field; MAX_OUTPUTS] {
  [0, 0, 0, 0]
}

fn invoke_pool_transfer(
  spend_value: [Field; MAX_SPENDS],
  spend_secret: [Field; MAX_SPENDS],
  spend_nullifier_secret: [Field; MAX_SPENDS],
  spend_deposit_secret: [Field; MAX_SPENDS],
  spend_merkle_path: [[Field; TREE_HEIGHT]; MAX_SPENDS],
  spend_path_indices: [[bool; TREE_HEIGHT]; MAX_SPENDS],
  out_value: [Field; MAX_OUTPUTS],
  out_secret: [Field; MAX_OUTPUTS],
  out_nullifier_secret: [Field; MAX_OUTPUTS],
  out_deposit_secret: [Field; MAX_OUTPUTS],
  pool_id: Field,
  merkle_root: Field,
  nullifier: [Field; MAX_SPENDS],
  new_commitment: [Field; MAX_OUTPUTS],
  public_amount: Field,
  relayer_fee: Field,
) {
  main(
    spend_value,
    spend_secret,
    spend_nullifier_secret,
    spend_deposit_secret,
    spend_merkle_path,
    spend_path_indices,
    out_value,
    out_secret,
    out_nullifier_secret,
    out_deposit_secret,
    pool_id,
    merkle_root,
    nullifier,
    new_commitment,
    public_amount,
    relayer_fee,
  );
}

#[test]
fn test_commitment_v2_and_nullifier_consistency() {
  let pool_id = 0;
  let value = JOIN_AMOUNT_0;
  let secret = 42;
  let nullifier_secret = 7;
  let deposit_secret = 99;
  let commitment = compute_commitment_v2(value, secret, nullifier_secret, deposit_secret, pool_id);
  let nullifier = compute_nullifier(nullifier_secret, commitment);
  assert(nullifier != 0);
  assert(commitment != 0);
}

#[test]
fn test_exit_via_pool_actions() {
  let pool_id = 0;
  let value = JOIN_AMOUNT_0;
  let secret = 5;
  let ns = 9;
  let ds = 17;
  let c = compute_commitment_v2(value, secret, ns, ds, pool_id);
  let nf = compute_nullifier(ns, c);

  let (path, idx) = first_leaf_merkle_witness();
  let root = root_for_first_leaf(c);
  let (zero_paths, zero_idx) = zero_spend_paths();

  let mut paths = zero_paths;
  paths[0] = path;
  let mut indices = zero_idx;
  indices[0] = idx;

  let fee = 10_000;

  invoke_pool_transfer(
    [value, 0, 0, 0],
    [secret, 0, 0, 0],
    [ns, 0, 0, 0],
    [ds, 0, 0, 0],
    paths,
    indices,
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    zero_out_deposit_secrets(),
    pool_id,
    root,
    [nf, 0, 0, 0],
    [0, 0, 0, 0],
    value,
    fee,
  );
}

#[test]
fn test_pool_id_domain_separation() {
  let value = JOIN_AMOUNT_0;
  let secret = 1;
  let ns = 2;
  let ds = 3;
  let c0 = compute_commitment_v2(value, secret, ns, ds, 0);
  let c1 = compute_commitment_v2(value, secret, ns, ds, 1);
  assert(c0 != c1);
}
