// Personal memory under the person's own key (owner ruling 3 Nov 2026; spec b7; ARCH 1261). Same family as the Mine Vault: every key here is HKDF of the person key, which the server holds only in the
// keyring while that person is signed in (host/src/seams/keyring.ts) and their own computer holds in its local keyring. Two sealed forms, both opened only with the person key:
//
//   pm1.o.<tag>.<iv>.<ct>.<gcm>          own     AES-256-GCM under rowKey = HKDF(personKey, "vyre:memory:v1", "rows"). Written while the key is held, and what the background job turns every row into.
//   pm1.p.<tag>.<eph>.<iv>.<ct>.<gcm>    public  sealed to the person's memory public key (X25519, HKDF, AES-256-GCM, as sealTo): written while the key is not held, so capture and nightly jobs
//                                                write a person's new facts with no private key.
//
// The X25519 pair is derived: seed = HKDF(personKey, "vyre:memory:v1", "x25519"), so any node holding the person key gets the same pair and only the public half is ever stored. `tag` is a short
// one-way name of that public key, so a row says which key sealed it. The caller's context (who owns the row) is bound as GCM additional data. base64url never holds ".", so "." splits the parts.
import crypto from "node:crypto";
import { aesUnwrap, aesWrap, hkdf32, sealTo, x25519Public } from "./box.ts";

const SALT = "vyre:memory:v1";
const PREFIX_OWN = "pm1.o.";
const PREFIX_PUB = "pm1.p.";
const B64 = /^[A-Za-z0-9_-]+$/;

/** A short public name of a memory public key. */
export const memoryKeyTag = (pub: string): string => hkdf32(Buffer.from(pub, "base64url"), SALT, "tag").subarray(0, 12).toString("base64url");

/** Which form a sealed value is in: "own", "public", or null for anything else (a legacy server-sealed value). */
export function memorySealForm(s: string): "own" | "public" | null {
  return s.startsWith(PREFIX_OWN) ? "own" : s.startsWith(PREFIX_PUB) ? "public" : null;
}
/** The tag of the key that sealed a value, or null. */
export function memorySealTag(s: string): string | null {
  const form = memorySealForm(s);
  return form ? (s.split(".")[2] ?? null) : null;
}

/** Seal text to a person's memory public key: no private key needed, so it works while the person is offline. */
export function sealToMemoryKey(pub: string, plain: string, aad: string): string {
  if (!B64.test(pub) || Buffer.from(pub, "base64url").length !== 32) throw new Error("a memory public key is 32 bytes");
  const b = sealTo(pub, Buffer.from(plain, "utf8"), aad);
  return `${PREFIX_PUB}${memoryKeyTag(pub)}.${b.eph}.${b.iv}.${b.ct}.${b.tag}`;
}

const X25519_PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");

/**
 * The memory keys of one person, made from their person key for as long as a caller needs them. No getter hands a key out; `wipe` overwrites the row key. The person key itself is not kept.
 */
export class PersonMemoryKey {
  readonly pub: string;
  readonly tag: string;
  #rows: Buffer;
  #priv: crypto.KeyObject | null;

  private constructor(personKey: Uint8Array) {
    if (personKey.length !== 32) throw new RangeError("a person key is 32 bytes");
    this.#rows = hkdf32(personKey, SALT, "rows");
    const seed = hkdf32(personKey, SALT, "x25519");
    this.pub = x25519Public(seed.toString("base64url"));
    this.tag = memoryKeyTag(this.pub);
    this.#priv = crypto.createPrivateKey({ key: Buffer.concat([X25519_PKCS8, seed]), format: "der", type: "pkcs8" });
    seed.fill(0);
  }

  static from(personKey: Uint8Array): PersonMemoryKey { return new PersonMemoryKey(personKey); }

  /** The own form: AES-256-GCM under the row key. */
  seal(plain: string, aad: string): string {
    if (!this.#priv) throw new Error("this memory key was wiped");
    const b = aesWrap(this.#rows, Buffer.from(plain, "utf8"), aad);
    return `${PREFIX_OWN}${this.tag}.${b.iv}.${b.ct}.${b.tag}`;
  }

  /** Open either form. Throws for a value sealed under another key, another context, or changed bytes. */
  open(sealed: string, aad: string): string {
    if (!this.#priv) throw new Error("this memory key was wiped");
    const p = sealed.split(".");
    if (p[0] !== "pm1" || p[2] !== this.tag) throw new Error("this value was sealed under a different key");
    if (p[1] === "o" && p.length === 6) return aesUnwrap(this.#rows, { iv: p[3]!, ct: p[4]!, tag: p[5]! }, aad).toString("utf8");
    if (p[1] === "p" && p.length === 7) {
      const eph = p[3]!;
      const shared = crypto.diffieHellman({ privateKey: this.#priv, publicKey: crypto.createPublicKey({ key: { kty: "OKP", crv: "X25519", x: eph }, format: "jwk" }) });
      const k = hkdf32(shared, eph, "vyre:seal:to:v1");
      try { return aesUnwrap(k, { iv: p[4]!, ct: p[5]!, tag: p[6]! }, aad).toString("utf8"); } finally { k.fill(0); shared.fill(0); }
    }
    throw new Error("this sealed value is malformed");
  }

  wipe(): void { this.#rows.fill(0); this.#priv = null; }

  toJSON(): { tag: string } { return { tag: this.tag }; }
  toString(): string { return `PersonMemoryKey(${this.tag})`; }
}
