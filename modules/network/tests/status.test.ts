// Network status through the real handlers (spec Networking, ARCH 5.9, 7.10).
// heartbeat and failover state reflected in the servers list.
// @reads ../migrations/0001_init.sql
// @reads ../fixtures/seed.ts

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { harness, NOW, TRACE } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { seed } from "../fixtures/seed.ts";
import * as impl from "../impl.ts";
import { believed, certOf, DAY_MS, HEARTBEAT_DEGRADED_MS, HEARTBEAT_DOWN_MS } from "../handlers/status.ts";
import {
  certificateRenew, domainSet, endpointList, handlers, health, ingressCheck, publicHostnames, relaySet, serverJoinCode, serverList, serverReconnect, serverRemove, status,
} from "../handlers/index.ts";

const HOST = "northwind.example.com";

function config(h: Harness, o: { mode?: string; address?: string; domain?: string | null; relay?: string | null; ingress?: number; detail?: string | null } = {}): void {
  h.raw.run(
    "INSERT OR REPLACE INTO network_config (id, address, mode, domain, relay_address, public_ingress, ingress_detail, reported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    1, o.address ?? HOST, o.mode ?? "own_domain", o.domain === undefined ? HOST : o.domain, o.relay === undefined ? "northwind.vyre.run" : o.relay, o.ingress ?? 1, o.detail ?? null, NOW,
  );
}
const cert = (h: Harness, host: string, expiresAt: number | null, reason: string | null = null): void => {
  h.raw.run("INSERT OR REPLACE INTO network_cert (host, expires_at, reason, reported_at) VALUES (?, ?, ?, ?)", host, expiresAt, reason, NOW);
};
const server = (h: Harness, id: string, name: string, role: string, state: string, beat: number | null): void => {
  h.raw.run("INSERT OR REPLACE INTO network_server (server_id, name, role, state, heartbeat_at) VALUES (?, ?, ?, ?, ?)", id, name, role, state, beat);
};
const endpoint = (h: Harness, kind: string, url: string, state: string, rtt: number | null, beat: number | null): void => {
  h.raw.run("INSERT OR REPLACE INTO network_endpoint (kind, url, state, rtt_ms, heartbeat_at) VALUES (?, ?, ?, ?, ?)", kind, url, state, rtt, beat);
};

test("heartbeat and failover state reflected in the servers list", async () => {
  const h = harness();
  server(h, "srv_main", "Northwind server", "space", "healthy", NOW);
  server(h, "srv_box", "Cloud box", "compute", "healthy", NOW);
  server(h, "srv_mac", "Office Mac", "compute", "degraded", NOW);
  const rows = async () => Object.fromEntries((await serverList(h.ctx, {})).servers.map((s) => [s.serverId, s.state]));
  assert.deepEqual(await rows(), { srv_main: "healthy", srv_box: "healthy", srv_mac: "degraded" });

  h.setNow(NOW + HEARTBEAT_DEGRADED_MS + 1);
  server(h, "srv_main", "Northwind server", "space", "healthy", NOW + HEARTBEAT_DEGRADED_MS);
  assert.deepEqual(await rows(), { srv_main: "healthy", srv_box: "degraded", srv_mac: "degraded" }, "a quiet server goes degraded");
  h.setNow(NOW + HEARTBEAT_DOWN_MS + 1);
  server(h, "srv_main", "Northwind server", "space", "healthy", NOW + HEARTBEAT_DOWN_MS);
  assert.deepEqual(await rows(), { srv_main: "healthy", srv_box: "down", srv_mac: "down" }, "silence beats the last reported state");
  const box = (await serverList(h.ctx, {})).servers.find((s) => s.serverId === "srv_box")!;
  assert.equal(box.lastSeenAt, NOW);
  assert.deepEqual((await serverList(h.ctx, {})).servers.map((s) => s.name), ["Cloud box", "Northwind server", "Office Mac"], "sorted by name");

  server(h, "srv_box", "Cloud box", "compute", "healthy", h.ctx.now());
  assert.equal((await rows())["srv_box"], "healthy", "a heartbeat brings it back");
  server(h, "srv_ghost", "Never seen", "compute", "healthy", null);
  assert.equal((await rows())["srv_ghost"], "down", "no heartbeat at all is down");
});

