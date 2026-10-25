// P-L11_03: server and headless probes on a booted daemon over the perf Space, through the gateway with a real token (rule 27).
//   perf Space      the template loads in under 1 s
//   server_write    records.create at 200 ops/s: p50 and p95 under 10 ms (cap.commit; measured here as the whole round trip on loopback, an upper bound)
//   connection_count  a device holds exactly one live socket: a second connection replaces the first
//   engine_pool, send  need the agent turn engine on the daemon: todo until P-L2_23 (the module level proofs are agent/tests/pool.perf.test.ts and turn-engine.perf.test.ts)
// Ruling 46: a speed number counts only from the v1-perf runners. VYRE_PERF_FULL=1 builds the full Space (100k contacts) and holds the numbers to the budgets; without it the file runs at the
// ci scale, prints the same METRIC lines and asserts the structure (the pacer kept up, every create answered) with a loose ceiling that only catches a pathology.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PERF_LIVE, bootPerf } from "../../fixtures/seed/perf/build.ts";
import type { PerfScale } from "../../fixtures/seed/perf/build.ts";
import { startSeeded } from "../../fixtures/seed/small/build.ts";
import { issueSessionToken } from "../../host/src/daemon/session.ts";
import { routes } from "../../generated/routes.ts";
import { judge, loadBudgets, metricLine } from "../harness/index.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";

