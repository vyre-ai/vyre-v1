// Server services, restart, and the support bundle through the real handlers (spec 4.18, 3.10; ARCH 7.10).
// restart service updates status.
// @reads ../migrations/0001_init.sql
// @reads ../fixtures/seed.ts

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { harness, NOW, TRACE } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { seed } from "../fixtures/seed.ts";
import { reportProbe, runChecks } from "../handlers/checks.ts";
import { BUNDLE_TRACES, listServices, reportService } from "../handlers/services.ts";
import * as impl from "../impl.ts";
import { bundle, serviceRestart, services } from "../handlers/index.ts";

function withServices(o: Parameters<typeof harness>[0] = {}): Harness {
  const h = harness(o);
  for (const row of seed.rows) {
    h.raw.run("INSERT INTO health_service (name, state, started_at, restarts) VALUES (?, ?, ?, ?)", row.name, row.state, row.started_at, row.restarts);
  }
  return h;
}

test("services list their state, uptime in seconds and restart count, by name", async () => {
  const h = withServices();
  h.setNow(1760000000000 + 90_500);
  assert.deepEqual((await services(h.ctx, {})).services, [
    { name: "caddy", state: "healthy", uptimeSeconds: 90, restarts: 0 },
    { name: "gateway", state: "healthy", uptimeSeconds: 90, restarts: 0 },
    { name: "scheduler", state: "healthy", uptimeSeconds: 90, restarts: 0 },
  ]);
  assert.deepEqual(listServices(harness().ctx), [], "a server whose supervisor has not reported lists nothing");
});

test("restart service updates status", async () => {
  const h = withServices({ principal: "usr_admin", actingFor: "usr_ana" });
  const at = 1760000000000 + 3_600_000;
  h.setNow(at);
  assert.deepEqual(await serviceRestart(h.ctx, { service: "scheduler" }), { state: "healthy" });
  const row = h.raw.rows("health_service").find((r) => r["name"] === "scheduler")!;
  assert.deepEqual([row["state"], row["started_at"], row["restarts"]], ["healthy", at, 1], "a new start time and one more restart");
  const after = (await services(h.ctx, {})).services.find((s) => s.name === "scheduler")!;
  assert.deepEqual([after.uptimeSeconds, after.restarts], [0, 1]);
  const other = (await services(h.ctx, {})).services.find((s) => s.name === "gateway")!;
  assert.deepEqual([other.uptimeSeconds, other.restarts], [3600, 0], "other services are untouched");

  const queue = h.raw.rows("health_restart");
  assert.equal(queue.length, 1, "the supervisor finds the ask in the queue");
  assert.deepEqual([queue[0]!["service"], queue[0]!["by_principal"], queue[0]!["on_behalf"], queue[0]!["at"], queue[0]!["done_at"]], ["scheduler", "usr_admin", "usr_ana", at, null]);
  assert.match(String(queue[0]!["id"]), /^rst_[a-z0-9]+$/);
  assert.deepEqual(h.events.map((e) => [e.name, e.subject, e.payload]), [["service.restarted", "entity/scheduler", { service: "scheduler" }]]);

  h.setNow(at + 10_000);
  await serviceRestart(h.ctx, { service: "scheduler" });
  assert.equal(h.raw.rows("health_service").find((r) => r["name"] === "scheduler")!["restarts"], 2);
  assert.equal(h.raw.rows("health_restart").length, 2);
});

test("restarting a service the server does not have is a typed not_found and changes nothing", async () => {
  const h = withServices();
  await assert.rejects(
    () => serviceRestart(h.ctx, { service: "nope" }),
    (e: unknown) => e instanceof VyreErr && e.error.code === "validation.not_found" && e.error.traceId === TRACE && e.error.next.length > 0,
  );
  assert.equal(h.raw.rows("health_restart").length, 0);
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.raw.rows("health_service").map((r) => r["restarts"]), [0, 0, 0]);
});

test("the supervisor's report keeps the start time and restart count it was not given", () => {
  const h = harness();
  reportService(h.ctx, "gateway", { state: "healthy" });
  assert.deepEqual(h.raw.rows("health_service"), [{ name: "gateway", state: "healthy", started_at: NOW, restarts: 0 }]);
  h.setNow(NOW + 1000);
  reportService(h.ctx, "gateway", { state: "degraded" });
  assert.deepEqual(h.raw.rows("health_service"), [{ name: "gateway", state: "degraded", started_at: NOW, restarts: 0 }]);
  reportService(h.ctx, "gateway", { state: "healthy", startedAt: NOW + 500, restarts: 4 });
  assert.deepEqual(h.raw.rows("health_service"), [{ name: "gateway", state: "healthy", started_at: NOW + 500, restarts: 4 }]);
  assert.equal(listServices(h.ctx)[0]!.uptimeSeconds, 0);
});

test("a service row with a state the contract does not know is not listed", () => {
  const h = harness();
  h.raw.run("INSERT INTO health_service (name, state, started_at, restarts) VALUES (?, ?, ?, ?)", "odd", "booting", NOW, 0);
  assert.deepEqual(listServices(h.ctx), []);
});

const traceA = "11111111111111111111111111111111";
const traceB = "22222222222222222222222222222222";

