// from vyre 0.6.9 relay/client/shellkey.test.js@ac3c665d5
// @ts-check
// A desktop shell holds the device key natively; the page gets a public key and a marker, and every Diffie-Hellman is a call into the shell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shellDeviceKey } from "../shellkey.js";
import { base64url, fromBase64url } from "../bytes.js";
import { crypto, link } from "./box.js";

const subtle = globalThis.crypto.subtle;
const X = { name: "X25519" };

/** A shell's native side, in process: the private key lives only in this closure and is not extractable. */
async function fakeShell() {
  const kp = /** @type {CryptoKeyPair} */ (await subtle.generateKey(X, false, ["deriveBits"]));
  const publicKey = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
  /** @type {string[]} */
  const calls = [];
  const invoke = async (/** @type {string} */ cmd, /** @type {any} */ args) => {
    calls.push(cmd);
    if (cmd === "device_key_pub") return base64url(publicKey);
    if (cmd === "device_key_dh") {
      const remote = await subtle.importKey("raw", fromBase64url(args.remote), X, true, []);
      return base64url(new Uint8Array(await subtle.deriveBits({ name: "X25519", public: remote }, kp.privateKey, 256)));
    }
    throw new Error("no such command");
  };
  return { invoke, calls, publicKey };
}

test("shell device key: the page gets a public key and a marker, never bytes, and dh goes to the shell", async () => {
  const shell = await fakeShell();
  const { crypto: c, keyStore } = shellDeviceKey(shell.invoke, { crypto });
  const kp = await keyStore.get();
  assert.ok(kp);
  assert.equal(kp.publicKey.length, 32);
  assert.ok(!(kp.privateKey instanceof Uint8Array), "the private key is a marker");
  assert.equal(JSON.stringify(kp.privateKey).includes("PRIVATE"), false);
  const peer = /** @type {CryptoKeyPair} */ (await subtle.generateKey(X, false, ["deriveBits"]));
  const remote = new Uint8Array(await subtle.exportKey("raw", peer.publicKey));
  const mine = await c.dh(kp.privateKey, remote);
  const theirs = new Uint8Array(await subtle.deriveBits({ name: "X25519", public: await subtle.importKey("raw", kp.publicKey, X, true, []) }, peer.privateKey, 256));
  assert.deepEqual(mine, theirs, "the shell's DH is the X25519 the peer computes");
  assert.deepEqual(shell.calls, ["device_key_pub", "device_key_dh"]);
  await keyStore.set(kp);   // a no-op: nothing to keep here
  const fresh = await c.generateKeyPair();
  assert.equal((await c.dh(fresh.privateKey, remote)).length, 32, "a raw key still goes to the ordinary provider");
});

test("shell device key: a shell that answers nonsense is refused", async () => {
  const bad = shellDeviceKey(async () => "AAAA", { crypto });
  await assert.rejects(bad.keyStore.get(), /no device key/);
  const kp = shellDeviceKey(async cmd => (cmd === "device_key_pub" ? base64url(new Uint8Array(32).fill(7)) : "AAAA"), { crypto });
  const k = await kp.keyStore.get();
  assert.ok(k);
  await assert.rejects(kp.crypto.dh(k.privateKey, new Uint8Array(32).fill(9)), /no shared secret/);
});

test("shell device key: a box admits the shell's key, and the channel opens with the shell doing the DH", async () => {
  const shell = await fakeShell();
  const { crypto: c, keyStore } = shellDeviceKey(shell.invoke, { crypto });
  const device = /** @type {import("../noise.js").KeyPair} */ (await keyStore.get());
  const box = await crypto.generateKeyPair();
  /** @type {Uint8Array[]} */
  const seen = [];
  const { dch, bch } = await link(c, { box, device, admit: async pub => { seen.push(pub); return { ok: true }; } });
  assert.deepEqual(seen[0], shell.publicKey, "the box saw the shell's public key");
  assert.equal(shell.calls.filter(x => x === "device_key_dh").length >= 2, true, "both handshake DHs that use the static key went to the shell");
  assert.equal(dch.closed || bch.closed, false);
});
