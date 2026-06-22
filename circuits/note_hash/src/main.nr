use poseidon::poseidon2::Poseidon2;

/// Compute note commitment - must match `spend_note` and the Soroban vault.
pub fn compute_commitment(value: Field, secret: Field, nullifier_secret: Field) -> Field {
    Poseidon2::hash([value, secret, nullifier_secret], 3)
}

pub fn compute_nullifier(nullifier_secret: Field, commitment: Field) -> Field {
    Poseidon2::hash([nullifier_secret, commitment], 2)
}

fn main(value: Field, secret: Field, nullifier_secret: Field) -> pub Field {
    compute_commitment(value, secret, nullifier_secret)
}

#[test]
fn test_hash_deterministic() {
    let c1 = compute_commitment(100, 42, 7);
    let c2 = compute_commitment(100, 42, 7);
    assert(c1 == c2);
    assert(c1 != 0);
}
