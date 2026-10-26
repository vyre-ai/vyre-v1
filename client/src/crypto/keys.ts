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
// The Space key (ruling 72) is made on the client when a Space is claimed and sealed to the owner's X25519 public key, so the server stores it and never sees it: version (1) | ephemeral public key (32) |
// HKDF salt (16) | nonce (12) | AES-256-GCM ciphertext+tag. The AES key is HKDF-SHA256 of the X25519 shared secret, and the Space and the epoch are bound twice, as the HKDF info and as the GCM additional
// data ("vyre/space-key/v1|<spaceId>|<epoch>"), so a sealed key does not open for another Space or epoch.
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
/** A Space key sealed to a public key: the epoch it belongs to and the blob (base64). */
export interface SealedSpaceKey { epoch: number; wrapped: string }
export interface MadeBundle extends KeyBundle { personKey: Uint8Array; spaceKeys?: SealedSpaceKey[] }
export interface OpenedBundle { personKey: Uint8Array; privateKey: Uint8Array }

/** Test seams: a cheaper Argon2id, and fixed salt, nonce and randomness for known-answer vectors. Production code passes none. */
export interface Options { argon?: ArgonParams; rand?: Rand; salt?: Uint8Array; nonce?: Uint8Array; spaceId?: string }
/** Test seams for the Space key: fixed randomness, and a fixed ephemeral X25519 private key (PKCS8). */
export interface SpaceOptions { rand?: Rand; ephemeral?: Uint8Array }

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

// ---- support

export const UNSUPPORTED_MESSAGE = "This browser can't protect your keys. Update it, or open Vyre in a current Chrome, Safari or Firefox.";
let supported: Promise<boolean> | null = null;

/** Does this browser have what the bundle needs: WebCrypto with AES-GCM and X25519? Probes by using them, once. Native builds that lack X25519 will need a polyfill. */
export function isSupported(subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle): Promise<boolean> {
  if (subtle === globalThis.crypto?.subtle && supported) return supported;
  const probe = (async (): Promise<boolean> => {
    if (!subtle) return false;
    try {
      await subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"]);
      await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
      return true;
    } catch { return false; }
  })();
  if (subtle === globalThis.crypto?.subtle) supported = probe;
  return probe;
}

