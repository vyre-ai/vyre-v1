// The person key bundle on the client (ruling 63). Nothing here reaches a server in the clear: a person's own key never leaves the device that unwrapped it, and the server stores only the blobs.
//
//   personKey                 32 random bytes. Wraps everything the person keeps for themselves (personal Vault items, their own AI subscriptions).
//   personKeyByPassword       personKey sealed under Argon2id(password).
//   personKeyByRecovery       personKey sealed under Argon2id(recovery code).
//   publicKey                 the X25519 public key (raw 32 bytes, base64).
//   privateKeyWrapped         the X25519 private key (PKCS8) sealed under personKey.
//
// Every blob is   version (1 byte) | salt (16) | nonce (12) | AES-256-GCM ciphertext+tag   and is carried as base64. The version is 1. A secret-derived blob uses its salt for Argon2id (m=64 MiB, t=3, p=1,
// 32-byte output); a blob sealed under personKey carries a random salt that is not used, so one parser reads every blob. Each blob binds its purpose as GCM additional data, so a recovery blob cannot be
// presented as a password blob, nor a wrapped private key as a person key. Passwords and recovery codes are normalised to NFKC so the same secret typed on two platforms derives the same key.
//
// Argon2id is hash-wasm (WASM, one implementation in every browser and in Node); AES-GCM and X25519 are WebCrypto. No secret is logged, stored or put in an error message.
import { argon2id } from "hash-wasm";

export const VERSION = 1;
export const SALT_BYTES = 16;
export const NONCE_BYTES = 12;
export const KEY_BYTES = 32;
const TAG_BYTES = 16;

/** The Argon2id cost of every secret-derived key (ruling 63). */
export interface ArgonParams { memoryKiB: number; iterations: number; parallelism: number }
export const ARGON: Readonly<ArgonParams> = Object.freeze({ memoryKiB: 65536, iterations: 3, parallelism: 1 });

export type Purpose = "password" | "recovery" | "private";
const AAD: Record<Purpose, Uint8Array> = {
  password: new TextEncoder().encode("vyre/person-key/v1/password"),
  recovery: new TextEncoder().encode("vyre/person-key/v1/recovery"),
  private: new TextEncoder().encode("vyre/person-key/v1/private-key"),
};

export type KeyErrorCode = "bad_secret" | "bad_blob" | "unsupported_version" | "unavailable";
/** The one error this module throws. The message never holds a secret, a key or a blob. */
export class KeyError extends Error {
  readonly code: KeyErrorCode;
  constructor(code: KeyErrorCode, message: string) { super(message); this.name = "KeyError"; this.code = code; }
}

export type Rand = (n: number) => Uint8Array;
const randomBytes: Rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** The flat bundle a sign-up sends and a sign-in receives (base64 strings), without personKey. */
export interface KeyBundle { personKeyByPassword: string; personKeyByRecovery: string; publicKey: string; privateKeyWrapped: string }
export interface MadeBundle extends KeyBundle { personKey: Uint8Array }
export interface OpenedBundle { personKey: Uint8Array; privateKey: Uint8Array }

/** Test seams: a cheaper Argon2id, and fixed salt, nonce and randomness for known-answer vectors. Production code passes none. */
export interface Options { argon?: ArgonParams; rand?: Rand; salt?: Uint8Array; nonce?: Uint8Array }

// ---- encoding

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(s: string): Uint8Array {
  let bin: string;
  try { bin = atob(s); } catch { throw new KeyError("bad_blob", "That key data is not valid."); }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
/** Best effort: overwrite a key buffer when done with it. */
export const wipe = (b: Uint8Array): void => { b.fill(0); };

// ---- primitives

/** The key a secret and a salt derive: Argon2id, 32 bytes. */
export async function stretch(secret: string, salt: Uint8Array, params: ArgonParams = ARGON): Promise<Uint8Array> {
  if (salt.length !== SALT_BYTES) throw new KeyError("bad_blob", "That key data is not valid.");
  try {
    return await argon2id({
      password: secret.normalize("NFKC"), salt, parallelism: params.parallelism, iterations: params.iterations, memorySize: params.memoryKiB, hashLength: KEY_BYTES, outputType: "binary",
    });
  } catch { throw new KeyError("unavailable", "Keys cannot be derived on this device."); }
}

const aesKey = (key: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> => globalThis.crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, [usage]);

/** Seal `plaintext` under a 32-byte key into a blob. `salt` is whatever the blob should carry (the Argon2id salt for a secret-derived key). */
export async function seal(key: Uint8Array, plaintext: Uint8Array, purpose: Purpose, salt: Uint8Array, nonce: Uint8Array = randomBytes(NONCE_BYTES)): Promise<Uint8Array> {
  if (key.length !== KEY_BYTES || salt.length !== SALT_BYTES || nonce.length !== NONCE_BYTES) throw new KeyError("bad_blob", "That key data is not valid.");
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource, additionalData: AAD[purpose] as BufferSource }, await aesKey(key, "encrypt"), plaintext as BufferSource));
  return concat(Uint8Array.of(VERSION), salt, nonce, ct);
}

export interface Parsed { salt: Uint8Array; nonce: Uint8Array; ct: Uint8Array }
export function parse(blob: Uint8Array): Parsed {
  if (blob.length < 1 + SALT_BYTES + NONCE_BYTES + TAG_BYTES) throw new KeyError("bad_blob", "That key data is not valid.");
  if (blob[0] !== VERSION) throw new KeyError("unsupported_version", "That key data is from a newer version of Vyre.");
  return { salt: blob.subarray(1, 1 + SALT_BYTES), nonce: blob.subarray(1 + SALT_BYTES, 1 + SALT_BYTES + NONCE_BYTES), ct: blob.subarray(1 + SALT_BYTES + NONCE_BYTES) };
}

