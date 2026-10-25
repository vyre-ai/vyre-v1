// @ts-check
// The app's half of an install code (an identity-signed code the server's installer checks) and the signed hello a device the person's identity chain lists
// sends first. Both are checked against independent WebCrypto verification of the bytes the files say they sign.

import test from "node:test";
import assert from "node:assert/strict";
import { mintPairCode, installCommand, PAIR_TAG, PAIR_VERSION, PAIR_TTL_MS, PAIR_CODE_LEN } from "../pair-install.js";
import { chainHello } from "../chainhello.js";
import { base32, base64url, concat, fromBase64url, fromUtf8, utf8, hex } from "../bytes.js";

const subtle = globalThis.crypto.subtle;
const PERSON = "per_" + "a".repeat(26);
const sha = async (/** @type {Uint8Array} */ b) => new Uint8Array(await subtle.digest("SHA-256", b));

async function identity() {
  const kp = /** @type {CryptoKeyPair} */ (await subtle.generateKey("Ed25519", false, ["sign", "verify"]));
  const publicKey = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
  return { publicKey, sign: async (/** @type {Uint8Array} */ m) => new Uint8Array(await subtle.sign("Ed25519", kp.privateKey, m)), verify: (/** @type {Uint8Array} */ sig, /** @type {Uint8Array} */ m) => subtle.verify("Ed25519", kp.publicKey, sig, m) };
}

test("install code: 179 signed bytes the installer can check, good for 30 minutes", async () => {
  const id = await identity();
  const secret = new Uint8Array(16).fill(1), fingerprint = new Uint8Array(16).fill(2), nonce = new Uint8Array(16).fill(3);
  const now = 1_760_000_000_000;
  const { code, exp, person } = await mintPairCode({ person: PERSON, publicKey: base64url(id.publicKey), sign: id.sign, secret, fingerprint, now: () => now, random: n => nonce.slice(0, n) });
  assert.equal(person, PERSON);
  assert.equal(exp, Math.floor(now / 1000) + 1800);
  assert.equal(PAIR_TTL_MS, 30 * 60 * 1000);
  assert.equal(code.length, PAIR_CODE_LEN);
  const raw = fromBase64url(code);
  assert.equal(raw.length, 1 + 4 + 16 + 32 + 16 + 16 + PERSON.length + 64);
  assert.equal(raw[0], PAIR_VERSION);
  assert.equal(new DataView(raw.buffer, raw.byteOffset).getUint32(1), exp);
  assert.deepEqual(raw.slice(5, 21), nonce);
  assert.deepEqual(raw.slice(21, 53), id.publicKey);
  assert.deepEqual(raw.slice(53, 69), secret);
  assert.deepEqual(raw.slice(69, 85), fingerprint);
  assert.equal(fromUtf8(raw.slice(85, 85 + PERSON.length)), PERSON);
  const body = raw.slice(0, raw.length - 64), sig = raw.slice(raw.length - 64);
  const signed = concat(utf8(PAIR_TAG), body);
  assert.equal(await id.verify(sig, signed), true, "the identity key signed the tagged bytes");
  assert.equal(await id.verify(sig, body), false, "the tag is part of what is signed");
});

test("install code: refuses input the installer would refuse, and prints the one install line", async () => {
  const id = await identity();
  const good = { person: PERSON, publicKey: base64url(id.publicKey), sign: id.sign, secret: new Uint8Array(16), fingerprint: new Uint8Array(16) };
  const code = async (/** @type {any} */ o) => { try { await mintPairCode({ ...good, ...o }); } catch (e) { return /** @type {any} */ (e).code; } return "none"; };
  assert.equal(await code({}), "none");
  assert.equal(await code({ person: "alex" }), "bad_input");
  assert.equal(await code({ person: "per_" + "A".repeat(26) }), "bad_input");
  assert.equal(await code({ publicKey: base64url(new Uint8Array(31)) }), "bad_input");
  assert.equal(await code({ secret: new Uint8Array(15) }), "bad_input");
  assert.equal(await code({ fingerprint: new Uint8Array(17) }), "bad_input");
  assert.equal(await code({ sign: async () => new Uint8Array(63) }), "bad_input");
  assert.equal(installCommand("CODE"), "curl -fsSL vyre.run/i | VYRE_CODE=CODE sh", "the code is an environment variable, never an argument");
  const short = await mintPairCode({ ...good, ttlMs: 60_000, now: () => 5000 });
  assert.equal(short.exp, 5 + 60);
});

test("chain hello: the chain key signs this device, this server, this identity and this moment", async () => {
  const id = await identity();
  const devicePub = new Uint8Array(32).fill(4);
  const signed = /** @type {Uint8Array[]} */ ([]);
  const base = { sha256: sha, devicePub, box: "BOXKEY", identity: "per_x", entry: "ent_1", now: 1_760_000_000_000, sign: async (/** @type {Uint8Array} */ m) => { signed.push(m); return id.sign(m); } };
  const h = await chainHello(base);
  assert.equal(h.channel, base32(await sha(devicePub)).slice(0, 16), "the relay's id of this device key");
  assert.equal(h.ts, base.now);
  assert.equal(fromBase64url(h.nonce).length, 18);
  assert.deepEqual({ identity: h.identity, entry: h.entry }, { identity: "per_x", entry: "ent_1" });
  assert.equal("pk" in h || "name" in h, false);
  assert.equal(fromUtf8(signed[0]), `vyre-chain-hello-v1\nBOXKEY\nper_x\nent_1\n${h.ts}\n${h.nonce}\n${h.channel}\n-`);
  assert.equal(await id.verify(fromBase64url(h.sig), signed[0]), true);

  const again = await chainHello(base);
  assert.notEqual(again.nonce, h.nonce, "a fresh nonce every time");
  const withKey = await chainHello({ ...base, presencePublicKey: "PRESENCE", name: "Alex's laptop" });
  const want = hex(await sha(utf8("PRESENCE")));
  assert.equal(withKey.pk, want, "the presence key is bound by its hash");
  assert.equal(withKey.name, "Alex's laptop");
  assert.ok(fromUtf8(signed.at(-1) ?? new Uint8Array()).endsWith(`\n${want}`));
});
