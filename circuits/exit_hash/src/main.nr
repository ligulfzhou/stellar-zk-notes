use poseidon::poseidon2::Poseidon2;

/// Max encrypted exit size (matches vault + pool-config).
global MAX_EXIT_BYTES: u32 = 256;
global BYTES_PER_FIELD: u32 = 31;
global MAX_FIELDS: u32 = 9;

fn pack_chunk(bytes: [u8; MAX_EXIT_BYTES], start: u32) -> Field {
    let mut acc: Field = 0;
    for i in 0..BYTES_PER_FIELD {
        let idx = start + i;
        let b = bytes[idx] as Field;
        acc = acc * 256 + b;
    }
    acc
}

/// Poseidon2 hash of encrypted exit bytes (length-domain separated).
pub fn hash_exit_bytes(bytes: [u8; MAX_EXIT_BYTES], len: u32) -> Field {
    assert(len > 0);
    assert(len <= MAX_EXIT_BYTES);

    let num_chunks = (len + BYTES_PER_FIELD - 1) / BYTES_PER_FIELD;
    let mut fields: [Field; MAX_FIELDS] = [0; MAX_FIELDS];
    for c in 0..MAX_FIELDS {
        if c < num_chunks {
            fields[c] = pack_chunk(bytes, c * BYTES_PER_FIELD);
        }
    }
    let len_field = len as Field;
    Poseidon2::hash([fields[0], fields[1], fields[2], fields[3], fields[4], fields[5], fields[6], fields[7], fields[8], len_field], 10)
}

fn main(bytes: [u8; MAX_EXIT_BYTES], len: u32) -> pub Field {
    hash_exit_bytes(bytes, len)
}

#[test]
fn test_exit_hash_nonzero() {
    let mut bytes: [u8; MAX_EXIT_BYTES] = [0; MAX_EXIT_BYTES];
    bytes[0] = 42;
    let h = hash_exit_bytes(bytes, 1);
    assert(h != 0);
}
