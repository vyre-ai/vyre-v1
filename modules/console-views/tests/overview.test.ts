// Overview aggregates through the real handlers (spec 3.10, ARCH 7.10).
// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.
// contract tests for attention: attention items = failing checks + expired certs + failed runs + stuck updates.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DAY, NOW, certOk, healthy, quiet, world } from "../fixtures/db.ts";

const bad = {
  overall: "down",
  checks: [
    { key: "sync.lag", title: "Sync lag", state: "degraded", checkedAt: NOW - 5000, module: "sync", next: "Check the relay." },
    { key: "mail.send", title: "Sending", state: "down", checkedAt: NOW - 9000, module: "mail", next: "Reconnect the mail provider." },
    { key: "disk", title: "Disk", state: "healthy", checkedAt: NOW, module: "health", next: "Nothing to do." },
  ],
};

test("a quiet Space has no attention items and reads healthy", async () => {
  const w = world(quiet);
  const out = await handlers["console.overview"](w.ctx, {});
  assert.equal(out.health, "healthy");
  assert.deepEqual(out.attention, []);
  assert.deepEqual(out.usage, { turnsToday: 0, costMicrosMonth: 0, members: 0, agents: 0 });
});

test("attention items = failing checks + expired certs + failed runs + stuck updates (+ open reviews), most urgent first", async () => {
  const w = world({
    ...quiet,
    "health.status": bad,
    "network.status": { ...certOk, certificate: { host: "maya.vyre.run", expiresAt: NOW - DAY, state: "down" } },
    "updates.status": { current: "1.0.0", channel: "stable", lastResult: "failed" },
    "runs.list": { runs: [{ id: "run_a1", kind: "automation", name: "Welcome email", status: "failed", endedAt: NOW - 3000, startedAt: NOW - 4000, summary: "Step 2 timed out" }] },
    "access.reviews.list": { reviews: [{ id: "rvw_1", state: "open", openedAt: NOW - 10 * DAY, items: 12, decided: 9 }] },
  });
  const { items } = await handlers["console.attention"](w.ctx, {});
  assert.deepEqual(items.map((i) => i.kind), ["failing_check", "failing_check", "expiring_certificate", "stuck_update", "failed_run", "access_review_due"]);
  assert.deepEqual(items.slice(0, 2).map((i) => i.ref), ["mail.send", "sync.lag"], "down before degraded");
  assert.equal(items[0]!.next, "Reconnect the mail provider.");
  assert.match(items[2]!.title, /has expired/);
  assert.equal(items[4]!.ref, "run_a1");
  assert.equal(items[4]!.next, "Step 2 timed out");
  assert.equal(items[5]!.next, "Decide the 3 grants still waiting.");
  for (const i of items) assert.ok(i.title.length > 0 && i.next.length > 0 && Number.isInteger(i.since));
  const ov = await handlers["console.overview"](w.ctx, {});
  assert.equal(ov.health, "down");
  assert.deepEqual(ov.attention, items, "the Overview and console.attention agree");
  const asked = w.calls.find((c) => c.cap === "runs.list")!;
  assert.deepEqual(asked.input["statuses"], ["failed"]);
  assert.equal(asked.input["scope"], "all");
});

test("a certificate about to expire counts, a healthy one far from expiry does not", async () => {
  const soon = world({ ...quiet, "network.status": { ...certOk, certificate: { host: "h.example", expiresAt: NOW + 5 * DAY, state: "healthy" } } });
  const a = (await handlers["console.attention"](soon.ctx, {})).items;
  assert.equal(a.length, 1);
  assert.match(a[0]!.title, /expires soon/);
  assert.equal((await handlers["console.attention"](world(quiet).ctx, {})).items.length, 0);
});

test("a rolled-back update is stuck; an ok one is not", async () => {
  const w = world({ ...quiet, "updates.status": { current: "1.0.0", channel: "stable", available: "1.0.1", lastResult: "rolled_back" } });
  const a = (await handlers["console.attention"](w.ctx, {})).items;
  assert.deepEqual(a.map((i) => i.kind), ["stuck_update"]);
  assert.match(a[0]!.title, /rolled back/);
});

test("a source the caller may not read drops out; unreadable health reads degraded and says so", async () => {
  const denied = new Error("auth.forbidden");
  const w = world({ ...quiet, "network.status": denied, "runs.list": denied, "audit.list": denied, "access.reviews.list": denied });
  const out = await handlers["console.overview"](w.ctx, {});
  assert.equal(out.health, "healthy");
  assert.deepEqual(out.attention, []);
  assert.deepEqual(out.activity, []);

  const noHealth = world({ ...quiet, "health.status": denied });
  const o2 = await handlers["console.overview"](noHealth.ctx, {});
  assert.equal(o2.health, "degraded");
  assert.equal(o2.attention[0]!.title, "Health could not be read");
});

test("activity comes newest first from the audit log, with resources written type/id", async () => {
  const rows = [
    { id: "aud_1", at: NOW - 3000, actor: { kind: "person", id: "usr_a" }, action: "grant.created", resource: { type: "folder", id: "fld_1" }, class: "sensitive", traceId: "x", seq: 1 },
    { id: "aud_2", at: NOW - 1000, actor: { kind: "agent", id: "agt_b" }, onBehalfOf: { kind: "person", id: "usr_a" }, action: "role.assigned", class: "sensitive", traceId: "x", seq: 2 },
    { id: "aud_3", at: NOW - 2000, actor: { kind: "person", id: "usr_c" }, action: "policy.changed", resource: { type: "space", id: "spc_test" }, class: "sensitive", traceId: "x", seq: 3 },
  ];
  const w = world({ ...quiet, "audit.list": { rows } });
  const out = await handlers["console.activity"](w.ctx, { limit: 2 });
  assert.deepEqual(out.rows, [
    { at: NOW - 1000, actor: "agt_b", action: "role.assigned" },
    { at: NOW - 2000, actor: "usr_c", action: "policy.changed", resource: "space/spc_test" },
  ]);
  assert.equal(w.calls.find((c) => c.cap === "audit.list")!.input["limit"], 2);
});

