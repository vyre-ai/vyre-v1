// The warmup pool over HTTP (node:http): the same contract, through a real socket with real headers, so what the module's client sends is what the service reads.
// @reads /relay/warmup/main.js
import test from "node:test";
import assert from "node:assert/strict";
import { createWarmupServer } from "../server.js";
import { b64url, signedMessage } from "../wire.js";

const subtle = globalThis.crypto.subtle;

async function boot() {
  const { server } = createWarmupServer();
  await new Promise(r => server.listen(0, "127.0.0.1", () => r(undefined)));
  const url = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
  return { url, close: () => new Promise(r => { server.closeAllConnections(); server.close(() => r(undefined)); }) };
}

async function signedPost(url, path, body, pair, pub, nonce) {
  const text = JSON.stringify(body), ts = String(Date.now());
  const sig = new Uint8Array(await subtle.sign({ name: "Ed25519" }, pair.privateKey, signedMessage("POST", path, ts, nonce, text)));
  return fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-vyre-key": b64url(pub), "x-vyre-ts": ts, "x-vyre-nonce": nonce, "x-vyre-sig": b64url(sig) }, body: text });
}

test("over HTTP: health, a signed join, a replay of the same request, an unsigned call and a body that is too big", async t => {
  const s = await boot();
  t.after(() => s.close());
  const pair = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));

  const health = await fetch(`${s.url}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual((await health.json()).data.ok, true);

  const nonce = "n".repeat(22);
  const joined = await signedPost(s.url, "/v1/pool/join", { v: 1, mailboxes: [{ address: "sales@harbor.example" }] }, pair, pub, nonce);
  assert.equal(joined.status, 200);
  assert.deepEqual((await joined.json()).data, { joined: 1, left: false, pool: { spaces: 1, mailboxes: 1 } });

  const replay = await signedPost(s.url, "/v1/pool/join", { v: 1, mailboxes: [{ address: "sales@harbor.example" }] }, pair, pub, nonce);
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).error.code, "auth.replayed");

  const unsigned = await fetch(`${s.url}/v1/pool/exchange`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ v: 1, mailboxes: [] }) });
  assert.equal(unsigned.status, 401);
  assert.equal((await unsigned.json()).error.code, "auth.invalid_signature");

  const big = await fetch(`${s.url}/v1/pool/join`, { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(200_000) }).catch(() => null);
  assert.ok(big === null || big.status === 413, "refused without being read to the end");

  const gone = await fetch(`${s.url}/nope`);
  assert.equal(gone.status, 404);
});
