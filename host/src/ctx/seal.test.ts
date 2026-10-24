// ctx.seal: round trip, scope isolation, key isolation, tamper and misuse.
import test from "node:test";
import assert from "node:assert/strict";
import { createCtxSeal, SealError } from "./seal.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const enc = new TextEncoder();
const dec = new TextDecoder();

test("seal then unseal returns the same bytes", () => {
  const seal = createCtxSeal({ key: KEY, keyId: "k1" });
  const s = seal.seal(enc.encode("imap password 123"), "mail");
  assert.equal(dec.decode(seal.unseal(s)), "imap password 123");
});

test("a sealed value names its key and scope, carries a nonce, and does not contain the plaintext", () => {
  const seal = createCtxSeal({ key: KEY, keyId: "k1" });
  const s = seal.seal(enc.encode("hunter2hunter2"), "mail");
  assert.equal(s.keyId, "k1/mail");
  assert.ok(s.nonce.length >= 12);
  assert.equal(s.bytes.split(".").length, 2);
  assert.ok(!JSON.stringify(s).includes("hunter2"));
  assert.ok(!JSON.stringify(s).includes(Buffer.from("hunter2hunter2").toString("base64")));
});

test("sealing the same bytes twice gives different nonces and different ciphertext", () => {
  const seal = createCtxSeal({ key: KEY, keyId: "k1" });
  const a = seal.seal(enc.encode("same"), "mail");
  const b = seal.seal(enc.encode("same"), "mail");
  assert.notEqual(a.nonce, b.nonce);
  assert.notEqual(a.bytes, b.bytes);
});

test("a value sealed for one scope does not open under another", () => {
  const seal = createCtxSeal({ key: KEY, keyId: "k1" });
  const s = seal.seal(enc.encode("x"), "mail");
  assert.throws(() => seal.unseal({ ...s, keyId: "k1/google" }), SealError);
});

test("a different key or a different key id does not open it", () => {
  const seal = createCtxSeal({ key: KEY, keyId: "k1" });
  const s = seal.seal(enc.encode("x"), "mail");
  assert.throws(() => createCtxSeal({ key: "ffffffffffffffffffffffffffffffff", keyId: "k1" }).unseal(s), SealError);
  assert.throws(() => createCtxSeal({ key: KEY, keyId: "k2" }).unseal(s), SealError);
});

test("altered bytes, tag or nonce are refused", () => {
  const seal = createCtxSeal({ key: KEY, keyId: "k1" });
  const s = seal.seal(enc.encode("payload"), "mail");
  const [ct, tag] = s.bytes.split(".") as [string, string];
  const flip = (t: string): string => (t[0] === "A" ? "B" : "A") + t.slice(1);
  assert.throws(() => seal.unseal({ ...s, bytes: `${flip(ct)}.${tag}` }), SealError);
  assert.throws(() => seal.unseal({ ...s, bytes: `${ct}.${flip(tag)}` }), SealError);
  assert.throws(() => seal.unseal({ ...s, nonce: flip(s.nonce) }), SealError);
  assert.throws(() => seal.unseal({ ...s, bytes: ct }), SealError);
  assert.throws(() => seal.unseal({ ...s, keyId: "k1" }), SealError);
});

test("misuse: text instead of bytes, a bad scope, a short key, a key id with a slash", () => {
  const seal = createCtxSeal({ key: KEY, keyId: "k1" });
  assert.throws(() => seal.seal("text" as never, "mail"), SealError);
  assert.throws(() => seal.seal(enc.encode("x"), "bad scope!"), SealError);
  assert.throws(() => seal.seal(enc.encode("x"), ""), SealError);
  assert.throws(() => createCtxSeal({ key: "short", keyId: "k1" }), SealError);
  assert.throws(() => createCtxSeal({ key: KEY, keyId: "a/b" }), SealError);
});

test("empty bytes round trip", () => {
  const seal = createCtxSeal({ key: KEY, keyId: "k1" });
  assert.equal(seal.unseal(seal.seal(new Uint8Array(0), "mail")).byteLength, 0);
});

// P-H_01 final run: each named test shows its own ok line in the run on the last commit.