test("usage at a glance: turns today, cost this month, people and agents", async () => {
  const w = world({
    ...quiet,
    "engine.usage.query": (i: Record<string, unknown>) => ({ rows: [], totals: { turns: (i["from"] as number) >= NOW - DAY ? 7 : 40, tokensIn: 1, tokensOut: 1, costMicros: (i["from"] as number) >= NOW - DAY ? 100 : 5_000 } }),
    "access.principals.list": (i: Record<string, unknown>) => ({ principals: [], total: i["kind"] === "person" ? 9 : 4 }),
  });
  const { usage } = await handlers["console.overview"](w.ctx, {});
  assert.equal(usage.turnsToday, 7);
  assert.equal(usage.costMicrosMonth, 5_000, "the month total comes from the month-to-date query");
  assert.deepEqual([usage.members, usage.agents], [9, 4]);
});

test("console.usage sorts by cost and always carries the design-beta sentence", async () => {
  const t = (c: number) => ({ turns: 1, tokensIn: 2, tokensOut: 3, costMicros: c });
  const w = world({ ...quiet, "engine.usage.query": { rows: [{ key: "agt_a", title: "Scout", totals: t(10) }, { key: "agt_b", title: "Ana", totals: t(90) }, { key: "", title: "x", totals: t(1) }], totals: t(100) } });
  const out = await handlers["console.usage"](w.ctx, { period: "week", by: "agent" });
  assert.deepEqual(out.rows.map((r) => r.name), ["Ana", "Scout"]);
  assert.equal(out.note, "Vyre is in design beta. Contact Clearfield Labs for more information on plans and pricing.");
  const q = w.calls.find((c) => c.cap === "engine.usage.query")!.input;
  assert.equal(q["by"], "agent");
  assert.equal(NOW - (q["from"] as number), 7 * DAY);
});

test("console.nav hides pages the caller may not open, and empty groups", async () => {
  const admin = (await handlers["console.nav"](world(quiet, ["console.access", "access.manage", "server.logs"]).ctx, {})).groups;
  const keys = (g: string) => admin.find((x) => x.key === g)?.pages.map((p) => p.key);
  assert.deepEqual(keys("overview"), ["console.overview", "console.usage"]);
  assert.ok(keys("access")!.includes("access.checker"));
  assert.ok(!keys("access")!.includes("access.policies"));
  assert.equal(admin.find((g) => g.key === "audit"), undefined, "no audit.read: no Audit log group");
  assert.ok(keys("infrastructure")!.includes("console.server-logs"));
  assert.ok(!keys("infrastructure")!.includes("console.network"));
  const none = (await handlers["console.nav"](world(quiet, []).ctx, {})).groups;
  assert.deepEqual(none, []);
});

test("an unhealthy overview still answers when every other source is down", async () => {
  const e = new Error("down");
  const w = world({ "health.status": healthy, "network.status": e, "updates.status": e, "runs.list": e, "access.reviews.list": e, "audit.list": e, "engine.usage.query": e, "access.principals.list": e });
  const out = await handlers["console.overview"](w.ctx, {});
  assert.equal(out.health, "healthy");
  assert.deepEqual(out.usage, { turnsToday: 0, costMicrosMonth: 0, members: 0, agents: 0 });
});

test("the Overview carries the server's CPU, memory and disk and the last backup, from the health probe and the backup log", async () => {
  const w = world({
    ...quiet,
    "health.machine": { state: "healthy", machine: { cpuPercent: 12.5, memoryUsedBytes: 4_000, memoryTotalBytes: 16_000, diskFreeBytes: 700, diskTotalBytes: 1_000, junk: 9 } },
    "backup.list": { backups: [{ backupId: "bkp_a", at: NOW - 2 * DAY, verified: true }, { backupId: "bkp_b", at: NOW - DAY, verified: false }] },
  });
  const out = await handlers["console.overview"](w.ctx, {});
  assert.deepEqual(out.machine, { cpuPercent: 12.5, memoryUsedBytes: 4_000, memoryTotalBytes: 16_000, diskFreeBytes: 700, diskTotalBytes: 1_000 });
  assert.deepEqual(out.lastBackup, { at: NOW - DAY, result: "unverified" }, "the newest backup, whatever the order of the list");
});

test("a caller who may not read the probe or the backup log still gets the Overview, without those tiles", async () => {
  const w = world({ ...quiet, "health.machine": new Error("denied"), "backup.list": new Error("denied") });
  const out = await handlers["console.overview"](w.ctx, {});
  assert.equal("machine" in out, false);
  assert.equal("lastBackup" in out, false);
  const none = await handlers["console.overview"](world({ ...quiet, "health.machine": { state: "degraded", detail: "The host has not reported this yet." }, "backup.list": { backups: [] } }).ctx, {});
  assert.equal("machine" in none || "lastBackup" in none, false);
});

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.
