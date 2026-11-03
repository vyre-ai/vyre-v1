// A second computer joins the same Personal Space (lane l-multidevice, increment 1). Two booted daemons and a real relay node on loopback (relay/node/server.js, the same protocol as the
// Worker): computer A holds the Space and watches its owner's name; computer B is a fresh, unclaimed Personal Space, the state the Mac app is in on its first run. B finds A by the username,
// sends its request, the person allows it on A with the code B shows, B gets the key bundle back (its app opens that with the password), copies the Space and starts again as the same Space.
// Every byte the relay carries between the two computers is recorded: no key, token, username or row crosses it in the clear.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { startDaemon } from "../host/src/daemon/daemon.ts";
import { openDb } from "../host/src/daemon/sqlite.ts";
import { createRelay } from "../relay/node/server.js";

const OWNER = "tok-usr_olivia";
const caddyFetch = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

/** Every binary frame either computer sends or receives on a relay socket, as the relay sees it. */
const seen = [];
class Sniff extends WebSocket {
  constructor(url, p) {
    super(url, p);
    this.addEventListener("message", (e) => { if (typeof e.data !== "string") seen.push(Buffer.from(e.data)); });
  }
  send(d) { if (typeof d !== "string") seen.push(Buffer.from(d)); return super.send(d); }
}

