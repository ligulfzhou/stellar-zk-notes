use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub value: u64,
    pub secret: String,
    pub nullifier_secret: String,
    pub owner_pubkey: String,
    pub commitment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteVault {
    pub version: u32,
    pub notes: Vec<Note>,
}
