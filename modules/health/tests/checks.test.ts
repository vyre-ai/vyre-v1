// Health checks through the real handlers (spec 4.18, ARCH 3.5 HealthCheckDef, 7.10).
// contract tests for next: every failing check returns a next step.
// @reads ../migrations/0001_init.sql
// @reads /generated/registry.json

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { harness, NOW, TRACE } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import {
  DAY_MS, PROBES, historyOf, loadDefs, orderDefs, parseDefs, pausedOf, readMachine, readProbe, reportProbe, ruleHolds, runChecks, setDefsProvider, statusOf, worst,
} from "../handlers/checks.ts";
import type { HealthDef } from "../handlers/checks.ts";
import { doctorRun, handlers, history, pausedReasons, run, status } from "../handlers/index.ts";

interface Registry { health: unknown[]; capabilities: { name: string }[] }
const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as Registry;

const def = (key: string, o: Partial<HealthDef> = {}): HealthDef => ({
  key, title: `Title ${key}`, cap: `probe.${key}`, module: key.split(".")[0]!, intervalSec: 60, timeoutMs: 200, states: {},
  next: `Fix ${key} by doing the thing.`, ...o,
});
const use = (defs: HealthDef[]): void => setDefsProvider(() => defs);
const healthy = { state: "healthy" } as const;

function answerAll(h: Harness, defs: readonly HealthDef[], a: unknown): void {
  for (const d of defs) h.answer(d.cap, a);
}

test("contract tests for next: every failing check returns a next step", async () => {
  setDefsProvider(null);
  const defs = loadDefs();
  assert.equal(defs.length, registry.health.length, "every manifest HealthCheckDef is loaded");
  assert.ok(defs.length >= 47);
  const caps = new Set(registry.capabilities.map((c) => c.name));
  assert.equal(new Set(defs.map((d) => d.key)).size, defs.length, "keys are unique");
  for (const d of defs) {
    assert.ok(caps.has(d.cap), `${d.key}: capability ${d.cap} exists`);
    assert.ok(d.next.length >= 15, `${d.key}: has a next step in plain words`);
    assert.ok(d.title.length > 0);
  }

  const h = harness();
  answerAll(h, defs, { state: "down", detail: "nope" });
  const out = await run(h.ctx, {});
  assert.equal(out.checks.length, defs.length, "run executes every manifest check");
  for (const c of out.checks) {
    assert.notEqual(c.state, "healthy", c.key);
    assert.equal(c.next, defs.find((d) => d.key === c.key)!.next, `${c.key}: the failing check carries its own next step`);
    assert.ok(c.next.length > 0);
  }
  const doc = await doctorRun(h.ctx, {});
  assert.equal(doc.ok, false);
  assert.equal(doc.findings.length, defs.length);
  for (const f of doc.findings) assert.ok(f.next.length >= 15 && f.state !== "healthy", `${f.key}: finding has a next step`);

  const fine = harness();
  answerAll(fine, defs, healthy);
  const all = await run(fine.ctx, {});
  assert.ok(all.checks.every((c) => c.state === "healthy"));
  assert.deepEqual(await doctorRun(fine.ctx, {}), { ok: true, findings: [] });
});

test("definitions run after the checks they depend on", () => {
  setDefsProvider(null);
  const order = orderDefs(loadDefs()).map((d) => d.key);
  assert.equal(order.length, loadDefs().length);
  const at = (k: string): number => order.indexOf(k);
  assert.ok(at("host.docker") < at("host.caddy"));
  assert.ok(at("kernel.events_db") < at("search.index"));
  assert.ok(at("network.certificate") < at("network.relay"));
  const cyc = orderDefs([def("a", { dependsOn: ["b"] }), def("b", { dependsOn: ["a"] }), def("c", { dependsOn: ["missing"] })]);
  assert.deepEqual(cyc.map((d) => d.key).sort(), ["a", "b", "c"], "a cycle and an unknown dependency still run every check once");
});

