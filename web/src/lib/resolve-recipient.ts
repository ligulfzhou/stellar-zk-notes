import { decodeShieldedAddress, isShieldedAddress } from "./shielded-address";
import { parseShieldedReceiveAddress } from "./shielded-keys";

export type ResolvedRecipient = {
  diversifier: string;
  spendingPk: string;
  recipientPk: string;
  recipientPkHex: string;
  x25519Hex: string;
};

/** Parse zkstellar (preferred) or legacy zk1 address. */
export function resolveRecipientAddress(input: string): ResolvedRecipient {
  const trimmed = input.trim();
  if (isShieldedAddress(trimmed)) {
    const decoded = decodeShieldedAddress(trimmed);
    return {
      diversifier: decoded.diversifier,
      spendingPk: decoded.recipientPk,
      recipientPk: decoded.recipientPk,
      recipientPkHex: decoded.recipientPkHex,
      x25519Hex: decoded.x25519Hex,
    };
  }
  if (trimmed.startsWith("zk1:")) {
    const legacy = parseShieldedReceiveAddress(trimmed);
    return {
      diversifier: legacy.diversifier,
      spendingPk: legacy.spendingPk,
      recipientPk: legacy.spendingPk,
      recipientPkHex: legacy.spendingPkHex,
      x25519Hex: legacy.x25519Hex,
    };
  }
  throw new Error(
    "Enter a zkstellar shielded receive address (copy from recipient Notes tab)"
  );
}
