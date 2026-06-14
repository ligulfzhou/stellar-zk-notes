mod note;

use std::path::PathBuf;
use std::process::Command;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "zk-notes", about = "Developer CLI for zk-notes on Stellar")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Show project status and testnet contract IDs
    Status,
    /// Compute Poseidon2 note commitment (calls scripts/compute_commitment.sh)
    Commitment {
        value: String,
        secret: String,
        nullifier_secret: String,
    },
    /// Compute nullifier for a note (calls scripts/compute_nullifier.sh)
    Nullifier {
        nullifier_secret: String,
        commitment: String,
    },
    /// Hash a Merkle pair (calls scripts/hash_pair.sh)
    HashPair { left: String, right: String },
    /// Derive zk1 shielded receive address from BIP39 mnemonic
    ShieldedAddress {
        /// Space-separated 12/24-word phrase (quote in shell)
        mnemonic: String,
        #[arg(default_value = "testnet")]
        network: String,
    },
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("repo root")
        .to_path_buf()
}

fn run_script(script: &str, args: &[&str]) -> Result<String, String> {
    let path = repo_root().join("scripts").join(script);
    let output = Command::new(&path)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run {}: {e}", path.display()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{script} failed: {stderr}"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn run_shielded_address(mnemonic: &str, network: &str) -> Result<(), String> {
    let script = repo_root().join("scripts").join("shielded_address.mjs");
    let output = Command::new("node")
        .arg(&script)
        .arg(mnemonic)
        .arg(network)
        .output()
        .map_err(|e| format!("failed to run shielded_address: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr.trim().to_string());
    }
    print!("{}", String::from_utf8_lossy(&output.stdout));
    Ok(())
}

fn main() {
    let cli = Cli::parse();
    let result = match cli.command {
        Commands::Status => {
            println!("zk-notes — UTXO private payments on Stellar");
            println!();
            println!("Testnet (deployed):");
            println!("  VAULT_ID=CAQMBCLAIM6ACM2LHKNUYHQUOQKF73NWXASPV6ZTY3JZET72N3HTGM54");
            println!("  VERIFIER_ID=CDEDBW5XT4X2JANQRHIWD4QW2WWEEIAMZ6ZK43UV55KDMW6E76AJ3DSK");
            println!("  NATIVE_XLM=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
            println!();
            println!("Quick checks:");
            println!("  ./scripts/demo.sh");
            println!("  cd web && npm run dev");
            Ok(())
        }
        Commands::Commitment {
            value,
            secret,
            nullifier_secret,
        } => run_script("compute_commitment.sh", &[&value, &secret, &nullifier_secret])
            .map(|out| println!("{out}")),
        Commands::Nullifier {
            nullifier_secret,
            commitment,
        } => run_script(
            "compute_nullifier.sh",
            &[&nullifier_secret, &commitment],
        )
        .map(|out| println!("{out}")),
        Commands::HashPair { left, right } => {
            run_script("hash_pair.sh", &[&left, &right]).map(|out| println!("{out}"))
        }
        Commands::ShieldedAddress { mnemonic, network } => {
            run_shielded_address(&mnemonic, &network)
        }
    };

    if let Err(err) = result {
        eprintln!("error: {err}");
        std::process::exit(1);
    }
}
