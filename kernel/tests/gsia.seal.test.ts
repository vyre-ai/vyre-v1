import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { canonical, payloadHash, sameMac } from "../src/seal/wire.ts";
import { aesUnwrap, aesWrap, createKernelSeal, ed25519Pair, ed25519Sign, ed25519Verify, hkdf32, openSeal, sealTo, x25519Pair, x25519Shared } from "../src/seal/box.ts";
import { argon2id, STRETCH, STRETCH_SALT } from "../src/identity/stretch.ts";

const hex = (s: string): Buffer => Buffer.from(s, "hex");
const file = JSON.parse(fs.readFileSync(new URL("../src/seal/vectors/payloadhash-vectors.json", import.meta.url), "utf8"));

// ---- the reviewed 0.6 vectors ----
test("payloadHash reproduces every shared vector, canonical form included", () => {
  assert.ok(file.vectors.length >= 7);
  for (const v of file.vectors) {
    assert.equal(canonical({ op: v.op, space: v.space, fields: v.fields }), v.canonical, v.name);
    assert.equal(payloadHash(v.op, v.space, v.fields), v.hash, v.name);
  }
});

test("a field named op or space cannot change what the hash is about", () => {
  const spoof = payloadHash("grant.role", "spc_aaaaaaaaaaaa", { op: "grant.invite", space: "spc_bbbbbbbbbbbb" });
  assert.notEqual(spoof, payloadHash("grant.invite", "spc_bbbbbbbbbbbb", {}), "the old flat form made these equal");
  assert.notEqual(spoof, payloadHash("grant.role", "spc_aaaaaaaaaaaa", {}));
  assert.equal(new Set(file.vectors.map((v: { hash: string }) => v.hash)).size, file.vectors.length, "every vector hashes differently");
});

// ---- AES-GCM ----
test("AES-256-GCM: round trip, and a wrong key, tag, ciphertext or context all fail", () => {
  const kek = crypto.randomBytes(32), plain = Buffer.from("the vault key");
  const box = aesWrap(kek, plain, "vault:v1:usr_dana");
  assert.deepEqual(aesUnwrap(kek, box, "vault:v1:usr_dana"), plain);
  assert.notEqual(box.iv, aesWrap(kek, plain, "vault:v1:usr_dana").iv, "a fresh iv every time");
  assert.throws(() => aesUnwrap(crypto.randomBytes(32), box, "vault:v1:usr_dana"));
  assert.throws(() => aesUnwrap(kek, box, "vault:v1:usr_sam"), "the context is bound");
  const flip = (s: string): string => { const b = Buffer.from(s, "base64url"); b[0] = b[0]! ^ 1; return b.toString("base64url"); };
  assert.throws(() => aesUnwrap(kek, { ...box, ct: flip(box.ct) }, "vault:v1:usr_dana"));
  assert.throws(() => aesUnwrap(kek, { ...box, tag: flip(box.tag) }, "vault:v1:usr_dana"));
  assert.throws(() => aesWrap(Buffer.alloc(16), plain, "x"), /32 bytes/);
});

test("AES-256-GCM matches the NIST GCM test case 14 (zero key, zero iv, 16 zero bytes)", () => {
  const c = crypto.createCipheriv("aes-256-gcm", Buffer.alloc(32), Buffer.alloc(12));
  const ct = Buffer.concat([c.update(Buffer.alloc(16)), c.final()]);
  assert.equal(ct.toString("hex"), "cea7403d4d606b6e074ec5d3baf39d18");
  assert.equal(c.getAuthTag().toString("hex"), "d0d1c8a799996bf0265b98b5d48ab919");
});

// ---- HKDF ----
test("HKDF-SHA-256 matches RFC 5869 test case 1 (first 32 bytes of the 42 byte output)", () => {
  const ikm = Buffer.alloc(22, 0x0b), salt = hex("000102030405060708090a0b0c"), info = hex("f0f1f2f3f4f5f6f7f8f9");
  assert.equal(hkdf32(ikm, salt, info).toString("hex"), "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf");
  assert.notDeepEqual(hkdf32(ikm, salt, "a"), hkdf32(ikm, salt, "b"), "info separates uses");
});

