// Vault crypto (spec 2.17 Encryption split; ARCH 7.8, 4.4). Two ways to hold a value, one random key per item either way:
//   enc=2  Mine. The item's own key seals the fields (AES-256-GCM, the item id and revision bound in as context). The item key is wrapped by the owner's wrap key, which comes from the owner's person
//          key (HKDF) and is handed over for one call by the host's key port: the server keeps only the wrapped key, so an admin, a backup or a stolen database cannot open a Mine item.
//   enc=1  Shared. The fields are sealed under the filler's key. The Filler is a separate in-process service: it holds its own key ring, never exposes a key, never indexes or logs a value, and is the only
//          code that can open a Shared row. The handlers ask it to seal at write time and to open at reveal or fill time.
// Argon2id (RFC 9106, 19 MiB, 2 passes, one lane: the kernel's stretch parameters) turns a password into a wrap key when a person changes it: rewrapMine moves the item key to the new wrap
// key without touching the sealed fields. Key rotation of the filler re-seals Shared rows under the new key; the old key stays in the ring only until the last row has moved.
import crypto from "node:crypto";
import { inspect } from "node:util";
import { aesUnwrap, aesWrap, argon2id, hkdf32 } from "../../../kernel/src/seal/index.ts";
import type { Box } from "../../../kernel/src/seal/index.ts";

export const ENC_SHARED = 1;
export const ENC_MINE = 2;
export type Enc = typeof ENC_SHARED | typeof ENC_MINE;

/** The kernel's stretch parameters, used unchanged for every password-derived vault key. */
export const VAULT_STRETCH = Object.freeze({ memoryKiB: 19456, passes: 2, lanes: 1, tagLength: 32 });

export interface Field { key: string; value: string; secret: boolean }
/** What is stored for one item: never a plain value. `wrapped` exists for Mine only. */
export interface SealedFields { enc: Enc; keyId: string; wrapped?: Box; box: Box; rev: number }

const te = new TextEncoder();
const td = new TextDecoder();
const aadOf = (itemId: string, enc: Enc, rev: number): string => `vyre:vault:${enc}:${itemId}:${rev}`;
const wrapAad = (itemId: string): string => `vyre:vault:itemkey:${itemId}`;
const encode = (fields: Field[]): Uint8Array => te.encode(JSON.stringify(fields.map((f) => [f.key, f.value, f.secret])));
function decode(plain: Uint8Array): Field[] {
  const rows = JSON.parse(td.decode(plain)) as [string, string, boolean][];
  return rows.map(([key, value, secret]) => ({ key, value, secret }));
}

/** A short public name for a key, so a row says which key sealed it without saying anything about the key. */
export function keyIdOf(key: Uint8Array): string {
  return `k_${hkdf32(key, "vyre:vault:keyid", "id").subarray(0, 6).toString("hex")}`;
}

// ---- Mine (enc=2)

/** The wrap key of one person, from the person key the host hands over. */
export const wrapKeyFromPersonKey = (personKey: Uint8Array): Buffer => hkdf32(personKey, "vyre:vault:mine:v1", "wrap");
/** The wrap key from a password: Argon2id, then the same derivation as above. Salt is the person, so two people with one password do not share a key. */
export const wrapKeyFromPassword = (password: string, personId: string): Buffer => wrapKeyFromPersonKey(argon2id(password, `vyre-vault-mine:${personId}`, VAULT_STRETCH));

export function sealMine(itemId: string, fields: Field[], wrapKey: Uint8Array, rev = 1): SealedFields {
  const itemKey = crypto.randomBytes(32);
  return { enc: ENC_MINE, keyId: keyIdOf(wrapKey), wrapped: aesWrap(wrapKey, itemKey, wrapAad(itemId)), box: aesWrap(itemKey, encode(fields), aadOf(itemId, ENC_MINE, rev)), rev };
}

/** Throws when the wrap key is not the owner's. */
export function openMine(itemId: string, sealed: SealedFields, wrapKey: Uint8Array): Field[] {
  if (sealed.enc !== ENC_MINE || !sealed.wrapped) throw new Error("not a Mine row");
  const itemKey = aesUnwrap(wrapKey, sealed.wrapped, wrapAad(itemId));
  return decode(aesUnwrap(itemKey, sealed.box, aadOf(itemId, ENC_MINE, sealed.rev)));
}

