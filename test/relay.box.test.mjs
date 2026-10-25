// P-L7b_16: a Space behind NAT is reachable through the relay. A booted daemon is given a relay (--relay), keeps one outbound connection to a real relay node (relay/node/server.js) on loopback, and
// network.endpoints lists the relay endpoint after the direct ones. A device then does what a phone does: opens a relay channel with the relay client's own Noise initiator, pinned to the box key from the
// endpoint, and calls the gateway through it with a real token. Refusals: a request with no token, a member without the permission, a device pinned to the wrong key, and a daemon with no relay configured.
// The test lives in test/ because host may not import relay/ and relay/ may not import host (boundaries.json); this directory is checked for absent paths only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { startDaemon } from "../host/src/daemon/daemon.ts";
import { createRelay } from "../relay/node/server.js";
import { openChannel, request } from "../relay/client/client.js";
import { webCrypto } from "../relay/client/webcrypto.js";

const OWNER = "tok-usr_olivia";
const MEMBER = "tok-usr_noah";
const caddyFetch = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const utf8 = (s) => new TextEncoder().encode(s);
const fromB64u = (s) => new Uint8Array(Buffer.from(s, "base64url"));

function seededDir() {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-relay-box-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

function boot(dir, relay) {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", ...(relay ? ["--relay", relay] : [])], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "relay-box", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      const who = t === OWNER ? "usr_olivia" : t === MEMBER ? "usr_noah" : null;
      return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "relay-box" };
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

const direct = (d, token, p, body = {}) =>
  fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ idempotencyKey: `rb-${Math.random()}`, ...body }) });

async function relayEndpoint(d, want) {
  for (let i = 0; i < 100; i++) {
    const r = await direct(d, OWNER, "/v1/network/endpoints");
    const eps = ((await r.json()).data?.endpoints ?? []);
    const e = eps.find((x) => x.kind === "relay");
    if (e && (want === undefined || e.health === want)) return { e, all: eps };
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`no relay endpoint${want ? ` reading ${want}` : ""}`);
}

const viaRelay = async (base, route, box, token, p, body = {}) => {
  const crypto = webCrypto();
  const keys = await crypto.generateKeyPair();
  const { channel } = await openChannel({ relay: base, route, box, keys, crypto, WebSocket: globalThis.WebSocket, hello: { v: 1, name: "a phone" }, timeout: 10_000 });
  try {
    const headers = { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
    const res = await request(channel, { method: "POST", path: p, headers }, utf8(JSON.stringify({ idempotencyKey: `rb-${Math.random()}`, ...body })));
    return { status: res.status, body: JSON.parse(await res.text()) };
  } finally { channel.close(1000, "done"); }
};

test("a daemon with no relay configured lists no relay endpoint", async () => {
  const d = await boot(seededDir(), null);
  try {
    const r = await direct(d, OWNER, "/v1/network/endpoints");
    const eps = (await r.json()).data.endpoints;
    assert.equal(eps.some((e) => e.kind === "relay"), false);
  } finally { await d.stop(); }
});

test("a phone reaches the Space through the relay, the gateway checks its token, and the endpoint follows the link", async () => {
  const relay = createRelay();
  const base = await relay.listen();
  const dir = seededDir();
  const d = await boot(dir, base);
  try {
    const { e, all } = await relayEndpoint(d, "healthy");
    assert.equal(all[all.length - 1].kind, "relay", "the relay is listed after the direct endpoints");
    const url = new URL(e.url);
    assert.equal(url.pathname, "/v1/device");
    const route = url.searchParams.get("route");
    const boxKey = /^#box=(.+)$/.exec(url.hash)?.[1];
    assert.match(route, /^[a-z2-7]{26}$/);
    assert.ok(boxKey, "the endpoint carries the box key a device pins");
    assert.ok(fs.existsSync(path.join(dir, "relay.key")), "the route and box keys are kept beside the seal key");
    assert.equal(fs.statSync(path.join(dir, "relay.key")).mode & 0o077, 0, "readable by this user only");

    const ok = await viaRelay(base, route, fromB64u(boxKey), OWNER, "/v1/network/endpoints");
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.data.endpoints.some((x) => x.kind === "relay"), "the answer is the gateway's own");

    const noToken = await viaRelay(base, route, fromB64u(boxKey), null, "/v1/network/endpoints");
    assert.equal(noToken.status, 401, "a request with no token is refused by the gateway, not let in by the relay");
    const member = await viaRelay(base, route, fromB64u(boxKey), MEMBER, "/v1/network/status");
    assert.equal(member.status, 403, "a member without server.network is refused through the relay as well");

    // a device pinned to some other box key is not talking to this Space
    const wrong = await webCrypto().generateKeyPair();
    await assert.rejects(() => viaRelay(base, route, wrong.publicKey, OWNER, "/v1/network/endpoints"));

    await relay.close();
    await relayEndpoint(d, "down");
  } finally { await d.stop(); await relay.close().catch(() => {}); }
});
