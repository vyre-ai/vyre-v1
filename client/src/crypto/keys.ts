// The person key bundle on the client (ruling 63). Nothing here reaches a server in the clear: a person's own key never leaves the device that unwrapped it, and the server stores only the blobs.
//
//   personKey                 32 random bytes. Wraps everything the person keeps for themselves (personal Vault items, their own AI subscriptions).
//   personKeyByPassword       personKey sealed under Argon2id(password).
//   personKeyByRecovery       personKey sealed under Argon2id(recovery code).
//   publicKey                 the X25519 public key (raw 32 bytes, base64).
//   privateKeyWrapped         the X25519 private key (PKCS8) sealed under personKey.
//   formerKey                 (only in a Space whose account was linked to another, rc.17) that Space's earlier person key sealed under personKey. The Space's own data (Mine items, private
//                             chats, personal memory) stays keyed by it, so the client opens it and hands it to that Space instead of personKey. The same password and recovery code open both.
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

export type Purpose = "password" | "recovery" | "private" | "former";
const AAD: Record<Purpose, Uint8Array> = {
  password: new TextEncoder().encode("vyre/person-key/v1/password"),
  recovery: new TextEncoder().encode("vyre/person-key/v1/recovery"),
  private: new TextEncoder().encode("vyre/person-key/v1/private-key"),
  former: new TextEncoder().encode("vyre/person-key/v1/former-key"),
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
export interface KeyBundle { personKeyByPassword: string; personKeyByRecovery: string; publicKey: string; privateKeyWrapped: string; /** a linked Space only: its earlier person key, sealed under personKey */ formerKey?: string }
/** A Space key sealed to a public key: the epoch it belongs to and the blob (base64). */
export interface SealedSpaceKey { epoch: number; wrapped: string }
export interface MadeBundle extends KeyBundle { personKey: Uint8Array; spaceKeys?: SealedSpaceKey[] }
/** `dataKey`: a linked Space's earlier person key (from `formerKey`), the key that Space's data is under and the one to hand it; absent when the Space uses personKey itself. */
export interface OpenedBundle { personKey: Uint8Array; privateKey: Uint8Array; dataKey?: Uint8Array }

/** The key a Space's own data is under: the opened `formerKey` in a linked Space, else the person key. Hand this to the Space, never the other. */
export const heldKeyOf = (opened: OpenedBundle): Uint8Array => opened.dataKey ?? opened.personKey;
/** Wipe everything an opened bundle holds. */
export const wipeOpened = (opened: OpenedBundle): void => { wipe(opened.personKey); wipe(opened.privateKey); if (opened.dataKey) wipe(opened.dataKey); };

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
  if (!bundle.formerKey) return { personKey, privateKey };
  let dataKey: Uint8Array;
  try { dataKey = await open(personKey, fromBase64(bundle.formerKey), "former"); }
  catch { wipe(personKey); wipe(privateKey); throw new KeyError("bad_blob", "That key data is not valid."); }
  if (dataKey.length !== KEY_BYTES) { wipe(personKey); wipe(privateKey); wipe(dataKey); throw new KeyError("bad_blob", "That key data is not valid."); }
  return { personKey, privateKey, dataKey };
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
  } finally { wipeOpened(opened); }
}

/** Re-wrap an already opened person key after a recovery possession proof; preserve every other wrapped key. */
export async function wrapPersonKeyWithPassword<T extends KeyBundle>(personKey:Uint8Array,newPassword:string,bundle:T,o:Options={}):Promise<T>{
 if(personKey.length!==KEY_BYTES)throw new KeyError("bad_blob","That key data is not valid.");
 return{...bundle,personKeyByPassword:toBase64(await sealWithSecret(newPassword,personKey,"password",fresh(o)))};
}

/** The bundle as a Space hands it back: the recovery wrap is missing when the person never kept a code. */
export type StoredBundle = Omit<KeyBundle, "personKeyByRecovery"> & { personKeyByRecovery?: string };

