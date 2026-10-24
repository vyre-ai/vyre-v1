// The one-screen recovery key: 128 bits, 26 base32 characters in groups of four (0.6 kernel/identity/code.js).
import crypto from "node:crypto";

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
/** RFC 4648 base32, lowercase, no padding. */
export function base32(buf: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function newRecoveryCode(random: (n: number) => Uint8Array = crypto.randomBytes): string {
  return base32(random(16)).slice(0, 26).replace(/(.{4})(?=.)/g, "$1-");
}

