// @ts-check
// The package entry and the @noble provider: every export index.d.ts promises exists, and nobleCrypto drives the injected functions.

import test from "node:test";
import assert from "node:assert/strict";
import * as api from "../index.js";
import { Initiator } from "../noise.js";
import { utf8 } from "../bytes.js";

test("index: every runtime export index.d.ts declares is there", () => {
  const names = ["PAIR_BASE", "REMOVED", "parsePairUrl", "pair", "pairOffer", "pairTicket", "resolveTicket", "keyFingerprint", "sameRelay", "deviceKey", "defaultVisibility",
    "Connection", "connect", "openChannel", "request", "RelaySocket", "createPaths", "health", "watch", "webCrypto", "createDeviceKey", "memoryKeyStore", "indexedDbKeyStore",
    "nobleCrypto", "shellDeviceKey", "SEED_BYTES", "QR_PREFIX", "newSeed", "seedToWords", "wordsToSeed", "seedQrText", "parseSeedText", "qrMatrix", "qrLines", "qrArt",
    "createWsBridge", "webviewShim", "base64url", "fromBase64url", "base32", "utf8", "fromUtf8", "concat", "equal"];
  for (const n of names) assert.ok(n in api, n);
  assert.equal(api.PAIR_BASE, "https://vyre.run/pair");
});

/** @noble's function shapes with recording stubs: enough to see which injected function each provider call reaches. */
function stubs() {
  /** @type {string[]} */
  const calls = [];
  const fill = (/** @type {number} */ n, /** @type {number} */ v) => new Uint8Array(n).fill(v);
  return {
    calls,
    n: {
      x25519: {
        getPublicKey: (/** @type {Uint8Array} */ priv) => { calls.push("pub"); return fill(32, priv[0] + 1); },
        getSharedSecret: (/** @type {Uint8Array} */ priv, /** @type {Uint8Array} */ pub) => { calls.push("dh"); return fill(32, priv[0] ^ pub[0]); },
        utils: { randomSecretKey: () => { calls.push("secret"); return fill(32, 5); } },
      },
      sha256: (/** @type {Uint8Array} */ b) => { calls.push("sha"); return fill(32, b.length); },
      hmac: (/** @type {unknown} */ hash, /** @type {Uint8Array} */ key, /** @type {Uint8Array} */ msg) => { calls.push(typeof hash === "function" ? "hmac" : "hmac?"); return fill(32, key.length + msg.length); },
      gcm: (/** @type {Uint8Array} */ key, /** @type {Uint8Array} */ nonce, /** @type {Uint8Array | undefined} */ aad) => ({
        encrypt: (/** @type {Uint8Array} */ pt) => { calls.push(`seal ${key.length} ${nonce.length} ${aad ? aad.length : 0}`); return Uint8Array.from([...pt, 9]); },
        decrypt: (/** @type {Uint8Array} */ ct) => { calls.push("open"); return ct.slice(0, -1); },
      }),
      randomBytes: (/** @type {number} */ len) => { calls.push("random"); return fill(len, 3); },
    },
  };
}

test("noble provider: key pairs, DH, hashes and AEAD go to the injected functions", async () => {
  const { n, calls } = stubs();
  const c = api.nobleCrypto(n);
  const kp = await c.generateKeyPair();
  assert.deepEqual(kp.privateKey, new Uint8Array(32).fill(5));
  assert.deepEqual(kp.publicKey, new Uint8Array(32).fill(6));
  assert.deepEqual(await c.dh(new Uint8Array(32).fill(1), new Uint8Array(32).fill(3)), new Uint8Array(32).fill(2));
  assert.equal((await c.sha256(new Uint8Array(7)))[0], 7);
  assert.equal((await c.hmacSha256(new Uint8Array(4), new Uint8Array(5)))[0], 9);
  const sealed = await c.aesGcmEncrypt(new Uint8Array(32), new Uint8Array(12), utf8("ad"), Uint8Array.from([1, 2]));
  assert.deepEqual([...sealed], [1, 2, 9]);
  assert.deepEqual([...(await c.aesGcmDecrypt(new Uint8Array(32), new Uint8Array(12), utf8("ad"), sealed))], [1, 2]);
  assert.equal((await c.randomBytes(4)).length, 4);
  const imported = await /** @type {any} */ (c).importKeyPair(new Uint8Array(32).fill(8));
  assert.deepEqual(imported.publicKey, new Uint8Array(32).fill(9));
  assert.ok(calls.includes("seal 32 12 2") && calls.includes("open") && calls.includes("hmac") && calls.includes("dh"));
  for (const missing of ["x25519", "sha256", "hmac", "gcm", "randomBytes"]) {
    assert.throws(() => api.nobleCrypto({ ...n, [missing]: undefined }), new RegExp(missing));
  }
});

test("noble provider: the handshake's first message goes out through it, and a box reading it sees the static key", async () => {
    const { n } = stubs();
  const c = api.nobleCrypto(n);
  const s = await c.generateKeyPair();
  const rs = new Uint8Array(32).fill(7);
  const i = new Initiator(c, { s, rs });
  const m1 = await i.writeMessage(utf8("{}"));
  assert.equal(m1.length, 32 + 33 + 3, "e (32), the sealed static key, the sealed payload: each as long as the injected AEAD makes it");
});