test("parseDefs keeps well formed rows and drops the rest", () => {
  const rows = parseDefs([
    { key: "a.b", title: "T", cap: "x.y", next: "Do it now please.", intervalSec: 30, timeoutMs: 1000, module: "a", states: { degradedWhen: "latencyMs > 5" }, dependsOn: ["z", 3], pauses: ["sync", "bogus"] },
    { key: "no.next", title: "T", cap: "x.y" },
    { title: "no key", cap: "x.y", next: "n" },
    "text", null, 7,
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { key: "a.b", title: "T", cap: "x.y", next: "Do it now please.", intervalSec: 30, timeoutMs: 1000, module: "a", states: { degradedWhen: "latencyMs > 5" }, dependsOn: ["z"], pauses: ["sync"] });
  assert.deepEqual(parseDefs(undefined), []);
  assert.equal(parseDefs([{ key: "k.j", title: "T", cap: "c.d", next: "n" }])[0]!.module, "k", "module defaults to the key prefix");
});

test("the manifest rules turn an answer into Healthy, Degraded or Down", async () => {
  const disk = def("host.disk", { states: { degradedWhen: "freeBytes < 5000000000", downWhen: "freeBytes < 500000000" } });
  const lat = def("net.lat", { states: { degradedWhen: "latencyMs > 2000" } });
  const flagged = def("kernel.db", { states: { downWhen: "state == 'down'" } });
  const bad = def("odd.rule", { states: { degradedWhen: "this is (", downWhen: "no.such.name > 5" } });
  use([disk, lat, flagged, bad]);
  const h = harness();
  const stateOf = async (key: string): Promise<string> => (await run(h.ctx, { key })).checks[0]!.state;

  h.answer(disk.cap, { state: "healthy", freeBytes: 9_000_000_000 });
  assert.equal(await stateOf("host.disk"), "healthy");
  h.answer(disk.cap, { state: "healthy", freeBytes: 1_000_000_000 });
  assert.equal(await stateOf("host.disk"), "degraded");
  h.answer(disk.cap, { state: "healthy", freeBytes: 100 });
  assert.equal(await stateOf("host.disk"), "down", "down wins over degraded");
  h.answer(disk.cap, { state: "healthy" });
  assert.equal(await stateOf("host.disk"), "healthy", "a missing number holds no rule");

  h.answer(lat.cap, { state: "healthy", latencyMs: 2500 });
  assert.equal(await stateOf("net.lat"), "degraded");
  h.answer(lat.cap, { state: "healthy", latencyMs: 100 });
  assert.equal(await stateOf("net.lat"), "healthy");
  h.answer(lat.cap, { state: "healthy" });
  assert.equal(await stateOf("net.lat"), "healthy", "measured latency is small and counts when the check names none");

  h.answer(flagged.cap, { state: "down", detail: "chain broken" });
  const row = (await run(h.ctx, { key: "kernel.db" })).checks[0]!;
  assert.deepEqual([row.state, row.detail], ["down", "chain broken"]);

  h.answer(bad.cap, { state: "degraded" });
  assert.equal(await stateOf("odd.rule"), "degraded", "a rule that does not parse holds nothing; the check's own state stands");
  assert.equal(ruleHolds(undefined, {}), false);
  assert.equal(ruleHolds("a > 1", { a: 2 }), true);
  assert.equal(ruleHolds("a > 1", { a: 1 }), false);
  assert.equal(worst("healthy", "down"), "down");
  assert.equal(worst("degraded", "healthy"), "degraded");
});

test("a check that fails, is slow, or answers nonsense is Down with the reason", async () => {
  const a = def("a.throws"), b = def("b.slow", { timeoutMs: 20 }), c = def("c.nonsense"), d = def("d.unknown");
  use([a, b, c, d]);
  const h = harness();
  h.answer(a.cap, () => { throw fail("permission.no_grant", TRACE); });
  h.answer(b.cap, () => new Promise(() => undefined));
  h.answer(c.cap, { state: "fine" });
  const rows = (await run(h.ctx, {})).checks;
  const by = new Map(rows.map((r) => [r.key, r]));
  assert.deepEqual([by.get("a.throws")!.state, by.get("a.throws")!.detail], ["down", "The check could not run (permission.no_grant)."]);
  assert.deepEqual([by.get("b.slow")!.state, by.get("b.slow")!.detail], ["down", "The check could not run (timeout)."]);
  assert.deepEqual([by.get("c.nonsense")!.state, by.get("c.nonsense")!.detail], ["down", "The check gave an answer that is not a health state."]);
  assert.deepEqual([by.get("d.unknown")!.state, by.get("d.unknown")!.detail], ["down", "The check could not run (internal.not_implemented)."], "no answer at all reads as not implemented");
  for (const r of rows) assert.ok(r.next.length > 0);
});

test("a check waits for what it depends on: nothing is called, and the reason names the dependency", async () => {
  const docker = def("host.docker"), caddy = def("host.caddy", { dependsOn: ["host.docker"] });
  use([caddy, docker]);
  const h = harness();
  h.answer(docker.cap, { state: "down", detail: "no socket" });
  h.answer(caddy.cap, healthy);
  const rows = (await run(h.ctx, {})).checks;
  assert.deepEqual(rows.map((r) => r.key), ["host.docker", "host.caddy"], "dependencies first");
  assert.deepEqual(h.calls.map((x) => x.cap), [docker.cap], "the dependent check is not called while its dependency is down");
  assert.deepEqual([rows[1]!.state, rows[1]!.detail], ["down", "Waiting on Title host.docker."]);

  const alone = await run(h.ctx, { key: "host.caddy" });
  assert.equal(alone.checks[0]!.state, "down", "a single run reads the stored state of its dependency");
  assert.equal(h.calls.length, 1);

  h.answer(docker.cap, healthy);
  await run(h.ctx, { key: "host.docker" });
  const fixed = await run(h.ctx, { key: "host.caddy" });
  assert.equal(fixed.checks[0]!.state, "healthy");
  assert.equal(h.calls.at(-1)!.cap, caddy.cap);
});

test("a degraded dependency does not stop the checks that rely on it", async () => {
  const a = def("a.x"), b = def("b.y", { dependsOn: ["a.x"] });
  use([a, b]);
  const h = harness();
  h.answer(a.cap, { state: "degraded" });
  h.answer(b.cap, healthy);
  const rows = (await run(h.ctx, {})).checks;
  assert.deepEqual(rows.map((r) => r.state), ["degraded", "healthy"]);
});

test("running one key runs only that check; an unknown key is a typed not_found", async () => {
  const a = def("a.x"), b = def("b.y");
  use([a, b]);
  const h = harness();
  answerAll(h, [a, b], healthy);
  const out = await run(h.ctx, { key: "b.y" });
  assert.deepEqual(out.checks.map((c) => c.key), ["b.y"]);
  assert.deepEqual(h.calls.map((c) => c.cap), [b.cap]);
  await assert.rejects(
    () => run(h.ctx, { key: "no.such" }),
    (e: unknown) => e instanceof VyreErr && e.error.code === "validation.not_found" && e.error.traceId === TRACE && e.error.next.length > 0,
  );
  assert.equal(h.calls.length, 1, "nothing ran for the unknown key");
});

test("results are stored with title, module and next step, and the state keeps its start time", async () => {
  const a = def("mail.sync", { title: "Mail sync", next: "Reconnect the mailbox in Connections." });
  use([a]);
  const h = harness();
  h.answer(a.cap, { state: "degraded", detail: "slow" });
  await run(h.ctx, {});
  h.setNow(NOW + 60_000);
  await run(h.ctx, {});
  let r = h.raw.rows("health_state")[0]!;
  assert.deepEqual([r["check_key"], r["module"], r["title"], r["state"], r["detail"], r["checked_at"], r["since"], r["next"]], ["mail.sync", "mail", "Mail sync", "degraded", "slow", NOW + 60_000, NOW, "Reconnect the mailbox in Connections."]);
  h.answer(a.cap, healthy);
  h.setNow(NOW + 120_000);
  await run(h.ctx, {});
  r = h.raw.rows("health_state")[0]!;
  assert.deepEqual([r["state"], r["since"]], ["healthy", NOW + 120_000], "since moves when the state changes");
  assert.equal(h.raw.rows("health_state").length, 1);
  assert.equal(h.raw.rows("health_sample").length, 3);
});

test("an unhealthy check pauses its areas with a visible reason, and resuming clears them", async () => {
  const a = def("mail.sync", { title: "Mail sync", pauses: ["sync", "automations"], next: "Reconnect the mailbox in Connections." });
  const quiet = def("search.index", { dependsOn: [] });
  use([a, quiet]);
  const h = harness();
  h.answer(quiet.cap, { state: "down" });
  h.answer(a.cap, { state: "down", detail: "auth expired" });
  const first = await run(h.ctx, {});
  assert.deepEqual(pausedOf(h.ctx), [
    { area: "automations", key: "mail.sync", reason: "Mail sync is down: auth expired. Reconnect the mailbox in Connections." },
    { area: "sync", key: "mail.sync", reason: "Mail sync is down: auth expired. Reconnect the mailbox in Connections." },
  ]);
  assert.deepEqual((await pausedReasons(h.ctx, {})).paused, pausedOf(h.ctx));
  assert.equal(first.checks.length, 2);
  assert.equal(h.raw.rows("health_pause").length, 2, "a check with no pauses holds nothing back");

  h.setNow(NOW + 5000);
  await run(h.ctx, {});
  assert.deepEqual(h.raw.rows("health_pause").map((p) => p["since"]), [NOW, NOW], "the pause keeps its start time");

  h.answer(a.cap, healthy);
  await run(h.ctx, {});
  assert.deepEqual(pausedOf(h.ctx), []);
  assert.deepEqual(await pausedReasons(h.ctx, {}), { paused: [] });
});

test("state changes are reported as transitions: first sight, change, pause and resume", async () => {
  const a = def("mail.sync", { pauses: ["sync"] });
  use([a]);
  const h = harness();
  h.answer(a.cap, { state: "degraded" });
  const t1 = (await runChecks(h.ctx, [a])).transitions;
  assert.deepEqual(t1, [{ key: "mail.sync", from: null, to: "degraded", paused: ["sync"], resumed: false }]);
  assert.deepEqual((await runChecks(h.ctx, [a])).transitions, [], "no change, no transition");
  h.answer(a.cap, { state: "down", detail: "gone" });
  assert.deepEqual((await runChecks(h.ctx, [a])).transitions, [{ key: "mail.sync", from: "degraded", to: "down", detail: "gone", paused: ["sync"], resumed: false }]);
  h.answer(a.cap, healthy);
  assert.deepEqual((await runChecks(h.ctx, [a])).transitions, [{ key: "mail.sync", from: "down", to: "healthy", paused: [], resumed: true }]);
});

test("status groups checks by module and reports the worst state", async () => {
  const defs = [def("b.x"), def("a.y"), def("a.x")];
  use(defs);
  const h = harness();
  assert.deepEqual(await status(h.ctx, {}), { overall: "healthy", checks: [] }, "nothing has run yet");
  h.answer(defs[0]!.cap, healthy);
  h.answer(defs[1]!.cap, { state: "degraded", detail: "slow" });
  h.answer(defs[2]!.cap, healthy);
  await run(h.ctx, {});
  const s = await status(h.ctx, {});
  assert.deepEqual(s.checks.map((c) => c.key), ["a.x", "a.y", "b.x"]);
  assert.equal(s.overall, "degraded");
  assert.deepEqual(s.checks[1], { key: "a.y", title: "Title a.y", state: "degraded", detail: "slow", checkedAt: NOW, module: "a", next: "Fix a.y by doing the thing." });
  h.answer(defs[0]!.cap, { state: "down" });
  await run(h.ctx, { key: "b.x" });
  assert.equal((await status(h.ctx, {})).overall, "down");
  assert.equal(statusOf(h.ctx).checks.length, 3);
});

test("history lists the samples of one check, filtered by time, and old samples are pruned", async () => {
  const a = def("a.x");
  use([a]);
  const h = harness();
  h.raw.run("INSERT INTO health_sample (check_key, at, state, latency_ms, detail) VALUES (?, ?, ?, ?, ?)", "a.x", NOW - 40 * DAY_MS, "down", null, "old");
  h.raw.run("INSERT INTO health_sample (check_key, at, state, latency_ms, detail) VALUES (?, ?, ?, ?, ?)", "a.x", NOW - 10 * DAY_MS, "degraded", 7, null);
  h.raw.run("INSERT INTO health_sample (check_key, at, state, latency_ms, detail) VALUES (?, ?, ?, ?, ?)", "other.k", NOW - 1000, "down", null, null);
  h.answer(a.cap, { state: "degraded", detail: "slow", latencyMs: 1500 });
  await run(h.ctx, {});
  h.answer(a.cap, healthy);
  h.setNow(NOW + 3000);
  await run(h.ctx, {});
  assert.equal(h.raw.rows("health_sample").some((s) => s["detail"] === "old"), false, "samples older than 30 days are deleted when checks run");
  const week = (await history(h.ctx, { key: "a.x" })).samples;
  assert.equal(week.length, 2, "the last 7 days by default: the 10 day old sample is outside");
  assert.deepEqual(week[0], { at: NOW, state: "degraded", latencyMs: 1500, detail: "slow" });
  assert.deepEqual([week[1]!.at, week[1]!.state, week[1]!.detail], [NOW + 3000, "healthy", undefined]);
  const wide = (await history(h.ctx, { key: "a.x", sinceMs: NOW - 20 * DAY_MS })).samples;
  assert.deepEqual(wide.map((s) => s.state), ["degraded", "degraded", "healthy"]);
  assert.deepEqual((await history(h.ctx, { key: "no.such" })).samples, []);
  assert.equal(historyOf(h.ctx, "a.x", NOW + 1).length, 1, "a since in the future still finds the later sample");
});

test("host probes read what the host reported, and say so when it did not", () => {
  const h = harness();
  assert.deepEqual(readProbe(h.ctx, "docker"), { state: "degraded", detail: "The host has not reported this yet." });
  reportProbe(h.ctx, "docker", { state: "healthy", latencyMs: 12.7 });
  assert.deepEqual(readProbe(h.ctx, "docker"), { state: "healthy", latencyMs: 12 });
  reportProbe(h.ctx, "disk_space", { state: "degraded", detail: "low", values: { freeBytes: 4_000_000_000.9 } });
  assert.deepEqual(readProbe(h.ctx, "disk_space"), { state: "degraded", detail: "low", freeBytes: 4_000_000_000 });
  reportProbe(h.ctx, "time_skew", { state: "healthy", values: { skewMs: -40 } });
  assert.deepEqual(readProbe(h.ctx, "time_skew"), { state: "healthy", skewMs: -40 });
  reportProbe(h.ctx, "docker", { state: "healthy", values: { freeBytes: 5 } });
  assert.equal("freeBytes" in readProbe(h.ctx, "docker"), false, "only disk_space and time_skew carry a number");

  h.setNow(NOW + 4 * 60_000);
  assert.deepEqual(readProbe(h.ctx, "docker"), { state: "healthy" }, "four minutes is inside the window");
  h.setNow(NOW + 6 * 60_000);
  assert.deepEqual(readProbe(h.ctx, "docker"), { state: "degraded", detail: "The host has not reported for 6 minutes." });
  reportProbe(h.ctx, "scheduler", { state: "healthy" });
  h.setNow(NOW + 6 * 60_000 + 100_000);
  assert.deepEqual(readProbe(h.ctx, "scheduler"), { state: "down", detail: "The host has not reported for 2 minutes." }, "a scheduler that stopped ticking is down, not degraded");

  h.raw.run("INSERT OR REPLACE INTO health_probe (name, state, detail, latency_ms, values_json, at) VALUES (?, ?, ?, ?, ?, ?)", "caddy", "weird", null, null, "{broken", h.ctx.now());
  assert.deepEqual(readProbe(h.ctx, "caddy"), { state: "down" });
});

test("each of the eight probe capabilities answers from its own report", async () => {
  const h = harness();
  assert.equal(Object.keys(PROBES).length, 8);
  for (const [cap, name] of Object.entries(PROBES)) {
    const handler = (handlers as unknown as Record<string, (ctx: Harness["ctx"], input: Record<string, unknown>) => Promise<unknown>>)[cap];
    assert.ok(handler, `${cap} has a handler`);
    assert.deepEqual(await handler(h.ctx, {}), { state: "degraded", detail: "The host has not reported this yet." });
    reportProbe(h.ctx, name, { state: "healthy" });
    assert.deepEqual(await handler(h.ctx, {}), { state: "healthy" }, `${cap} reads ${name}`);
  }
});

test("a check's capability can be a host probe, end to end", async () => {
  const caddy = def("host.caddy", { cap: "health.caddy" });
  use([caddy]);
  const h = harness();
  h.answer("health.caddy", () => handlers["health.caddy"](h.ctx, {}));
  assert.equal((await run(h.ctx, {})).checks[0]!.state, "degraded", "no report yet");
  reportProbe(h.ctx, "caddy", { state: "healthy" });
  assert.equal((await run(h.ctx, {})).checks[0]!.state, "healthy");
});

test("health.machine answers the numbers the host reported for CPU, memory and disk, and none when stale or broken", () => {
  const h = harness();
  assert.deepEqual(readMachine(h.ctx), { state: "degraded", detail: "The host has not reported this yet." });
  reportProbe(h.ctx, "machine", { state: "healthy", values: { cpuPercent: 37.5, memoryUsedBytes: 6_000_000_000.7, memoryTotalBytes: 16_000_000_000, diskFreeBytes: 120_000_000_000, diskTotalBytes: 500_000_000_000, bogus: 1 } });
  assert.deepEqual(readMachine(h.ctx), { state: "healthy", machine: { cpuPercent: 37.5, memoryUsedBytes: 6_000_000_000, memoryTotalBytes: 16_000_000_000, diskFreeBytes: 120_000_000_000, diskTotalBytes: 500_000_000_000 } });
  reportProbe(h.ctx, "machine", { state: "healthy", values: { cpuPercent: 250 } });
  assert.deepEqual(readMachine(h.ctx).machine, { cpuPercent: 100 }, "a load above 100 is capped");
  h.setNow(NOW + 6 * 60_000);
  assert.deepEqual(readMachine(h.ctx), { state: "degraded", detail: "The host has not reported for 6 minutes." });
});

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.