test("endpoints list direct first and follow their heartbeats, so failover shows on the relay row", async () => {
  const h = harness();
  endpoint(h, "relay", "https://northwind.vyre.run", "healthy", 80, NOW);
  endpoint(h, "direct", HOST, "healthy", 12, NOW);
  endpoint(h, "tunnel", "https://t.example", "healthy", null, NOW);
  assert.deepEqual((await endpointList(h.ctx, {})).endpoints, [
    { kind: "direct", url: HOST, health: "healthy", rttMs: 12 },
    { kind: "relay", url: "https://northwind.vyre.run", health: "healthy", rttMs: 80 },
    { kind: "tunnel", url: "https://t.example", health: "healthy" },
  ]);
  h.setNow(NOW + HEARTBEAT_DOWN_MS + 1);
  endpoint(h, "relay", "https://northwind.vyre.run", "healthy", 85, h.ctx.now());
  const e = (await endpointList(h.ctx, {})).endpoints;
  assert.deepEqual(e.map((x) => [x.kind, x.health]), [["direct", "down"], ["relay", "healthy"], ["tunnel", "down"]]);
});

test("status shows the address, mode, certificate and public ingress; before any report it says so", async () => {
  const h = harness();
  assert.deepEqual(await status(h.ctx, {}), { address: "", mode: "relay", certificate: { host: "", state: "degraded" }, publicIngress: false, commands: [] });
  assert.deepEqual(await ingressCheck(h.ctx, {}), { reachable: false, detail: "The host has not reported its address yet." });
  config(h);
  cert(h, HOST, NOW + 60 * DAY_MS);
  assert.deepEqual(await status(h.ctx, {}), { address: HOST, mode: "own_domain", certificate: { host: HOST, expiresAt: NOW + 60 * DAY_MS, state: "healthy" }, publicIngress: true, commands: [] });
  assert.deepEqual(await ingressCheck(h.ctx, {}), { reachable: true });
  config(h, { ingress: 0 });
  assert.equal((await ingressCheck(h.ctx, {})).detail, "Forms and webhooks cannot reach this Space from outside.");
  config(h, { ingress: 0, detail: "Port 443 is closed." });
  assert.equal((await ingressCheck(h.ctx, {})).detail, "Port 443 is closed.");
});

test("certificate state follows days to expiry: 14 degraded, 1 down, a failure with nothing issued down", () => {
  const row = (exp: number | null, reason: string | null = null) => certOf({ host: "h.example.com", expires_at: exp, reason }, NOW)!;
  assert.equal(row(NOW + 30 * DAY_MS).state, "healthy");
  assert.equal(row(NOW + 13 * DAY_MS).state, "degraded");
  assert.equal(row(NOW + 13 * DAY_MS).daysToExpiry, 13);
  assert.equal(row(NOW + DAY_MS / 2).state, "down");
  assert.equal(row(NOW - DAY_MS).state, "down");
  assert.equal(row(null).state, "degraded");
  assert.equal(row(null, "ACME refused").state, "down");
  assert.equal(row(NOW + 30 * DAY_MS, "renewal failed").state, "degraded");
  assert.equal(believed("healthy", undefined, NOW), "down");
});

test("public hostnames carry their certificate state", async () => {
  const h = harness();
  cert(h, "app.example.com", NOW + 40 * DAY_MS);
  cert(h, "old.example.com", NOW + 2 * DAY_MS);
  for (const [host, kind] of [["app.example.com", "app"], ["old.example.com", "site"], ["new.example.com", "form"], ["x.example.com", "bogus"]]) h.raw.run("INSERT INTO network_host (host, kind) VALUES (?, ?)", host, kind);
  assert.deepEqual((await publicHostnames(h.ctx, {})).hosts, [
    { host: "app.example.com", kind: "app", certificate: "healthy" },
    { host: "new.example.com", kind: "form", certificate: "degraded" },
    { host: "old.example.com", kind: "site", certificate: "degraded" },
  ]);
});

