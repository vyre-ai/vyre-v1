// The recovery code every way in makes: at sign-up, at an owner claim and when Settings makes a new one. Kept apart from the join screens so Settings does not load them.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
/** 16 characters in four groups, from the platform's random source. */
export function makeRecoveryCode(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (let i = 0; i < 16; i++) s += CODE_ALPHABET[b[i]! % CODE_ALPHABET.length];
  return [s.slice(0, 4), s.slice(4, 8), s.slice(8, 12), s.slice(12)].join("-");
}