/** Open a blob under a 32-byte key. A wrong key, a changed byte and a blob made for another purpose all read the same: bad_secret. */
export async function open(key: Uint8Array, blob: Uint8Array, purpose: Purpose): Promise<Uint8Array> {
  const p = parse(blob);
  try {
    return new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv: p.nonce as BufferSource, additionalData: AAD[purpose] as BufferSource }, await aesKey(key, "decrypt"), p.ct as BufferSource));
  } catch { throw new KeyError("bad_secret", "That password or recovery code does not open this key."); }
}

async function sealWithSecret(secret: string, plaintext: Uint8Array, purpose: "password" | "recovery", o: Options): Promise<Uint8Array> {
  const rand = o.rand ?? randomBytes;
  const salt = o.salt ?? rand(SALT_BYTES);
  const key = await stretch(secret, salt, o.argon);
  try { return await seal(key, plaintext, purpose, salt, o.nonce ?? rand(NONCE_BYTES)); } finally { wipe(key); }
}

async function openWithSecret(secret: string, blobB64: string, purpose: "password" | "recovery", o: Options): Promise<Uint8Array> {
  const blob = fromBase64(blobB64);
  const key = await stretch(secret, parse(blob).salt.slice(), o.argon);
  try { return await open(key, blob, purpose); } finally { wipe(key); }
}

// ---- the X25519 pair

async function newPair(): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
  const subtle = globalThis.crypto.subtle;
  try {
    const pair = (await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
    return { publicKey: new Uint8Array(await subtle.exportKey("raw", pair.publicKey)), privateKey: new Uint8Array(await subtle.exportKey("pkcs8", pair.privateKey)) };
  } catch { throw new KeyError("unavailable", "This device cannot make keys."); }
}

/** The public half a PKCS8 X25519 private key belongs to, so a swapped or damaged bundle is caught on open. */
async function publicOf(pkcs8: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  try {
    const k = await subtle.importKey("pkcs8", pkcs8 as BufferSource, { name: "X25519" }, true, ["deriveBits"]);
    const jwk = await subtle.exportKey("jwk", k);
    if (typeof jwk.x !== "string") throw new Error("no x");
    return fromBase64(jwk.x.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(jwk.x.length / 4) * 4, "="));
  } catch { throw new KeyError("bad_blob", "That key data is not valid."); }
}

// ---- the bundle

/** The options without a fixed salt or nonce: every blob after the first one a vector pins is sealed with fresh ones. */
const fresh = (o: Options): Options => ({ ...(o.argon ? { argon: o.argon } : {}), ...(o.rand ? { rand: o.rand } : {}) });

/** Sign-up: a new person key, its two wraps, and a new X25519 pair with the private half sealed under the person key. */
export async function makeBundle(password: string, recoveryCode: string, o: Options = {}): Promise<MadeBundle> {
  const rand = o.rand ?? randomBytes;
  const personKey = rand(KEY_BYTES);
  const pair = await newPair();
  try {
    const personKeyByPassword = await sealWithSecret(password, personKey, "password", o);
    const personKeyByRecovery = await sealWithSecret(recoveryCode, personKey, "recovery", fresh(o));
    const privateKeyWrapped = await seal(personKey, pair.privateKey, "private", rand(SALT_BYTES), rand(NONCE_BYTES));
    return {
      personKey, personKeyByPassword: toBase64(personKeyByPassword), personKeyByRecovery: toBase64(personKeyByRecovery),
      publicKey: toBase64(pair.publicKey), privateKeyWrapped: toBase64(privateKeyWrapped),
    };
  } finally { wipe(pair.privateKey); }
}

async function finish(personKey: Uint8Array, bundle: KeyBundle): Promise<OpenedBundle> {
  if (personKey.length !== KEY_BYTES) throw new KeyError("bad_blob", "That key data is not valid.");
  let privateKey: Uint8Array;
  try { privateKey = await open(personKey, fromBase64(bundle.privateKeyWrapped), "private"); }
  catch (e) { wipe(personKey); throw e instanceof KeyError && e.code === "bad_secret" ? new KeyError("bad_blob", "That key data is not valid.") : e; }
  const expected = fromBase64(bundle.publicKey);
  const actual = await publicOf(privateKey);
  if (expected.length !== actual.length || expected.some((b, i) => b !== actual[i])) { wipe(personKey); wipe(privateKey); throw new KeyError("bad_blob", "That key data is not valid."); }
  return { personKey, privateKey };
}

/** Sign-in: the password opens the person key, which opens the private key; the public key must match it. A wrong password is KeyError bad_secret. */
export async function openBundle(password: string, bundle: KeyBundle, o: Options = {}): Promise<OpenedBundle> {
  return finish(await openWithSecret(password, bundle.personKeyByPassword, "password", o), bundle);
}

/** Recovery: the recovery code opens the same person key. */
export async function openWithRecovery(recoveryCode: string, bundle: KeyBundle, o: Options = {}): Promise<OpenedBundle> {
  return finish(await openWithSecret(recoveryCode, bundle.personKeyByRecovery, "recovery", o), bundle);
}

/** Password change: the same person key under a new password. The recovery wrap, the key pair and the person key do not change. */
export async function rewrap(oldPassword: string, newPassword: string, bundle: KeyBundle, o: Options = {}): Promise<KeyBundle> {
  const opened = await openBundle(oldPassword, bundle, o);
  try {
    const next = await sealWithSecret(newPassword, opened.personKey, "password", fresh(o));
    return { ...bundle, personKeyByPassword: toBase64(next) };
  } finally { wipe(opened.personKey); wipe(opened.privateKey); }
}