test("domain_set queues DNS checks without claiming host route application", async () => {
  const h = harness();
  config(h, { mode: "relay", address: "northwind.vyre.run", domain: null });
  await assert.rejects(() => domainSet(h.ctx, { domain: "not a domain" }), (e: unknown) => e instanceof VyreErr && e.error.code === "validation.bad_input" && e.error.traceId === TRACE);
  const first = await domainSet(h.ctx, { domain: "Space.Example.com " });
  assert.deepEqual(first, { dnsOk: false, records: [{ type: "CNAME", name: "space.example.com", value: "northwind.vyre.run" }] });
  assert.deepEqual(h.events, [], "no passing DNS check, no change");
  assert.equal((await status(h.ctx, {})).address, "northwind.vyre.run");
  assert.equal(h.raw.rows("network_command")[0]!["kind"], "set_domain");

  h.raw.run("INSERT INTO network_dns (domain, ok, records_json, checked_at) VALUES (?, ?, ?, ?)", "space.example.com", 1, JSON.stringify([{ type: "A", name: "space.example.com", value: "203.0.113.5" }, { bad: 1 }]), NOW);
  const second = await domainSet(h.ctx, { domain: "space.example.com" });
  assert.deepEqual(second, { dnsOk: true, records: [{ type: "A", name: "space.example.com", value: "203.0.113.5" }] });
  assert.deepEqual(h.events, [], "a cached DNS pass does not prove host route application");
  const st = await status(h.ctx, {});
  assert.deepEqual([st.address, st.mode], ["northwind.vyre.run", "relay"]);
});

test("relay_set queues a change without changing observed state and refuses without a target", async () => {
  const h = harness();
  await assert.rejects(() => relaySet(h.ctx, { mode: "relay" }), (e: unknown) => e instanceof VyreErr && e.error.code === "validation.precondition_failed");
  config(h, { mode: "own_domain" });
  assert.deepEqual(await relaySet(h.ctx, { mode: "relay" }), { address: "northwind.vyre.run" });
  assert.deepEqual(await relaySet(h.ctx, { mode: "own_domain" }), { address: HOST });
  assert.deepEqual(await relaySet(h.ctx, { mode: "own_domain" }), { address: HOST });
  assert.equal(h.events.length, 0, "queued changes do not emit observed completion");
  assert.equal((await status(h.ctx, {})).mode, 'own_domain');
  assert.deepEqual(h.raw.rows('network_command').map((row)=>row['target']),['relay']);
  config(h, { mode: "relay", address: "northwind.vyre.run", domain: null });
  await assert.rejects(() => relaySet(h.ctx, { mode: "own_domain" }), VyreErr);
});

test("certificate_renew queues a renewal and returns the state; an unknown host is not_found", async () => {
  const h = harness();
  cert(h, HOST, NOW + 5 * DAY_MS);
  assert.deepEqual(await certificateRenew(h.ctx, { host: HOST }), { state: "degraded" });
  assert.deepEqual(h.raw.rows("network_command").map((c) => [c["kind"], c["target"]]), [["renew", HOST]]);
  await assert.rejects(() => certificateRenew(h.ctx, { host: "nope.example.com" }), (e: unknown) => e instanceof VyreErr && e.error.code === "validation.not_found");
});

