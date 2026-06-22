use poseidon::poseidon2::Poseidon2;

/// Phase C commitment (5-arg Poseidon) - must match pool_actions and the vault.
pub fn compute_commitment_v2(
    value: Field,
    secret: Field,
    nullifier_secret: Field,
    deposit_secret: Field,
    pool_id: Field,
) -> Field {
    Poseidon2::hash([value, secret, nullifier_secret, deposit_secret, pool_id], 5)
}

pub fn compute_nullifier(nullifier_secret: Field, commitment: Field) -> Field {
    Poseidon2::hash([nullifier_secret, commitment], 2)
}

fn main(
    value: Field,
    secret: Field,
    nullifier_secret: Field,
    deposit_secret: Field,
    pool_id: Field,
) -> pub Field {
    compute_commitment_v2(value, secret, nullifier_secret, deposit_secret, pool_id)
}

#[test]
fn test_commitment_v2_deterministic() {
    let c1 = compute_commitment_v2(10_000_000, 42, 7, 99, 0);
    let c2 = compute_commitment_v2(10_000_000, 42, 7, 99, 0);
    assert(c1 == c2);
    assert(c1 != 0);
}
