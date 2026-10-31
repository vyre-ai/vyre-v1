// Phone access end to end, minus a browser: a computer's host claims <name>.vyre.run through its relay link against the real relay Worker (relay/worker, on the fake Workers runtime), the gateway answers
// the name with the shell, and the service worker's own bridge (relay/worker/shell/bridge.js) over the relay client reaches the host's loopback gateway through the sealed channel, the way a phone does.
// The test lives in test/ because host may not import relay/ and relay/ may not import host (boundaries.json).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import worker, * as W from "../relay/worker/index.js";
import { createRuntime } from "../relay/worker/fake-cf.js";
import { connect } from "../relay/client/client.js";
import { memoryKeyStore, webCrypto } from "../relay/client/webcrypto.js";
import { createBridge } from "../relay/worker/shell/bridge.js";
import { openDb } from "../host/src/daemon/sqlite.ts";
import { HOST_TABLES } from "../host/src/daemon/hosttables.ts";
import { pollCommands, defaultNetworkPort } from "../host/src/daemon/commands.ts";
import { createPhonePort } from "../host/src/daemon/phone.ts";
import { startRelayBox } from "../host/src/seams/relay.ts";

function world(names = () => "ok") {
  const rt = createRuntime({ worker, Class: W.RouteRelay, classes: { TICKETS: W.PairTicket, CODES: W.CodeSlot, SIGNIN: W.SigninSlot, HOSTS: W.HostSlot },
    env: { NAMES_FETCH: async (u) => new Response(JSON.stringify({ data: { status: names(new URL(u).searchParams.get("name")) } })), RELAY_PUBLIC_URL: "ws://relay.test" } });
  return rt;
}

/** A host: a loopback "gateway", a database with the host tables, and the phone port over a relay link on the fake Worker. */
async function host(rt) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ path: req.url, method: req.method, auth: req.headers.authorization ?? null, body: Buffer.concat(chunks).toString() })); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-phone-"));
  const db = openDb(path.join(dir, "modules.db"));
  db.exec(HOST_TABLES);
  let box = null;
  const start = () => (box ??= startRelayBox({ relayUrl: "ws://relay.test", dataDir: dir, localPort: () => server.address().port, onState: () => {}, WebSocket: rt.WebSocket }));
  const phone = createPhonePort({ current: () => box, start, dropped: () => { box = null; }, configured: false });
  const deps = { db, supervisor: { has: () => false }, network: defaultNetworkPort(), phone, now: () => Date.now() };
  const ask = async (kind, target) => {
    db.run("INSERT INTO network_command (kind, target, by_principal, at, done_at) VALUES (?, ?, 'usr_x', ?, NULL)", kind, target, Date.now());
    await pollCommands(deps);
  };
  const row = () => db.all("SELECT * FROM network_phone WHERE id = 1")[0];
  const claim = async (name, nickname) => {
    db.run("INSERT OR REPLACE INTO network_phone (id, name, nickname, state, detail, box_key, reported_at) VALUES (1, ?, ?, 'claiming', NULL, NULL, ?)", name, nickname, Date.now());
    await ask("phone_claim", JSON.stringify({ name, nickname }));
    return row();
  };
  return { claim, ask, row, stop: async () => { box?.stop(); server.close(); db.close?.(); } };
}

test("a host claims a name, the gateway serves the shell, and a phone's bridge reaches the host through the sealed channel", async (t) => {
  const rt = world();
  const h = await host(rt);
  t.after(async () => { await h.stop(); await rt.settle(); });
  const r = await h.claim("alex", "Home laptop");
  assert.equal(r.state, "claimed", JSON.stringify(r));
  assert.match(r.box_key, /^[A-Za-z0-9_-]{43}$/);
  // the gateway
  const shell = await rt.fetch("https://alex.vyre.run/");
  assert.equal(shell.status, 200);
  assert.match(await shell.text(), /Home laptop/);
  const info = await (await rt.fetch("https://alex.vyre.run/__vyre/info.json")).json();
  assert.equal(info.online, true);
  // what the phone's service worker does: dial /v1/device with the pinned key, ask the box for a path
  const conn = connect({ relay: info.relay, route: info.route, box: r.box_key, WebSocket: rt.WebSocket, crypto: webCrypto(), keyStore: memoryKeyStore(), about: { kind: "web" }, visibility: { hidden: () => false, on: () => () => {} } });
  t.after(() => conn.close());
  const bridge = createBridge({ box: async () => conn, label: () => info.label, waitMs: 5000 });
  const res = await bridge.handle(new Request("https://alex.vyre.run/v1/ping?x=1", { method: "POST", headers: { authorization: "Bearer tok", accept: "application/json" }, body: "hello" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { path: "/v1/ping?x=1", method: "POST", auth: "Bearer tok", body: "hello" });
  // the relay saw only a route id and ciphertext: nothing it stored mentions the path or the token
  const stored = JSON.stringify([...rt.object(info.route).ctx.storage.map.entries()]);
  assert.doesNotMatch(stored, /v1\/ping|Bearer tok|hello/);
});

test("a phone pinned to some other key never reaches the host, however the relay answers", async (t) => {
  const rt = world();
  const h = await host(rt);
  t.after(async () => { await h.stop(); await rt.settle(); });
  const r = await h.claim("alex", "Home laptop");
  const info = await (await rt.fetch("https://alex.vyre.run/__vyre/info.json")).json();
  const other = await webCrypto().generateKeyPair();
  const conn = connect({ relay: info.relay, route: info.route, box: Buffer.from(other.publicKey).toString("base64url"), WebSocket: rt.WebSocket, crypto: webCrypto(), keyStore: memoryKeyStore(), visibility: { hidden: () => false, on: () => () => {} }, timeout: 1500, backoff: { min: 50, max: 100 } });
  t.after(() => conn.close());
  const bridge = createBridge({ box: async () => conn, label: () => "Home laptop", waitMs: 1500 });
  const res = await bridge.handle(new Request("https://alex.vyre.run/v1/ping", { headers: { accept: "text/html" } }));
  assert.equal(res.status, 503, "the page says the computer is asleep rather than serving an impostor");
  assert.ok(r.box_key);
});

test("a taken name fails with words a person can read, and release gives the name up for good", async (t) => {
  const rt = world((n) => n === "taken-one" ? "taken" : "ok");
  const h = await host(rt);
  t.after(async () => { await h.stop(); await rt.settle(); });
  const bad = await h.claim("taken-one", "");
  assert.deepEqual([bad.state, bad.detail], ["failed", "That name is taken. Try another."]);
  const ok = await h.claim("alex", "Home laptop");
  assert.equal(ok.state, "claimed");
  await h.ask("phone_release", "alex");
  assert.deepEqual([h.row().state, h.row().name], ["none", null]);
  assert.equal((await rt.fetch("https://alex.vyre.run/")).status, 301, "no longer served");
  // a second computer cannot take it
  const rt2h = await host(rt);
  t.after(async () => { await rt2h.stop(); });
  const other = await rt2h.claim("alex", "Other");
  assert.deepEqual([other.state, other.detail], ["failed", "That name is taken. Try another."]);
});
