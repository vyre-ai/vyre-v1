// Ed25519 and HMAC on WebCrypto (Node 24 has both), plus base64url and the strings that get signed.
// No import of node:crypto: the reports service signs and verifies through globalThis.crypto.subtle only.

const enc = new TextEncoder();
const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error("bad base64url");
  const s = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export const utf8 = (s: string): Uint8Array => enc.encode(s);

export async function sha256hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await subtle().digest("SHA-256", bytes as BufferSource));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}

export interface SigningKey { key: CryptoKey; publicKey: Uint8Array; pkcs8: Uint8Array }

/** A new Ed25519 key for the service; the private half is exported once so the service can keep it across restarts. */
export async function generateSigningKey(): Promise<SigningKey> {
  const kp = (await subtle().generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    key: kp.privateKey,
    publicKey: new Uint8Array(await subtle().exportKey("raw", kp.publicKey)),
    pkcs8: new Uint8Array(await subtle().exportKey("pkcs8", kp.privateKey)),
  };
}

/** The key from its saved PKCS8 form. The public half is read back from a JWK export of a throwaway extractable copy. */
export async function loadSigningKey(pkcs8: Uint8Array): Promise<SigningKey> {
  const tmp = await subtle().importKey("pkcs8", pkcs8 as BufferSource, "Ed25519", true, ["sign"]);
  const jwk = await subtle().exportKey("jwk", tmp);
  if (typeof jwk.x !== "string") throw new Error("the signing key has no public half");
  const key = await subtle().importKey("pkcs8", pkcs8 as BufferSource, "Ed25519", false, ["sign"]);
  return { key, publicKey: fromBase64url(jwk.x), pkcs8 };
}

export async function sign(key: CryptoKey, message: string): Promise<string> {
  return base64url(new Uint8Array(await subtle().sign("Ed25519", key, utf8(message) as BufferSource)));
}

/** True when `sig` (base64url) is `publicKey`'s Ed25519 signature of `message`. Any malformed input is false, never a throw. */
export async function verify(publicKey: Uint8Array, message: string, sig: string): Promise<boolean> {
  try {
    if (publicKey.length !== 32) return false;
    const s = fromBase64url(sig);
    if (s.length !== 64) return false;
    const key = await subtle().importKey("raw", publicKey as BufferSource, "Ed25519", false, ["verify"]);
    return await subtle().verify("Ed25519", key, s as BufferSource, utf8(message) as BufferSource);
  } catch {
    return false;
  }
}

/** HMAC-SHA256 as lowercase hex, for GitHub's `x-hub-signature-256`. */
export async function hmacHex(secret: string, body: Uint8Array): Promise<string> {
  const key = await subtle().importKey("raw", utf8(secret) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await subtle().sign("HMAC", key, body as BufferSource));
  return Array.from(mac, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Equal-length comparison that does not stop at the first different character. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// What each party signs. A line per part, a version tag first, so a signature for one purpose is never valid for another.
export const reportMessage = (ts: string, bodyHash: string): string => `vyre-report-v1\nPOST\n/v1/reports\n${ts}\n${bodyHash}`;
export const registerMessage = (ts: string, bodyHash: string): string => `vyre-space-register-v1\n${ts}\n${bodyHash}`;
export const resolvedMessage = (ts: string, bodyHash: string): string => `vyre-report-resolved-v1\n${ts}\n${bodyHash}`;