/**
 * One account in another Space: the password must open the bundle the person already has, and the same person key, the same password and recovery wraps and the same key pair go to the
 * new Space, with a new Space key sealed for it. No new password and no new recovery code. An absent recovery wrap stays absent (`personKeyByRecovery` is then "").
 * A `formerKey` belongs to the Space it came from (a linked account there) and is never carried: the new Space's data is under the person key itself.
 */
export async function carryBundle(password: string, bundle: StoredBundle, spaceId: string, o: Options = {}): Promise<MadeBundle & { spaceKeys: SealedSpaceKey[] }> {
  const { formerKey: _former, ...own } = bundle;
  const opened = await openBundle(password, { ...own, personKeyByRecovery: own.personKeyByRecovery ?? "" }, o);
  wipe(opened.privateKey);
  try {
    const spaceKey = await makeSpaceKey(own.publicKey, spaceId, o.rand ? { rand: o.rand } : {});
    return { personKey: opened.personKey, personKeyByPassword: own.personKeyByPassword, personKeyByRecovery: own.personKeyByRecovery ?? "", publicKey: own.publicKey, privateKeyWrapped: own.privateKeyWrapped, spaceKeys: [spaceKey] };
  } catch (e) { wipe(opened.personKey); throw e; }
}

/** What a Space hands back to a recovery: the recovery wrap and the key pair, never the password wrap. */
export type RecoveryBundle = Pick<KeyBundle, "publicKey" | "privateKeyWrapped"> & { personKeyByRecovery: string };

/**
 * One account in another Space, opened with the recovery code (rc.17): for a person who signs in to their Space with Google or Microsoft and never kept the password that protects their keys.
 * The code opens the same person key, a password the person chooses now wraps it for the new Space, and the recovery wrap and key pair go along unchanged, so the same recovery code works there.
 */
export async function carryWithRecovery(recoveryCode: string, newPassword: string, bundle: RecoveryBundle, spaceId: string, o: Options = {}): Promise<MadeBundle & { spaceKeys: SealedSpaceKey[] }> {
  const opened = await openWithRecovery(recoveryCode, { personKeyByPassword: "", personKeyByRecovery: bundle.personKeyByRecovery, publicKey: bundle.publicKey, privateKeyWrapped: bundle.privateKeyWrapped }, o);
  wipe(opened.privateKey);
  try {
    const personKeyByPassword = toBase64(await sealWithSecret(newPassword, opened.personKey, "password", fresh(o)));
    const spaceKey = await makeSpaceKey(bundle.publicKey, spaceId, o.rand ? { rand: o.rand } : {});
    return { personKey: opened.personKey, personKeyByPassword, personKeyByRecovery: bundle.personKeyByRecovery, publicKey: bundle.publicKey, privateKeyWrapped: bundle.privateKeyWrapped, spaceKeys: [spaceKey] };
  } catch (e) { wipe(opened.personKey); throw e; }
}

/** How one side of a link is proved on this device: the password that opens its bundle, or its recovery code. */
export type Secret = { password: string } | { recoveryCode: string };
const openBy = (secret: Secret, bundle: StoredBundle, o: Options): Promise<OpenedBundle> =>
  "password" in secret ? openBundle(secret.password, { ...bundle, personKeyByRecovery: bundle.personKeyByRecovery ?? "" }, o)
    : openWithRecovery(secret.recoveryCode, { ...bundle, personKeyByRecovery: bundle.personKeyByRecovery ?? "" }, o);

/**
 * Use one account everywhere (rc.17): the bundle for the Space whose account is not kept. It takes the kept account's password and recovery wraps and key pair, so the kept password and
 * recovery code open it; each of that Space's keys is opened with its own private key and sealed again to the kept public key, epoch for epoch; and the key that Space's data is under
 * (its person key, or its own earlier `formerKey`) is sealed under the kept person key as `formerKey`, so nothing it holds is lost. The kept password must open the kept bundle. Throws
 * KeyError bad_secret for either secret, and `bad_blob` when both are already one account.
 */