const FULL = process.env["VYRE_PERF_FULL"] === "1";
const SCALE: PerfScale = FULL ? "full" : "ci";
const scratch = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "perf-server-"));
const cache = process.env["VYRE_SEED_CACHE"] ?? scratch();
const budget = (id: string) => {
  const b = loadBudgets().find((x) => x.id === id);
  assert.ok(b, `perf/budgets.json has ${id}`);
  return b;
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const post = (d: Daemon, cap: string, body: unknown, token = d.token): Promise<Response> => {
  const route = routes.find((r) => r.cap === cap);
  if (!route) throw new Error(`no route for ${cap}`);
  return fetch(`${d.url}${route.path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
};

/** A device session for a person the seed has (what sign-in writes), and its bearer token. */
function signedIn(d: Daemon, person: string, device: string): string {
  const now = Date.now(), session = `ses_${device.slice(4)}`;
  d.db!.run(`INSERT OR IGNORE INTO devices_device (id, person, name, class, epoch, lastSeenAt, location, revokedAt, version, updated_at, deleted_at) VALUES (?, ?, ?, 'desktop', 0, ?, NULL, NULL, 0, ?, NULL)`, device, person, `${person} laptop`, now, now);
  d.db!.run(`INSERT OR IGNORE INTO devices_session (id, person, kind, principal_kind, device_id, started_at, last_seen_at, location, revoked_at) VALUES (?, ?, 'device', 'person', ?, ?, ?, NULL, NULL)`, session, person, device, now, now);
  return issueSessionToken(d.db!, session);
}

test(`perf Space: the ${SCALE} template loads in under 1 s`, async () => {
  const warm = await bootPerf({ scale: SCALE, cache, scratch: scratch() });   // builds the template when the cache has none
  warm.close();
  const t0 = performance.now();
  const s = await bootPerf({ scale: SCALE, cache, scratch: scratch() });
  const ms = performance.now() - t0;
  s.close();
  assert.equal(s.hit, true);
  console.log(`METRIC ${JSON.stringify({ name: "perf_space_load", scale: SCALE, ms: Math.round(ms), budget_ms: 1000, contacts: s.sizes.contacts })}`);
  assert.ok(ms < 0.001, `loading the ${SCALE} perf Space took ${ms.toFixed(0)} ms, budget 1000 ms`);
});

test("server_write: records.create at 200 ops/s through the gateway, p50 and p95 under 10 ms", async () => {
  const space = await bootPerf({ scale: SCALE, cache, scratch: scratch() });
  const d = await startSeeded(space.dir, PERF_LIVE);
  try {
    assert.equal((await post(d, "schema.types.list", {})).status, 200);
    for (let i = 0; i < 20; i++) assert.equal((await post(d, "records.create", { idempotencyKey: `warm-${i}`, type: "contact", fields: { name: `Warm ${i}`, email: `warm${i}@w.example.test` } })).status, 200);
    const N = 400, lat: number[] = [], traces: string[] = [];
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const wait = t0 + i * 5 - performance.now();
      if (wait > 0) await sleep(wait);
      const sent = performance.now();
      const res = await post(d, "records.create", { idempotencyKey: `w-${i}`, type: "contact", fields: { name: `Write ${i}`, email: `write${i}@w.example.test` } });
      lat.push(performance.now() - sent);
      traces.push(res.headers.get("x-vyre-trace") ?? "");
      assert.equal(res.status, 200, `create ${i}: ${res.status}`);
    }
    const wall = (performance.now() - t0) / 1000;
    const report = judge(budget("server_write"), lat.map((value, i) => ({ value, traceId: traces[i] ?? "", spans: [] })));
    console.log(metricLine(report));
    console.log(`server_write: ${N} creates in ${wall.toFixed(2)} s (${(N / wall).toFixed(0)}/s) over ${space.sizes.contacts} contacts, p50 ${report.p50.toFixed(2)} p95 ${report.p95.toFixed(2)} ms`);
    assert.ok(N / wall >= 150, `the pacer kept up (${(N / wall).toFixed(0)}/s)`);
    if (FULL) assert.ok(report.ok, `server_write p50 ${report.p50.toFixed(2)} p95 ${report.p95.toFixed(2)} over the 10 ms budget\n${report.waterfall ?? ""}`);
    else assert.ok(report.p95 < 0.001, `p95 ${report.p95.toFixed(2)} ms is a pathology even for a shared runner`);
  } finally { await d.stop(); space.close(); }
});

test("connection_count: a device holds one live socket, a second connection replaces the first", async () => {
  const space = await bootPerf({ scale: SCALE, cache, scratch: scratch() });
  const d = await startSeeded(space.dir, PERF_LIVE);
  try {
    const token = signedIn(d, "usr_noah", "dev_perfone");
    const open = (): Promise<{ ws: WebSocket; closed: Promise<number> }> => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${d.port}/sync/v1/ws?token=${token}`);
      const closed = new Promise<number>((r) => ws.addEventListener("close", (e) => r(e.code)));
      ws.addEventListener("open", () => resolve({ ws, closed }));
      ws.addEventListener("error", () => reject(new Error("could not connect")));
    });
    const a = await open();
    const b = await open();
    assert.equal(await Promise.race([a.closed, sleep(2000).then(() => -1)]), 4000, "the first socket is closed with 'replaced by a newer connection from this device'");
    const states = [a.ws.readyState, b.ws.readyState];
    const live = states.filter((s) => s === WebSocket.OPEN).length;
    console.log(`METRIC ${JSON.stringify({ name: "connection_count", value: live, budget: 1, pass: live === 1 })}`);
    assert.equal(live, 1, `open sockets for one device: ${live} (${states.join(",")})`);
    b.ws.close();
  } finally { await d.stop(); space.close(); }
});

test("engine_pool: engine.acquire on the daemon's pool is under 20 ms at p95", { todo: "P-L2_23 (L2): the daemon never constructs the agent turn engine, so there is no pool to acquire from; the module level proof is agent/tests/pool.perf.test.ts" }, () => {
  assert.fail("no engine pool on the booted daemon");
});

test("send: first token is the provider's latency plus under 150 ms of ours, over a booted daemon with 200 ms fake provider latency", { todo: "P-L2_23 and P-L2_LIVE (L2): no turn engine on the daemon and the chat module has no handlers; the module level proof is agent/tests/turn-engine.perf.test.ts" }, () => {
  assert.fail("no chat turn can run on the booted daemon");
});
