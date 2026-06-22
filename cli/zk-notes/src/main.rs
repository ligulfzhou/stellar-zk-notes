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
    /// Run full testnet e2e (deposit / send / withdraw) via scripts/e2e_testnet.sh
    E2eTestnet {
        /// deposit | withdraw | send | all (default: all)
        #[arg(long, default_value = "all")]
        flow: String,
        /// Extra args forwarded to the Node e2e runner
        #[arg(last = true)]
        extra: Vec<String>,
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

fn run_e2e_testnet(flow: &str, extra: &[String]) -> Result<(), String> {
    let script = repo_root().join("scripts").join("e2e_testnet.sh");
    let mut cmd = Command::new(&script);
    cmd.arg("--flow").arg(flow);
    cmd.args(extra);
    cmd.env(
        "STELLAR_NETWORK_PASSPHRASE",
        "Test SDF Network ; September 2015",
    );
    let status = cmd
        .status()
        .map_err(|e| format!("failed to run {}: {e}", script.display()))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("e2e testnet failed (exit {})", status.code().unwrap_or(-1)))
    }
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
            println!("Testnet (transfer_actions, real ZK):");
            println!("  VAULT_ID=CDICJZDBJLGFDGRNJRKLQDFFPBZOUSMXO76ETBYLQSOGYVGWKNKLVSQP");
            println!("  VERIFIER_ID=CAKHTZW4TFTKDJVYX4EBCBGAQG7KOJTF56OJFBWLHTYGYADPLZ53WWLN");
            println!("  NATIVE_XLM=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
            println!();
            println!("Quick checks:");
            println!("  ./scripts/demo.sh");
            println!("  ./scripts/e2e_testnet.sh");
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
        Commands::E2eTestnet { flow, extra } => run_e2e_testnet(&flow, &extra),
    };

    if let Err(err) = result {
        eprintln!("error: {err}");
        std::process::exit(1);
    }
}