// ---- Argon2id ----
test("Argon2id: the stated parameters and the pinned full-size answer", () => {
  assert.deepEqual({ ...STRETCH }, { memoryKiB: 19456, passes: 2, lanes: 1, tagLength: 32 });
  assert.equal(argon2id("code\npassword", STRETCH_SALT, STRETCH).toString("hex").slice(0, 16), "6a8a30625a4eb5d7");
});

test("Argon2id: node has its own (24.7 and later), and the secret and the salt both change the key", () => {
  assert.equal(typeof (crypto as unknown as { argon2Sync?: unknown }).argon2Sync, "function", "native argon2 is what runs in production");
  const p = { memoryKiB: 64, passes: 1 };
  assert.notEqual(argon2id("a", "salt-one-xx", p).toString("hex"), argon2id("b", "salt-one-xx", p).toString("hex"));
  assert.notEqual(argon2id("a", "salt-one-xx", p).toString("hex"), argon2id("a", "salt-two-xx", p).toString("hex"));
  assert.equal(argon2id("a", "salt-one-xx", p).length, 32);
});

// ---- Ed25519 ----
test("Ed25519 matches RFC 8032 test 1 (empty message) and refuses a changed message, key or signature", () => {
  const seed = hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60").toString("base64url");
  const pub = hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a").toString("base64url");
  const sig = ed25519Sign(seed, new Uint8Array());
  assert.equal(Buffer.from(sig, "base64url").toString("hex"), "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b");
  assert.equal(ed25519Verify(pub, new Uint8Array(), sig), true);
  assert.equal(ed25519Verify(pub, Buffer.from("x"), sig), false);
  assert.equal(ed25519Verify(ed25519Pair().pub, new Uint8Array(), sig), false);
  assert.equal(ed25519Verify(pub, new Uint8Array(), "AAAA"), false);
  assert.equal(ed25519Verify("not a key", new Uint8Array(), sig), false, "a bad key is false, never a throw");
});

// ---- X25519 seal ----
test("X25519 matches RFC 7748 section 6.1, and sealTo opens only with the right private key and context", () => {
  const a = hex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a").toString("base64url");
  const bPub = hex("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f").toString("base64url");
  assert.equal(x25519Shared(a, bPub).toString("hex"), "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742");
  const me = x25519Pair(), other = x25519Pair();
  const box = sealTo(me.pub, Buffer.from("secret 32 bytes of key material!"), "ctx:1");
  assert.equal(openSeal(me.priv, box, "ctx:1").toString(), "secret 32 bytes of key material!");
  assert.throws(() => openSeal(other.priv, box, "ctx:1"));
  assert.throws(() => openSeal(me.priv, box, "ctx:2"));
});

// ---- kernel seal ----
test("kernel seal: a MAC is good for its purpose and data only, and a short key is refused", () => {
  const k = createKernelSeal(crypto.randomBytes(32));
  const m = k.mac("grants.event", "data");
  assert.equal(k.verify("grants.event", "data", m), true);
  assert.equal(k.verify("chain.token", "data", m), false);
  assert.equal(k.verify("grants.event", "data2", m), false);
  // Tamper with a character that is certain to change: the first one. Replacing the last two with "AA" left the MAC unchanged whenever it already ended in "AA" (about 1 key in 256), which failed a release.
  const tampered = (m[0] === "A" ? "B" : "A") + m.slice(1);
  assert.equal(k.verify("grants.event", "data", tampered), false);
  assert.throws(() => k.mac("Bad Purpose", "x"), /bad purpose/);
  assert.throws(() => createKernelSeal("short"), /16 bytes/);
  assert.equal(sameMac("abc", "abc"), true);
  assert.equal(sameMac("abc", "abd"), false);
  assert.equal(sameMac("abc", "abcd"), false);
});
