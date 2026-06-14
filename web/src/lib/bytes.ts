/** Convert raw bytes from Soroban events to 0x-prefixed hex. */
export function bytesToHex0x(data: Uint8Array | Buffer): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return `0x${hex}`;
}

export function normalizeHex(hex: string): string {
  const h = hex.startsWith("0x") ? hex : `0x${hex}`;
  return h.toLowerCase();
}

export function hexEquals(a: string, b: string): boolean {
  return normalizeHex(a) === normalizeHex(b);
}
