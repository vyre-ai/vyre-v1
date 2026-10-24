// Authenticated encryption, key derivation and signatures for the kernel (B3: crypto lives here). node:crypto only.
//   aesWrap / aesUnwrap   AES-256-GCM with a bound context (AAD), 12 byte random iv
//   hkdf32                HKDF-SHA-256 to 32 bytes
//   sealTo / openSeal     X25519 + HKDF + AES-GCM: seal a few bytes to a public key
//   ed25519*              raw-key Ed25519 signatures
//   createKernelSeal      HMAC under a purpose, for what the kernel must later recognise as its own
import crypto from "node:crypto";
import { hmac, sameMac } from "./wire.ts";

const b64 = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
const raw = (s: string): Buffer => Buffer.from(s, "base64url");

export interface Box { iv: string; ct: string; tag: string }

export function aesWrap(kek: Uint8Array, plain: Uint8Array, aad: string): Box {
  if (kek.length !== 32) throw new RangeError("a key is 32 bytes");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", kek, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return { iv: b64(iv), ct: b64(ct), tag: b64(c.getAuthTag()) };
}

/** Throws when the key, the box or the AAD is wrong. */
export function aesUnwrap(kek: Uint8Array, box: Box, aad: string): Buffer {
  const d = crypto.createDecipheriv("aes-256-gcm", kek, raw(box.iv));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(raw(box.tag));
  return Buffer.concat([d.update(raw(box.ct)), d.final()]);
}

export const hkdf32 = (ikm: Uint8Array | string, salt: string | Uint8Array, info: string | Uint8Array): Buffer => Buffer.from(crypto.hkdfSync("sha256", Buffer.from(ikm), Buffer.from(salt), info, 32));

/** A fresh X25519 pair, raw 32 byte halves as base64url. */
export function x25519Pair(): { pub: string; priv: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  return { pub: String(publicKey.export({ format: "jwk" }).x), priv: String(privateKey.export({ format: "jwk" }).d) };
}

const X25519_PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");
function pubOfPriv(privB64: string): string {
  const priv = crypto.createPrivateKey({ key: Buffer.concat([X25519_PKCS8, raw(privB64)]), format: "der", type: "pkcs8" });
  return String(crypto.createPublicKey(priv).export({ format: "jwk" }).x);
}
export function x25519Shared(privB64: string, pubB64: string): Buffer {
  const priv = crypto.createPrivateKey({ key: { kty: "OKP", crv: "X25519", d: privB64, x: pubOfPriv(privB64) }, format: "jwk" });
  const pub = crypto.createPublicKey({ key: { kty: "OKP", crv: "X25519", x: pubB64 }, format: "jwk" });
  return crypto.diffieHellman({ privateKey: priv, publicKey: pub });
}

const WRAP_INFO = "vyre:seal:to:v1";
export function sealTo(pubB64: string, plain: Uint8Array, aad: string): Box & { eph: string } {
  const eph = x25519Pair();
  return { eph: eph.pub, ...aesWrap(hkdf32(x25519Shared(eph.priv, pubB64), eph.pub, WRAP_INFO), plain, aad) };
}
export function openSeal(privB64: string, box: Box & { eph: string }, aad: string): Buffer {
  return aesUnwrap(hkdf32(x25519Shared(privB64, box.eph), box.eph, WRAP_INFO), box, aad);
}

const ED_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const ED_SPKI = Buffer.from("302a300506032b6570032100", "hex");
/** A fresh Ed25519 pair as raw 32 byte seed and public key (base64url). */
export function ed25519Pair(): { pub: string; seed: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return { pub: String(publicKey.export({ format: "jwk" }).x), seed: String(privateKey.export({ format: "jwk" }).d) };
}
export const ed25519Sign = (seedB64: string, message: Uint8Array): string =>
  crypto.sign(null, message, crypto.createPrivateKey({ key: Buffer.concat([ED_PKCS8, raw(seedB64)]), format: "der", type: "pkcs8" })).toString("base64url");
/** A bad key, signature or shape is false, never a throw. */
export function ed25519Verify(pubB64: string, message: Uint8Array, sigB64: string): boolean {
  try { return crypto.verify(null, message, crypto.createPublicKey({ key: Buffer.concat([ED_SPKI, raw(pubB64)]), format: "der", type: "spki" }), raw(sigB64)); } catch { return false; }
}

const PURPOSE = /^[a-z0-9_.-]{1,40}$/;
export interface KernelSeal {
  mac(purpose: string, data: string): string;
  verify(purpose: string, data: string, mac: string): boolean;
}
/** The kernel's own recogniser: a MAC under a development or process key, bound to a purpose so one use's MAC is no use for another. */
export function createKernelSeal(key: Uint8Array | string): KernelSeal {
  if (!key || key.length < 16) throw new Error("the kernel seal needs a key of at least 16 bytes");
  const ok = (p: string): string => { if (!PURPOSE.test(p)) throw new Error("bad purpose"); return p; };
  const macOf = (purpose: string, data: string): string => hmac(key, `${ok(purpose)}\n${data}`);
  const seal: KernelSeal = { mac: macOf, verify: (purpose, data, mac) => typeof mac === "string" && sameMac(macOf(purpose, data), mac) };
  return Object.freeze(seal);
}
