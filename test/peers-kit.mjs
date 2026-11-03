// Two computers of one Personal Space for the peer tests (lane l-multidevice). Computer A is the seeded Space with an owner; computer B is made the way a join leaves it (peer-join/ staged
// from A's databases and keys, its own relay route, A's box key), without the find-and-allow dance test/peers.enrol.live.test.mjs already covers. Both talk through a real relay node.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { startDaemon } from "../host/src/daemon/daemon.ts";
import { openDb } from "../host/src/daemon/sqlite.ts";
import { routeIdOf } from "../host/src/seams/relay.ts";
import { newToken, tokenHash } from "../host/src/peers/crypto.ts";
import { ed25519Pair } from "../kernel/src/seal/index.ts";

export const OWNER = "tok-usr_olivia";
const caddyFetch = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

/** Every binary frame a computer sends or receives on a relay socket, as the relay sees it. */
export const seen = [];
export class Sniff extends WebSocket {
  constructor(url, p) {
    super(url, p);
    this.addEventListener("message", (e) => { if (typeof e.data !== "string") seen.push(Buffer.from(e.data)); });
  }
  send(d) { if (typeof d !== "string") seen.push(Buffer.from(d)); return super.send(d); }
}

export function seededDir(prefix = "vyre-peer-a-") {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

export function boot(dir, args, extra = {}) {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space-kind", "personal", "--peers", ...args], {}, "1.2.3"),
    platform: fakePlatform({ os: "linux", hostname: "peer-host", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" } } }),
    fetch: caddyFetch,
    seams: { relayWebSocket: Sniff },
    peerRoundMs: 3_600_000,
    session: (h) => { const t = /^Bearer tok-(usr_[a-z]+)$/.exec(String(h["authorization"] ?? ""))?.[1]; return t ? { space: "spc_core", principal: { kind: "person", id: t }, device: "mac" } : null; },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    ...extra,
  });
}

/** Computer A with an owner and its own row; then computer B staged from A's copy as a join leaves it. Returns B's data directory. */
export async function stageSecond(A, dirA, name = "Home laptop", kind = "computer") {
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-peer-b-"));
  const route = ed25519Pair();
  const boxA = JSON.parse(fs.readFileSync(path.join(dirA, "relay.key"), "utf8"));
  fs.writeFileSync(path.join(dirB, "relay.key"), JSON.stringify({ v: 2, routeSeed: route.seed, routePub: route.pub, boxPriv: boxA.boxPriv, boxPub: boxA.boxPub }), { mode: 0o600 });
  const routeB = await routeIdOf(new Uint8Array(Buffer.from(route.pub, "base64url")));
  const peerId = `peer_${kind}${Math.random().toString(36).slice(2, 8)}`;
  const token = newToken("vpt_");
  const relay = A.db.all("SELECT relay FROM network_peer LIMIT 1")[0].relay;
  A.db.run("INSERT INTO network_peer (id, name, platform, kind, route, relay, token_hash, added_at, last_seen_at) VALUES (?, ?, 'linux', ?, ?, ?, ?, ?, ?)", peerId, name, kind, routeB, relay, await tokenHash(token), Date.now(), Date.now());
  A.peers.sync.ensure();
  const stage = path.join(dirB, "peer-join");
  fs.mkdirSync(stage, { recursive: true });
  for (const f of ["events.db", "modules.db", "space.db"]) {
    const s = openDb(path.join(dirA, f), { readOnly: true });
    try { s.exec(`VACUUM INTO '${path.join(stage, f)}'`); } finally { s.close(); }
  }
  for (const f of ["seal.key", "person-wrap.key", "vault-filler.key"]) if (fs.existsSync(path.join(dirA, f))) fs.copyFileSync(path.join(dirA, f), path.join(stage, f));
  fs.writeFileSync(path.join(stage, "join.json"), JSON.stringify({ v: 1, space: A.space, peerId, token, box: { priv: boxA.boxPriv, pub: boxA.boxPub }, relay, from: "Office iMac", at: Date.now() }));
  fs.writeFileSync(path.join(stage, "ready"), "1");
  return { dirB, peerId, token };
}

export async function firstComputer(base) {
  const dirA = seededDir();
  const A = await boot(dirA, ["--relay", base, "--peer-name", "Office iMac"]);
  A.db.run("INSERT INTO identity_accounts (person_id, username, name, verifier, keys_json, created_at) VALUES ('usr_olivia', 'olivia', 'Olivia', 'v', '{}', 1)");
  await A.peers.tick();
  return { A, dirA };
}

export const call = async (d, p, body = {}, token = OWNER) => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ idempotencyKey: `pk-${Math.random()}`, ...body }) });
  return { status: r.status, body: await r.json() };
};
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));
