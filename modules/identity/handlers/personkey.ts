// The person key and the password (ruling 62; ARCH 4.4, spec 2.17): personKeyByPassword is the 32-byte person key sealed under a key from the password (Argon2id with the username as salt, then HKDF), as base64 of the
// sealed box. Whoever has the password can open it; the server cannot. At sign-in on the person's own node the host holds the opened key in memory for that person's Mine items; it is never stored or logged here.
import { aesUnwrap, aesWrap, argon2id, hkdf32 } from "../../../kernel/src/seal/index.ts";
import type { Box } from "../../../kernel/src/seal/index.ts";

// the username is the salt because a device wraps the key before the server has made the person an id (at join); it is lowercased like every username the server keeps
const aad = (username: string): string => `vyre:personkey:${username.trim().toLowerCase()}`;
const wrapKey = (password: string, username: string): Buffer => hkdf32(argon2id(password, `vyre-person-key:${username.trim().toLowerCase()}`), "vyre:personkey:v1", "wrap");

/** What a device sends as personKeyByPassword: the person key sealed under the password. */
export function wrapPersonKey(password: string, username: string, personKey: Uint8Array): string {
  return Buffer.from(JSON.stringify(aesWrap(wrapKey(password, username), personKey, aad(username)))).toString("base64");
}

/** The person key, or null when this is not a bundle the password opens (another wrapping, a wrong password): the person signs in all the same and their Mine items stay locked. */
export function unwrapPersonKey(password: string, username: string, wrapped: string): Uint8Array | null {
  try {
    const key = aesUnwrap(wrapKey(password, username), JSON.parse(Buffer.from(wrapped, "base64").toString("utf8")) as Box, aad(username));
    return key.length === 32 ? new Uint8Array(key) : null;
  } catch {
    return null;
  }
}
