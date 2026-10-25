// @ts-check
// wire: what a Space and the warmup pool service agree on (spec 2.19; ARCH 7.6, R19; lead ruling Q5). The pool is opt-in: a Space that joins offers its warming mailboxes
// to other joined Spaces and receives peers for them; a Space that opts out never talks to this service and warms up with its own seed inboxes.
//
// The contract is two calls, both POST with a JSON body, both signed by the Space key (an Ed25519 key):
//   POST /v1/pool/join       { v: 1, mailboxes: [{ address }] }      replace the mailboxes this key offers; an empty list leaves the pool
//   POST /v1/pool/exchange   { v: 1, mailboxes: [{ address, want, sent, bounced, seen? }] }    ask for peers and report health; see service.js
// Answers are { data } or { error: { code, message } }. GET /health answers { data: { ok: true } } and needs no signature.
//
// Signature: headers x-vyre-key (the Space key's raw public key, base64url), x-vyre-ts (ms since the epoch), x-vyre-nonce (16 random bytes, base64url) and x-vyre-sig
// (base64url, Ed25519 over the bytes below). The key's id, which names the Space in the pool, is the first 26 base32 characters of sha256 of the raw public key (the same
// rule as a relay route id), so the service learns nothing about a Space except its key, the mailboxes it offers and the counts it reports.
//
//   vyre-warmup-v1 \n METHOD \n PATH \n TS \n NONCE \n BODY      (BODY is the exact request body text)
//
// A request older or newer than 5 minutes, or one whose nonce was already used inside that window, is refused: a captured request cannot be replayed.

export const TAG = "vyre-warmup-v1";
export const MAX_SKEW_MS = 5 * 60_000;
export const MAX_BODY = 64 * 1024;
export const MAX_MAILBOXES = 50;
export const MAX_WANT = 20;

const B32 = "abcdefghijklmnopqrstuvwxyz234567";

/** @param {Uint8Array} buf */
export function base32(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** @param {Uint8Array} bytes */
export function b64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** @param {string} text @returns {Uint8Array | null} */
export function unb64url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const bin = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  } catch { return null; }
}

/** The pool's name for a Space: from its public key only. @param {Uint8Array} pub */
export async function keyId(pub) {
  return base32(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", /** @type {BufferSource} */ (pub)))).slice(0, 26);
}

/** The bytes a request signature covers. */
export function signedMessage(/** @type {string} */ method, /** @type {string} */ path, /** @type {string} */ ts, /** @type {string} */ nonce, /** @type {string} */ body) {
  return new TextEncoder().encode(`${TAG}\n${method}\n${path}\n${ts}\n${nonce}\n${body}`);
}

/** True when `sig` is the Ed25519 signature of `message` under the raw public key `pub`. Never throws. */
export async function verifySignature(/** @type {Uint8Array} */ pub, /** @type {Uint8Array} */ sig, /** @type {Uint8Array} */ message) {
  try {
    if (pub.length !== 32 || sig.length !== 64) return false;
    const key = await globalThis.crypto.subtle.importKey("raw", /** @type {BufferSource} */ (pub), { name: "Ed25519" }, false, ["verify"]);
    return await globalThis.crypto.subtle.verify({ name: "Ed25519" }, key, /** @type {BufferSource} */ (sig), /** @type {BufferSource} */ (message));
  } catch { return false; }
}

/** An address the pool will hold: one @, a dotted domain, no spaces or angle brackets, at most 254 characters. Stored lowercase. */
export const ADDRESS_RE = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]{2,}$/;
