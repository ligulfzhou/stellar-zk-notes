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

export function hexToBytes(hex: string): Uint8Array {
  const h = normalizeHex(hex).slice(2);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