test("join codes look like VYRE-XXXX-XXXX, expire in ten minutes and differ", async () => {
  const h = harness({ principal: "usr_admin" });
  const a = await serverJoinCode(h.ctx, {}), b = await serverJoinCode(h.ctx, {});
  assert.match(a.code, /^VYRE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(a.expiresAt, NOW + 600_000);
  assert.notEqual(a.code, b.code);
  assert.deepEqual(h.raw.rows("network_join").map((r) => r["by_principal"]), ["usr_admin", "usr_admin"]);
});

test("reconnect asks the host and never reports a green row it has not seen; remove retains the row until the host confirms", async () => {
  const h = harness();
  server(h, "srv_main", "Northwind server", "space", "healthy", NOW);
  server(h, "srv_box", "Cloud box", "compute", "healthy", NOW - HEARTBEAT_DOWN_MS - 1);
  assert.deepEqual(await serverReconnect(h.ctx, { serverId: "srv_box" }), { state: "down" }, "a queued reconnect preserves observed state");
  assert.deepEqual(await serverReconnect(h.ctx, { serverId: "srv_main" }), { state: "healthy" });
  assert.deepEqual(h.raw.rows("network_command").map((c) => [c["kind"], c["target"]]), [["reconnect", "srv_box"], ["reconnect", "srv_main"]]);
  await assert.rejects(() => serverReconnect(h.ctx, { serverId: "srv_none" }), (e: unknown) => e instanceof VyreErr && e.error.code === "validation.not_found");

  await assert.rejects(() => serverRemove(h.ctx, { serverId: "srv_main" }), (e: unknown) => e instanceof VyreErr && e.error.code === "validation.precondition_failed");
  assert.deepEqual(await serverRemove(h.ctx, { serverId: "srv_box" }), { removed: false });
  assert.deepEqual(await serverRemove(h.ctx, { serverId: "srv_box" }), { removed: false });
  assert.deepEqual((await serverList(h.ctx, {})).servers.map((s) => s.serverId), ["srv_box", "srv_main"]);
  assert.deepEqual(h.events, [], "removal is observed only after the driver succeeds");
});

test("the health probe combines certificate expiry and relay reachability", async () => {
  const h = harness();
  assert.deepEqual(await health(h.ctx, {}), { state: "degraded", detail: "The host has not reported its address yet." });
  config(h, { mode: "relay", address: "northwind.vyre.run" });
  assert.deepEqual(await health(h.ctx, {}), { state: "degraded", detail: "No certificate reported for northwind.vyre.run." });
  cert(h, "northwind.vyre.run", NOW + 90 * DAY_MS);
  assert.deepEqual(await health(h.ctx, {}), { state: "degraded", detail: "No relay endpoint reported.", daysToExpiry: 90 });
  endpoint(h, "relay", "https://northwind.vyre.run", "healthy", 40, NOW);
  assert.deepEqual(await health(h.ctx, {}), { state: "healthy", daysToExpiry: 90, latencyMs: 40 });
  endpoint(h, "relay", "https://northwind.vyre.run", "down", 40, NOW);
  assert.equal((await health(h.ctx, {})).state, "down");
  cert(h, "northwind.vyre.run", NOW + 3 * DAY_MS);
  assert.match(String((await health(h.ctx, {})).detail), /expires in 3 days/);
  config(h, { mode: "own_domain", address: HOST });
  cert(h, HOST, NOW + 0.5 * DAY_MS);
  assert.deepEqual([(await health(h.ctx, {})).state, (await health(h.ctx, {})).daysToExpiry], ["down", 0], "own domain ignores the relay row");
});

test("seed rows fit the migration and impl exposes every handler", async () => {
  const h = harness();
  for (const r of seed.rows) h.raw.run("INSERT INTO network_server (server_id, name, role, state, heartbeat_at) VALUES (?, ?, ?, ?, ?)", r.server_id, r.name, r.role, r.state, r.heartbeat_at);
  assert.equal((await serverList(h.ctx, {})).servers.length, 1);
  assert.equal(impl.handlers, handlers);
  assert.equal(Object.keys(impl.handlers).length, 12);
  assert.deepEqual([impl.projections, impl.consumers, impl.inline, impl.codecs], [[], {}, {}, {}]);
});
