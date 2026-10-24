// kernel/identity: the one key stretch for the recovery code (ADR 0051, DESIGN-wink section 2). The recovery entry's key is Argon2id of the code and the optional recovery password, so
// the paper alone is not enough, and a short password adds only the cost of this function against an offline guesser (the public half of the key is on a public list). The UI
// therefore recommends four or more words.
//
// Argon2id, RFC 9106, version 0x13, one lane, 19 MiB, two passes (the OWASP minimum), a 32 byte tag. It is Node's own argon2 (24.7 and later; the repo requires Node 24): the 0.6 pure
// JavaScript fallback is not carried over, so there is one implementation to review. No imports but node:crypto, no dependency.
import crypto from "node:crypto";

export interface StretchParams { memoryKiB: number; passes: number; lanes?: number; tagLength?: number }

export const STRETCH: Readonly<Required<StretchParams>> = Object.freeze({ memoryKiB: 19456, passes: 2, lanes: 1, tagLength: 32 });
export const STRETCH_SALT = "vyre-recovery-code-v1";

export function argon2id(secret: Uint8Array | string, salt: Uint8Array | string = STRETCH_SALT, params: StretchParams = STRETCH): Buffer {
  const P = { lanes: 1, tagLength: 32, ...params };
  if (P.lanes !== 1) throw new Error("one lane only");
  if (typeof crypto.argon2Sync !== "function") throw new Error("this Node has no Argon2id; Vyre needs Node 24.7 or later");
  return Buffer.from(crypto.argon2Sync("argon2id", { message: Buffer.from(secret), nonce: Buffer.from(salt), parallelism: 1, tagLength: P.tagLength, memory: P.memoryKiB, passes: P.passes }));
}