/** A new wrap key (a password change, a new person key): the item key moves, the sealed fields do not. */
export function rewrapMine(itemId: string, sealed: SealedFields, oldWrap: Uint8Array, newWrap: Uint8Array): SealedFields {
  if (sealed.enc !== ENC_MINE || !sealed.wrapped) throw new Error("not a Mine row");
  const itemKey = aesUnwrap(oldWrap, sealed.wrapped, wrapAad(itemId));
  return { ...sealed, keyId: keyIdOf(newWrap), wrapped: aesWrap(newWrap, itemKey, wrapAad(itemId)) };
}

// ---- Shared (enc=1): the filler

interface Ring { current: { id: string; key: Buffer }; old: Map<string, Buffer> }

/**
 * The vault service for Shared values. Its key never leaves it (no getter, no toString, no JSON, nothing for a logger to find), and the only way to learn a value is open().
 * `rotate` adds a new current key and keeps the old ones only to open rows that have not been moved yet; `retire` drops an old key once no row names it.
 */
export class Filler {
  readonly #ring: Ring;

  constructor(key: Uint8Array) {
    if (key.length !== 32) throw new RangeError("the filler key is 32 bytes");
    const k = Buffer.from(key);
    this.#ring = { current: { id: keyIdOf(k), key: k }, old: new Map() };
  }

  get keyId(): string { return this.#ring.current.id; }
  /** Key ids still able to open a row. */
  get keyIds(): string[] { return [this.#ring.current.id, ...this.#ring.old.keys()]; }

  seal(itemId: string, fields: Field[], rev = 1): SealedFields {
    return { enc: ENC_SHARED, keyId: this.#ring.current.id, box: aesWrap(this.#ring.current.key, encode(fields), aadOf(itemId, ENC_SHARED, rev)), rev };
  }

  open(itemId: string, sealed: SealedFields): Field[] {
    if (sealed.enc !== ENC_SHARED) throw new Error("not a Shared row");
    const key = sealed.keyId === this.#ring.current.id ? this.#ring.current.key : this.#ring.old.get(sealed.keyId);
    if (!key) throw new Error("the filler has no key for this row");
    return decode(aesUnwrap(key, sealed.box, aadOf(itemId, ENC_SHARED, sealed.rev)));
  }

  /** Make `key` the current key. Rows sealed before still open until they are moved with reseal(). */
  rotate(key: Uint8Array): string {
    if (key.length !== 32) throw new RangeError("the filler key is 32 bytes");
    const next = Buffer.from(key);
    const id = keyIdOf(next);
    if (id === this.#ring.current.id) return id;
    this.#ring.old.set(this.#ring.current.id, this.#ring.current.key);
    this.#ring.current = { id, key: next };
    this.#ring.old.delete(id);
    return id;
  }

  /** The same fields under the current key. */
  reseal(itemId: string, sealed: SealedFields): SealedFields {
    return this.seal(itemId, this.open(itemId, sealed), sealed.rev + 1);
  }

  retire(keyId: string): boolean { return this.#ring.old.delete(keyId); }

  toJSON(): { keyId: string } { return { keyId: this.#ring.current.id }; }
  toString(): string { return `Filler(${this.#ring.current.id})`; }
  [inspect.custom](): string { return this.toString(); }
}

let filler: Filler | null = null;
/** The host gives the service its key at boot (ruling 31); null takes it away. */
export function setFiller(f: Filler | null): void { filler = f; }
export function currentFiller(): Filler | null { return filler; }

// ---- the owner's key, for one call

export interface KeyPort {
  /** The person key of the signed-in person, only for that person; null for anyone else or when the session did not unlock it. */
  personKey(personId: string): Promise<Uint8Array | null>;
}
let port: KeyPort | null = null;
export function setKeyPort(p: KeyPort | null): void { port = p; }
export function currentKeyPort(): KeyPort | null { return port; }