export async function linkBundle(keep: { password: string; bundle: StoredBundle }, other: { secret: Secret; bundle: StoredBundle & { spaceKeys: SealedSpaceKey[] } }, spaceId: string, o: Options = {}): Promise<KeyBundle & { spaceKeys: SealedSpaceKey[]; formerKey: string }> {
  if (keep.bundle.publicKey === other.bundle.publicKey) throw new KeyError("bad_blob", "These are already one account.");
  const { formerKey: _keptFormer, ...kept } = keep.bundle;
  const k = await openBundle(keep.password, { ...kept, personKeyByRecovery: kept.personKeyByRecovery ?? "" }, o);
  let theirs: OpenedBundle | null = null;
  try {
    theirs = await openBy(other.secret, other.bundle, o);
    const spaceKeys: SealedSpaceKey[] = [];
    for (const sealed of other.bundle.spaceKeys) {
      const raw = await openSpaceKey(theirs.privateKey, sealed, spaceId);
      try { spaceKeys.push(await sealSpaceKey(raw, kept.publicKey, spaceId, sealed.epoch, o.rand ? { rand: o.rand } : {})); } finally { wipe(raw); }
    }
    const rand = o.rand ?? randomBytes;
    const formerKey = toBase64(await seal(k.personKey, heldKeyOf(theirs), "former", rand(SALT_BYTES), rand(NONCE_BYTES)));
    return { personKeyByPassword: kept.personKeyByPassword, personKeyByRecovery: kept.personKeyByRecovery ?? "", publicKey: kept.publicKey, privateKeyWrapped: kept.privateKeyWrapped, spaceKeys, formerKey };
  } finally { wipeOpened(k); if (theirs) wipeOpened(theirs); }
}

/** A new recovery code: the password opens the person key, which is sealed again under the new code. Only the recovery wrap changes; the old code no longer opens what this returns. */
export async function rewrapRecovery(password: string, newRecoveryCode: string, bundle: StoredBundle, o: Options = {}): Promise<string> {
  const opened = await openBundle(password, { ...bundle, personKeyByRecovery: bundle.personKeyByRecovery ?? "" }, o);
  try { return toBase64(await sealWithSecret(newRecoveryCode, opened.personKey, "recovery", fresh(o))); } finally { wipeOpened(opened); }
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
  const spaceKey = (o.rand ?? randomBytes)(KEY_BYTES);
  try { return await sealSpaceKey(spaceKey, publicKey, spaceId, 0, o); } finally { wipe(spaceKey); }
}

/** Seal a Space key the caller holds (a new one, or one just opened for a link) to a public key, for this Space and epoch. The caller wipes `spaceKey`. */
export async function sealSpaceKey(spaceKey: Uint8Array, publicKey: string, spaceId: string, epoch: number, o: SpaceOptions = {}): Promise<SealedSpaceKey> {
  await assertSupported();
  if (typeof spaceId !== "string" || spaceId === "" || !Number.isInteger(epoch) || epoch < 0 || spaceKey.length !== KEY_BYTES) throw badSpaceKey();
  const rand = o.rand ?? randomBytes;
  const subtle = globalThis.crypto.subtle;
  const recipient = fromBase64(publicKey);
  if (recipient.length !== X25519_BYTES) throw badSpaceKey();
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
    const aes = await spaceAes(shared, salt, spaceId, epoch, "encrypt");
    const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource, additionalData: utf8(spaceTag(spaceId, epoch)) as BufferSource }, aes, spaceKey as BufferSource));
    return { epoch, wrapped: toBase64(concat(Uint8Array.of(SPACE_KEY_VERSION), ephPublic, salt, nonce, ct)) };
  } catch (e) {
    if (e instanceof KeyError) throw e;
    throw new KeyError("unavailable", "This device cannot make keys.");
  } finally { if (shared) wipe(shared); }
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
