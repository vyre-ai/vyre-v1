// A Space started with its own address (install.sh --domain) writes its own Caddy ingress route: at boot, and again on the slow timer only when the route is missing, so a
// healthy Space does not reload Caddy every minute. Caddy that is not up yet is tried again later and never stops the daemon. A Space with no address writes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { managedNetworkPort } from "../src/daemon/network-driver.ts";
import { FakeCaddy } from "../src/caddy/fake.ts";
import { CaddyAdmin, CaddyRouter, ingressHostOf, routeId, routesOf } from "../src/caddy/index.ts";
import { fakePlatform } from "../src/platform/index.ts";

const HOST = "fixture.example.com";
const ADMIN = "http://127.0.0.1:2019";
const HOUR = 3_600_000;

/** Every request that changed Caddy's config: a load, an append to the routes, a replace by id, a delete. */
const writes = (caddy: FakeCaddy): number => caddy.calls.filter((c) => c.method !== "GET").length;

async function boot(caddy: FakeCaddy, address: string | null): Promise<{ daemon: Daemon; dir: string }> {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-ingress-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  let port = 0;
  const network = managedNetworkPort({ adminUrl: ADMIN, space: "spc_core", upstream: () => `127.0.0.1:${port}`, ingressHost: () => address, relayReady: () => false, fetch: caddy.fetch });
  const daemon = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", ...(address ? ["--address", address] : [])], {}, "1.2.3"),
    network, platform: fakePlatform({ os: "linux", free: 80e9 }),
    intervals: { fast: HOUR, slow: HOUR, encryption: HOUR, commands: HOUR, hooks: HOUR, tick: HOUR },
  });
  port = daemon.port;
  return { daemon, dir };
}

test("the address forms Caddy fronts become a host; the local URL, ports and IP addresses do not", () => {
  assert.equal(ingressHostOf("mla.vyre.run"), "mla.vyre.run");
  assert.equal(ingressHostOf("https://MLA.vyre.run/"), "mla.vyre.run");
  for (const a of [null, "", "http://0.0.0.0:8420", "http://mla.vyre.run", "https://mla.vyre.run:8443", "203.0.113.7", "https://u:p@mla.vyre.run", "https://mla.vyre.run/app"]) assert.equal(ingressHostOf(a), null, String(a));
});

test("a fresh boot with an address gets its ingress route; a second tick does not rewrite it; a route deleted later comes back", async () => {
  const caddy = new FakeCaddy();
  const { daemon, dir } = await boot(caddy, HOST);
  try {
    await daemon.ensureIngress();   // waits for the boot write
    const router = new CaddyRouter({ admin: new CaddyAdmin({ baseUrl: ADMIN, fetch: caddy.fetch }), space: "spc_core" });
    assert.deepEqual(await router.hosts(), [HOST], "the boot wrote the route");
    const route = routesOf(caddy.config ?? undefined).find((r) => r["@id"] === routeId(HOST));
    assert.equal(JSON.stringify(route?.handle), JSON.stringify([{ handler: "reverse_proxy", upstreams: [{ dial: `127.0.0.1:${daemon.port}` }] }]), "to the gateway, with no auth in front");
    const after = writes(caddy);

    await daemon.ensureIngress();
    await daemon.ensureIngress();
    assert.equal(writes(caddy), after, "a route that is there is left alone: no Caddy reload every minute");

    await router.removeRoute(HOST);
    assert.deepEqual(await router.hosts(), []);
    const removed = writes(caddy);
    await daemon.ensureIngress();
    assert.deepEqual(await router.hosts(), [HOST], "the missing route came back");
    assert.equal(writes(caddy), removed + 1, "one append, nothing else");
  } finally { await daemon.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("Caddy not up at boot: the daemon starts anyway and the next slow tick writes the route", async () => {
  const caddy = new FakeCaddy();
  caddy.down = true;
  const { daemon, dir } = await boot(caddy, HOST);
  try {
    await daemon.ensureIngress();
    assert.equal(caddy.config, null, "nothing reached a Caddy that does not answer");
    const res = await fetch(`${daemon.url}/healthz`);
    assert.equal(res.status, 200, "the daemon serves");
    await res.arrayBuffer();
    caddy.down = false;
    await daemon.ensureIngress();
    assert.deepEqual(routesOf(caddy.config ?? undefined).map((r) => r.match[0]?.host[0]), [HOST]);
  } finally { await daemon.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("with no address nothing is written to Caddy", async () => {
  const caddy = new FakeCaddy();
  const { daemon, dir } = await boot(caddy, null);
  try {
    await daemon.ensureIngress();
    await daemon.ensureIngress();
    assert.deepEqual(caddy.calls, [], "a Space without an address never touches Caddy for ingress");
  } finally { await daemon.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
