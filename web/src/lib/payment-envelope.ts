import { createNote } from "./note";
import type { Note } from "./note-types";

/** Off-chain delivery of note secrets when shielded send targets another user. */
export interface PaymentEnvelope {
  type: "zk-notes/payment";
  version: 1;
  recipient: string;
  sender: string;
  value: string;
  secret: string;
  nullifierSecret: string;
  commitment: string;
  leafIndex: number;
  txHash: string;
  createdAt: number;
}

export function buildPaymentEnvelope(params: {
  recipient: string;
  sender: string;
  valueStroops: bigint;
  secret: string;
  nullifierSecret: string;
  commitment: string;
  leafIndex: number;
  txHash: string;
}): PaymentEnvelope {
  return {
    type: "zk-notes/payment",
    version: 1,
    recipient: params.recipient,
    sender: params.sender,
    value: params.valueStroops.toString(),
    secret: params.secret,
    nullifierSecret: params.nullifierSecret,
    commitment: params.commitment,
    leafIndex: params.leafIndex,
    txHash: params.txHash,
    createdAt: Date.now(),
  };
}

export function downloadPaymentEnvelope(envelope: PaymentEnvelope): void {
  const blob = new Blob([JSON.stringify(envelope, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `zk-notes-payment-${envelope.txHash.slice(0, 8)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function parsePaymentEnvelope(json: string): PaymentEnvelope {
  const data = JSON.parse(json) as Partial<PaymentEnvelope>;
  if (data.type !== "zk-notes/payment" || data.version !== 1) {
    throw new Error("Not a zk-notes payment file");
  }
  if (
    !data.recipient ||
    !data.sender ||
    !data.value ||
    !data.secret ||
    !data.nullifierSecret ||
    !data.commitment ||
    data.leafIndex === undefined
  ) {
    throw new Error("Payment file is incomplete");
  }
  return data as PaymentEnvelope;
}

export async function noteFromPaymentEnvelope(
  envelope: PaymentEnvelope
): Promise<Note> {
  return createNote({
    valueStroops: BigInt(envelope.value),
    ownerPubkey: envelope.recipient,
    secret: envelope.secret,
    nullifierSecret: envelope.nullifierSecret,
    commitmentHex: envelope.commitment,
    leafIndex: envelope.leafIndex,
  });
}
