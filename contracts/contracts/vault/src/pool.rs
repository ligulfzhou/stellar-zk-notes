/// Denomination pool configuration (Phase C).
pub const POOL_COUNT: u32 = 3;
pub const MIN_POOL_SIZE: u32 = 3;
pub const JOIN_AMOUNTS: [i128; 3] = [10_000_000, 100_000_000, 1_000_000_000];

pub fn is_valid_pool_id(pool_id: u32) -> bool {
    pool_id < POOL_COUNT
}