function seededDir() {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-peer-a-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

function boot(dir, args, onStopped) {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space-kind", "personal", "--peers", ...args], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "peer-host", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    seams: { relayWebSocket: Sniff },
    ...(onStopped ? { onStopped } : {}),
    session: (h) => (/^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "mac" } : null),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

const call = async (d, p, body = {}, token = OWNER) => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ idempotencyKey: `pe-${Math.random()}`, ...body }) });
  return { status: r.status, body: await r.json() };
};
const local = async (d, p, body = {}) => {
  const r = await fetch(`${d.url}/local/peers/${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

test("a second computer finds the Personal Space by name, is allowed on the first, and starts again as the same Space", { timeout: 60_000 }, async () => {
  const relay = createRelay();
  const base = await relay.listen();
  const dirA = seededDir();
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-peer-b-"));
  let A = null, B = null;
  try {
    A = await boot(dirA, ["--relay", base, "--peer-name", "Office iMac"]);
    const bundle = { personKeyByPassword: "cGFzcw==", personKeyByRecovery: "cmVj", publicKey: "cHVi", privateKeyWrapped: "cHJpdg==", spaceKeys: [] };
    A.db.run("INSERT INTO identity_accounts (person_id, username, name, verifier, keys_json, created_at) VALUES ('usr_olivia', 'olivia', 'Olivia', 'v', ?, 1)", JSON.stringify(bundle));
    await A.peers.tick();
    const selfA = A.db.all("SELECT peer_id FROM network_peer_self")[0].peer_id;
    assert.match(selfA, /^peer_/, "the first computer has its own row once the Space has an owner");

    let stoppedB;
    const stopped = new Promise((r) => { stoppedB = r; });
    B = await boot(dirB, ["--space", "spc_freshb", "--relay", base, "--peer-name", "Home laptop"], () => stoppedB());
    assert.equal(B.space, "spc_freshb");

    // a stranger's page cannot drive the join: only this computer's own app, on loopback and not through the relay
    const viaRelay = await fetch(`${B.url}/local/peers/find`, { method: "POST", headers: { "content-type": "application/json", "x-vyre-via": "relay" }, body: JSON.stringify({ username: "olivia" }) });
    assert.equal(viaRelay.status, 403);
    const fromPage = await fetch(`${B.url}/local/peers/find`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ username: "olivia" }) });
    assert.equal(fromPage.status, 403, "a web page open on this computer cannot start a join");
    const simple = await fetch(`${B.url}/local/peers/find`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ username: "olivia" }) });
    assert.equal(simple.status, 403, "only JSON, which a browser must ask before sending");

    const nobody = await local(B, "find", { username: "nobody-here" });
    assert.equal(nobody.body.data.offers.length, 0, "a name no computer watches finds nothing");
    const found = await local(B, "find", { username: "olivia" });
    assert.equal(found.status, 200, JSON.stringify(found.body));
    assert.equal(found.body.data.offers.length, 1, "one computer of the Space answered");
    assert.equal(found.body.data.offers[0].name, "Office iMac");
    assert.equal(found.body.data.offers[0].space, A.space);

    const asked = await local(B, "request", { index: 0, name: "Home laptop" });
    assert.equal(asked.status, 200, JSON.stringify(asked.body));
    assert.match(asked.body.data.code, /^\d{3} \d{3}$/);

    const pending = await call(A, "/v1/network/peer_requests");
    assert.equal(pending.status, 200, JSON.stringify(pending.body));
    const req = pending.body.data.requests[0];
    assert.equal(req.name, "Home laptop");
    assert.equal(req.code, asked.body.data.code, "both screens show the same code");

    const early = await local(B, "status");
    assert.equal(early.body.data.state, "pending");
    const allowed = await call(A, "/v1/network/peer_allow", { requestId: req.requestId });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));

    const st = await local(B, "status");
    assert.equal(st.body.data.state, "allowed", JSON.stringify(st.body));
    assert.deepEqual(st.body.data.bundle, bundle, "the new computer's app gets the owner's key bundle to open with the password");
    assert.equal(st.body.data.username, "olivia");
    assert.equal(st.body.data.secrets, undefined, "the Space's keys stay with the daemon, never handed to the page");

    const committed = await local(B, "commit");
    assert.equal(committed.status, 200, JSON.stringify(committed.body));
    assert.equal(committed.body.data.space, A.space);
    await stopped;
    B = null;

    B = await boot(dirB, ["--space", "spc_freshb", "--relay", base, "--peer-name", "Home laptop"]);
    assert.equal(B.space, A.space, "the second computer starts again as the same Personal Space");
    assert.equal(B.db.all("SELECT username FROM identity_accounts")[0].username, "olivia", "the owner can sign in on the new computer");
    const tables = (d) => d.db.all("SELECT count(*) AS n FROM access_principals")[0].n;
    assert.equal(tables(B), tables(A), "the people of the Space came with the copy");
    const peers = await call(B, "/v1/network/peers");
    assert.equal(peers.status, 200, JSON.stringify(peers.body));
    const list = peers.body.data.computers;
    assert.deepEqual(list.map((c) => c.name).sort(), ["Home laptop", "Office iMac"]);
    assert.equal(list.find((c) => c.self).name, "Home laptop", "the new computer knows which row is itself");
    const keyA = JSON.parse(fs.readFileSync(path.join(dirA, "relay.key"), "utf8")), keyB = JSON.parse(fs.readFileSync(path.join(dirB, "relay.key"), "utf8"));
    assert.equal(keyB.boxPub, keyA.boxPub, "both computers answer under the Space's one box key");
    assert.notEqual(keyB.routePub, keyA.routePub, "each keeps its own route at the relay");
    assert.equal(fs.readFileSync(path.join(dirB, "seal.key"), "utf8"), fs.readFileSync(path.join(dirA, "seal.key"), "utf8"), "the Vault and sealed data open on the new computer");
    assert.ok(fs.readdirSync(dirB).some((f) => f.startsWith("peer-replaced-")), "the fresh Space it replaced is kept aside");

    // nothing secret crossed the relay in the clear
    assert.ok(seen.length > 10, "the frames between the computers were recorded");
    const all = Buffer.concat(seen);
    for (const secret of [fs.readFileSync(path.join(dirA, "seal.key"), "utf8").trim(), keyA.boxPriv, "olivia", "identity_accounts", "cGFzcw==", fs.readFileSync(path.join(dirB, "peer.token"), "utf8").trim()]) {
      assert.equal(all.includes(Buffer.from(secret)), false, `the relay never carries ${secret.slice(0, 12)} in the clear`);
    }
  } finally {
    await B?.stop();
    await A?.stop();
    await relay.close();
  }
});
