import { bytesToHex0x } from "./bytes";
import type { VaultChainEvent } from "./vault-events";

export type SerializedVaultChainEvent =
  | {
      kind: "deposit";
      ledger: number;
      txHash: string;
      commitment: string;
      leafIndex: number;
    }
  | {
      kind: "shielded_send";
      ledger: number;
      txHash: string;
      nullifier: string;
      newCommitment: string;
      leafIndex: number;
      epk: string;
      encryptedNoteHex: string;
    }
  | {
      kind: "withdraw";
      ledger: number;
      txHash: string;
      nullifier: string;
      recipient: string;
      amount: string;
    }
  | {
      kind: "exit";
      ledger: number;
      txHash: string;
      nullifier: string;
    };

export function serializeVaultEvents(
  events: VaultChainEvent[]
): SerializedVaultChainEvent[] {
  return events.map((event) => {
    if (event.kind === "deposit") {
      return {
        kind: "deposit",
        ledger: event.ledger,
        txHash: event.txHash,
        commitment: event.commitment,
        leafIndex: event.leafIndex,
      };
    }
    if (event.kind === "shielded_send") {
      return {
        kind: "shielded_send",
        ledger: event.ledger,
        txHash: event.txHash,
        nullifier: event.nullifier,
        newCommitment: event.newCommitment,
        leafIndex: event.leafIndex,
        epk: event.epk,
        encryptedNoteHex: bytesToHex0x(event.encryptedNote),
      };
    }
    if (event.kind === "withdraw") {
      return {
        kind: "withdraw",
        ledger: event.ledger,
        txHash: event.txHash,
        nullifier: event.nullifier,
        recipient: event.recipient,
        amount: event.amount,
      };
    }
    return {
      kind: "exit",
      ledger: event.ledger,
      txHash: event.txHash,
      nullifier: event.nullifier,
    };
  });
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function deserializeVaultEvents(
  events: SerializedVaultChainEvent[]
): VaultChainEvent[] {
  return events.map((event) => {
    if (event.kind === "deposit") {
      return {
        kind: "deposit",
        ledger: event.ledger,
        txHash: event.txHash,
        commitment: event.commitment,
        leafIndex: event.leafIndex,
      };
    }
    if (event.kind === "shielded_send") {
      return {
        kind: "shielded_send",
        ledger: event.ledger,
        txHash: event.txHash,
        nullifier: event.nullifier,
        newCommitment: event.newCommitment,
        leafIndex: event.leafIndex,
        epk: event.epk,
        encryptedNote: hexToBytes(event.encryptedNoteHex),
      };
    }
    if (event.kind === "withdraw") {
      return {
        kind: "withdraw",
        ledger: event.ledger,
        txHash: event.txHash,
        nullifier: event.nullifier,
        recipient: event.recipient,
        amount: event.amount,
      };
    }
    return {
      kind: "exit",
      ledger: event.ledger,
      txHash: event.txHash,
      nullifier: event.nullifier,
    };
  });
}