/** Call at sign-up and sign-in before anything else: a clear message for an old browser, instead of a failure deep inside key derivation. Every bundle function calls it too. */
export async function assertSupported(subtle?: SubtleCrypto): Promise<void> {
  if (!(await isSupported(subtle ?? globalThis.crypto?.subtle))) throw new KeyError("unavailable", UNSUPPORTED_MESSAGE);
}

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
  await assertSupported();
  const rand = o.rand ?? randomBytes;
  const personKey = rand(KEY_BYTES);
  const pair = await newPair();
  try {
    const personKeyByPassword = await sealWithSecret(password, personKey, "password", o);
    const personKeyByRecovery = await sealWithSecret(recoveryCode, personKey, "recovery", fresh(o));
    const privateKeyWrapped = await seal(personKey, pair.privateKey, "private", rand(SALT_BYTES), rand(NONCE_BYTES));
    const spaceKeys = o.spaceId ? [await makeSpaceKey(toBase64(pair.publicKey), o.spaceId, o.rand ? { rand: o.rand } : {})] : undefined;
    return {
      personKey, ...(spaceKeys ? { spaceKeys } : {}), personKeyByPassword: toBase64(personKeyByPassword), personKeyByRecovery: toBase64(personKeyByRecovery),
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
  await assertSupported();
  return finish(await openWithSecret(password, bundle.personKeyByPassword, "password", o), bundle);
}

/** Recovery: the recovery code opens the same person key. */
export async function openWithRecovery(recoveryCode: string, bundle: KeyBundle, o: Options = {}): Promise<OpenedBundle> {
  await assertSupported();
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

// ---- the Space key (ruling 72)

export const SPACE_KEY_VERSION = 1;
const X25519_BYTES = 32;
const spaceTag = (spaceId: string, epoch: number): string => `vyre/space-key/v1|${spaceId}|${epoch}`;
const utf8 = (v: string): Uint8Array => new TextEncoder().encode(v);

async function spaceAes(shared: Uint8Array, salt: Uint8Array, spaceId: string, epoch: number, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const ikm = await subtle.importKey("raw", shared as BufferSource, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: utf8(spaceTag(spaceId, epoch)) as BufferSource }, ikm, { name: "AES-GCM", length: 256 }, false, [usage]);
}

const badSpaceKey = (): KeyError => new KeyError("bad_blob", "That key data is not valid.");

/**
 * A new Space key (32 random bytes, epoch 0) sealed to the owner's X25519 public key (base64, the `publicKey` of the bundle). The key exists in the clear only in this function; the server gets the
 * sealed blob. Only the owner's private key opens it, and only for this Space and this epoch.
 */
export async function makeSpaceKey(publicKey: string, spaceId: string, o: SpaceOptions = {}): Promise<SealedSpaceKey> {
  await assertSupported();
  if (typeof spaceId !== "string" || spaceId === "") throw badSpaceKey();
  const rand = o.rand ?? randomBytes;
  const subtle = globalThis.crypto.subtle;
  const recipient = fromBase64(publicKey);
  if (recipient.length !== X25519_BYTES) throw badSpaceKey();
  const spaceKey = rand(KEY_BYTES);
  let shared: Uint8Array | null = null;
  try {
    const theirs = await subtle.importKey("raw", recipient as BufferSource, { name: "X25519" }, false, []);
    let ephPublic: Uint8Array, ephPrivate: CryptoKey;
    if (o.ephemeral) {
      ephPublic = await publicOf(o.ephemeral);
      ephPrivate = await subtle.importKey("pkcs8", o.ephemeral as BufferSource, { name: "X25519" }, false, ["deriveBits"]);
    } else {
      const pair = (await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
      ephPublic = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
      ephPrivate = pair.privateKey;
    }
    shared = new Uint8Array(await subtle.deriveBits({ name: "X25519", public: theirs }, ephPrivate, 256));
    const salt = rand(SALT_BYTES), nonce = rand(NONCE_BYTES);
    const aes = await spaceAes(shared, salt, spaceId, 0, "encrypt");
    const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource, additionalData: utf8(spaceTag(spaceId, 0)) as BufferSource }, aes, spaceKey as BufferSource));
    return { epoch: 0, wrapped: toBase64(concat(Uint8Array.of(SPACE_KEY_VERSION), ephPublic, salt, nonce, ct)) };
  } catch (e) {
    if (e instanceof KeyError) throw e;
    throw new KeyError("unavailable", "This device cannot make keys.");
  } finally { wipe(spaceKey); if (shared) wipe(shared); }
}

/** Open a sealed Space key with the owner's private key (PKCS8, as `openBundle` returns it). A wrong key, Space or epoch, or a changed byte, is `bad_secret`. The caller wipes the result when done. */
export async function openSpaceKey(privateKey: Uint8Array, sealed: SealedSpaceKey, spaceId: string): Promise<Uint8Array> {
  await assertSupported();
  const blob = fromBase64(sealed.wrapped);
  const head = 1 + X25519_BYTES + SALT_BYTES + NONCE_BYTES;
  if (blob.length < head + KEY_BYTES + TAG_BYTES || !Number.isInteger(sealed.epoch) || sealed.epoch < 0) throw badSpaceKey();
  if (blob[0] !== SPACE_KEY_VERSION) throw new KeyError("unsupported_version", "That key data is from a newer version of Vyre.");
  const ephPublic = blob.subarray(1, 1 + X25519_BYTES), salt = blob.subarray(1 + X25519_BYTES, 1 + X25519_BYTES + SALT_BYTES), nonce = blob.subarray(1 + X25519_BYTES + SALT_BYTES, head), ct = blob.subarray(head);
  const subtle = globalThis.crypto.subtle;
  let shared: Uint8Array | null = null;
  try {
    const theirs = await subtle.importKey("raw", ephPublic as BufferSource, { name: "X25519" }, false, []);
    const mine = await subtle.importKey("pkcs8", privateKey as BufferSource, { name: "X25519" }, false, ["deriveBits"]);
    shared = new Uint8Array(await subtle.deriveBits({ name: "X25519", public: theirs }, mine, 256));
    const aes = await spaceAes(shared, salt, spaceId, sealed.epoch, "decrypt");
    return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource, additionalData: utf8(spaceTag(spaceId, sealed.epoch)) as BufferSource }, aes, ct as BufferSource));
  } catch { throw new KeyError("bad_secret", "That key does not open this Space's key."); } finally { if (shared) wipe(shared); }
}