test("the support bundle holds versions, health, services and log metadata, and tells what it could not read", async () => {
  const h = withServices({ principal: "usr_admin" });
  h.answer("health.docker", { state: "down", detail: "no socket" });
  await runChecks(h.ctx, [{ key: "host.docker", title: "Docker running", cap: "health.docker", module: "host", intervalSec: 60, timeoutMs: 100, states: {}, next: "Start Docker or Colima; sites need it.", pauses: ["automations"] }]);
  h.answer("updates.status", { current: "1.0.0", channel: "stable" });
  h.answer("logs.query", { rows: [{ id: 1, at: NOW, level: "warn", msg: "mail.held" }], total: 1 });
  h.answer("logs.trace", (input) => {
    const t = (input as { traceId: string }).traceId;
    if (t === traceB) throw fail("permission.no_grant", TRACE);
    return { logs: [{ id: 2, at: NOW, level: "info", msg: "record.updated", traceId: t }], spans: [], events: [] };
  });
  h.setNow(NOW + 1000);
  const out = await bundle(h.ctx, { traceIds: [traceA, traceB] });
  assert.match(out.bundleId, /^bnd_[a-z0-9]+$/);
  assert.match(out.fileId, /^fil_[a-z0-9]+$/);

  const row = h.raw.rows("health_bundle")[0]!;
  assert.deepEqual([row["id"], row["file_id"], row["by_principal"], row["at"]], [out.bundleId, out.fileId, "usr_admin", NOW + 1000]);
  const body = JSON.parse(String(row["body"])) as Record<string, unknown>;
  assert.equal(row["size_bytes"], new TextEncoder().encode(String(row["body"])).length);
  assert.deepEqual([body["bundleId"], body["space"], body["by"], body["createdAt"]], [out.bundleId, "spc_test", "usr_admin", NOW + 1000]);
  assert.equal((body["health"] as { overall: string }).overall, "down");
  assert.equal((body["paused"] as unknown[]).length, 1);
  assert.equal((body["services"] as unknown[]).length, 3);
  const parts = body["parts"] as Record<string, unknown>;
  assert.deepEqual(Object.keys(parts).sort(), ["recent", "trace:" + traceA, "trace:" + traceB, "versions"].sort());
  assert.deepEqual(parts["versions"], { current: "1.0.0", channel: "stable" });
  assert.deepEqual(parts["trace:" + traceB], { error: "permission.no_grant" });
  assert.deepEqual(body["missing"], ["trace:" + traceB]);
  assert.deepEqual(h.calls.slice(1).map((c) => c.cap), ["updates.status", "logs.query", "logs.trace", "logs.trace"], "the first call was the health check itself");
  assert.deepEqual(h.calls.find((c) => c.cap === "logs.query")!.input, { level: "warn", limit: 100 });

  assert.deepEqual(h.events.map((e) => [e.name, e.subject]), [["support_bundle.created", `entity/${out.bundleId}`]]);
  assert.deepEqual(h.events[0]!.payload, { bundleId: out.bundleId, sizeBytes: row["size_bytes"] });
});

test("a support bundle is still made when nothing else answers", async () => {
  const h = harness();
  const out = await bundle(h.ctx, {});
  const body = JSON.parse(String(h.raw.rows("health_bundle")[0]!["body"])) as { missing: string[]; health: { overall: string; checks: unknown[] }; services: unknown[] };
  assert.deepEqual(body.missing, ["versions", "recent"]);
  assert.deepEqual(body.health, { overall: "healthy", checks: [] });
  assert.deepEqual(body.services, []);
  assert.ok(out.bundleId && out.fileId);
  assert.equal(h.events.length, 1);
});

test("a bundle holds at most ten traces", async () => {
  const h = harness();
  h.answer("updates.status", {});
  h.answer("logs.query", {});
  h.answer("logs.trace", { logs: [], spans: [], events: [] });
  const ids = Array.from({ length: BUNDLE_TRACES + 5 }, (_, i) => String(i).padStart(32, "0"));
  await bundle(h.ctx, { traceIds: ids });
  assert.equal(h.calls.filter((c) => c.cap === "logs.trace").length, BUNDLE_TRACES);
  const body = JSON.parse(String(h.raw.rows("health_bundle")[0]!["body"])) as { parts: Record<string, unknown> };
  assert.equal(Object.keys(body.parts).filter((k) => k.startsWith("trace:")).length, BUNDLE_TRACES);
});

test("the bundle carries no log content: only what the log and health capabilities answered", async () => {
  const h = harness();
  reportProbe(h.ctx, "docker", { state: "healthy" });
  h.answer("updates.status", { current: "1.0.0" });
  h.answer("logs.query", { rows: [] });
  await bundle(h.ctx, {});
  const body = String(h.raw.rows("health_bundle")[0]!["body"]);
  assert.ok(!/"(body|text|subject|secret)"\s*:/.test(body));
});

test("impl.ts exposes every health handler and no projections", () => {
  assert.equal(Object.keys(impl.handlers).length, 17);
  assert.deepEqual(impl.projections, []);
  assert.deepEqual(impl.consumers, {});
  assert.deepEqual(impl.inline, {});
  assert.deepEqual(impl.codecs, {});
});

// Run on the final commit of this packet, after merging main, so the CI log lists the file as ok.
