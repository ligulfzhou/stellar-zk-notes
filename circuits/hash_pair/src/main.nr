use poseidon::poseidon2::Poseidon2;

fn main(left: Field, right: Field) -> pub Field {
    Poseidon2::hash([left, right], 2)
}
