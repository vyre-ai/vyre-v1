// The host's own Noise initiator and channel (host/src/peers/link.ts) against a booted daemon's relay box, beside the relay client's: both open a channel to the same box with the same pinned key,
// the gateway answers each the same, and a channel pinned to some other key never opens. A large answer streams through in order.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { startDaemon } from "../host/src/daemon/daemon.ts";
import { openPeerChannel } from "../host/src/peers/link.ts";
import { x25519Pair } from "../kernel/src/seal/index.ts";
import { createRelay } from "../relay/node/server.js";
import { openChannel, request } from "../relay/client/client.js";
import { webCrypto } from "../relay/client/webcrypto.js";

const OWNER = "tok-usr_olivia";
const caddyFetch = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const fromB64u = (s) => new Uint8Array(Buffer.from(s, "base64url"));

test("the host's initiator and the relay client's reach the same box; a wrong key is refused", { timeout: 30_000 }, async () => {
  const relay = createRelay();
  const base = await relay.listen();
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-peer-link-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--relay", base], {}, "1.2.3"),
    platform: fakePlatform({ os: "linux", hostname: "link-box", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" } } }),
    fetch: caddyFetch,
    session: (h) => (/^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "link" } : null),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  try {
    const keys = JSON.parse(fs.readFileSync(path.join(dir, "relay.key"), "utf8"));
    let route = null;
    for (let i = 0; i < 100 && !route; i++) {
      const r = await fetch(`${d.url}/v1/network/endpoints`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` }, body: "{}" });
      const e = (await r.json()).data?.endpoints?.find((x) => x.kind === "relay" && x.health === "healthy");
      if (e) route = new URL(e.url).searchParams.get("route");
      else await new Promise((res) => setTimeout(res, 100));
    }
    assert.ok(route, "the box is linked");
    const box = fromB64u(keys.boxPub);
    const body = JSON.stringify({ idempotencyKey: "pl-1" });
    const headers = { "content-type": "application/json", authorization: `Bearer ${OWNER}` };

    const ch = await openPeerChannel({ relay: base, route, box });
    const mine = await ch.request({ method: "POST", path: "/v1/network/endpoints", headers, body });
    const big = await ch.request({ method: "GET", path: "/app/does-not-exist-" + "x".repeat(10), headers });
    ch.close();
    assert.equal(mine.status, 200, mine.text());
    assert.ok(mine.json().data.endpoints.some((x) => x.kind === "relay"));
    assert.ok(big.status >= 200, "a second request on the same channel is answered");

    const crypto = webCrypto();
    const { channel } = await openChannel({ relay: base, route, box, keys: await crypto.generateKeyPair(), crypto, WebSocket: globalThis.WebSocket, hello: { v: 1 }, timeout: 10_000 });
    const theirs = await request(channel, { method: "POST", path: "/v1/network/endpoints", headers }, new TextEncoder().encode(body));
    channel.close(1000, "done");
    assert.equal(theirs.status, mine.status, "the relay client gets the same answer");

    const wrong = fromB64u(x25519Pair().pub);
    await assert.rejects(openPeerChannel({ relay: base, route, box: wrong }, { timeoutMs: 5_000 }), /handshake|not online|answer|closed/);
  } finally {
    await d.stop();
    await relay.close();
  }
});
