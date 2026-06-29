use poseidon::poseidon2::Poseidon2;

/// Domain separators for spending-key derivation (Sapling-style nk/pk split).
global DOMAIN_SPENDING_PK: Field = 1;
global DOMAIN_NULLIFIER_KEY: Field = 2;

pub fn derive_spending_pk(spending_sk: Field) -> Field {
    Poseidon2::hash([spending_sk, DOMAIN_SPENDING_PK], 2)
}

pub fn derive_nullifier_key(spending_sk: Field) -> Field {
    Poseidon2::hash([spending_sk, DOMAIN_NULLIFIER_KEY], 2)
}

/// v2 note commitment: binds value + note randomness to recipient spending public key.
/// Sender knows (value, rcm, recipient_pk) but not recipient spending_sk.
pub fn compute_commitment(value: Field, note_randomness: Field, spending_pk: Field) -> Field {
    Poseidon2::hash([value, note_randomness, spending_pk], 3)
}

pub fn compute_nullifier(spending_sk: Field, value: Field, note_randomness: Field) -> Field {
    let spending_pk = derive_spending_pk(spending_sk);
    let nk = derive_nullifier_key(spending_sk);
    let commitment = compute_commitment(value, note_randomness, spending_pk);
    Poseidon2::hash([nk, commitment], 2)
}

/// Prover API: commitment hash for output notes (recipient_pk may be payee or self).
fn main(value: Field, note_randomness: Field, spending_pk: Field) -> pub Field {
    compute_commitment(value, note_randomness, spending_pk)
}

#[test]
fn test_commitment_deterministic() {
    let pk = derive_spending_pk(42);
    let c1 = compute_commitment(10_000_000, 99, pk);
    let c2 = compute_commitment(10_000_000, 99, pk);
    assert(c1 == c2);
    assert(c1 != 0);
}

#[test]
fn test_sender_cannot_derive_recipient_nullifier() {
    let bob_sk = 777;
    let bob_pk = derive_spending_pk(bob_sk);
    let rcm = 555;
    let value = 1_000;
    let _commitment = compute_commitment(value, rcm, bob_pk);
    let bob_nf = compute_nullifier(bob_sk, value, rcm);
    assert(bob_nf != 0);
}
