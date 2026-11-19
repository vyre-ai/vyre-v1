// The database side of site operations, on a real SQLite with the real migration (r42-sites-run).
// @reads ../migrations/0010_ops.sql
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as st from "../ops/store.ts";
import type { OpsDb } from "../ops/store.ts";
import { LOG_CAPS, LogRing } from "../ops/logs.ts";
import { MINUTE } from "../ops/metrics.ts";
import { fresh, advance } from "../ops/workers.ts";

function mem(): OpsDb {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(new URL("../migrations/0010_ops.sql", import.meta.url), "utf8"));
  return {
    all: (q, ...a) => db.prepare(q).all(...(a as never[])),
    run: (q, ...a) => ({ changes: Number(db.prepare(q).run(...(a as never[])).changes) }),
  };
}
const small = { lineChars: 100, lines: 10, bytes: 1_000_000, scopes: 5 };

test("lines are stored clean, with a level, and read oldest first", () => {
  const db = mem();
  assert.equal(st.addLogs(db, "s1", "app", "app", [{ at: 1, text: "\u001b[32mhello\u001b[0m\nError: boom\n\n" }]), 2);
  const r = st.readLogs(db, "s1", {});
  assert.deepEqual(r.lines.map((l) => [l.text, l.level, l.source]), [["hello", "info", "app"], ["Error: boom", "error", "app"]]);
  assert.equal(r.lastSeq, r.lines[1]?.seq);
});

test("a site sees only its own lines", () => {
  const db = mem();
  st.addLogs(db, "s1", "app", "app", [{ at: 1, text: "mine" }]);
  st.addLogs(db, "s2", "app", "app", [{ at: 1, text: "theirs" }]);
  assert.deepEqual(st.readLogs(db, "s1").lines.map((l) => l.text), ["mine"]);
  assert.equal(st.readLogs(db, "s1", { scope: "other" }).lines.length, 0);
});

test("the store agrees with the ring on search and filters", () => {
  const db = mem();
  const ring = new LogRing({ ...LOG_CAPS, lines: 1e6, bytes: 1e12 });
  const feed: [string, "app" | "requests", number, string][] = [
    ["d1", "app", 10, "GET /health ok"],
    ["d1", "app", 20, "DB pool timeout after 30s"],
    ["d2", "app", 30, "error: db pool exhausted"],
    ["d2", "requests", 40, "GET /api 200 12ms"],
  ];
  for (const [scope, source, at, text] of feed) {
    st.addLogs(db, "s1", scope, source, [{ at, text }]);
    ring.add(source, scope, at, text);
  }
  for (const q of [{}, { q: "db pool" }, { q: "pool -exhausted" }, { source: "requests" as const }, { level: "error" as const }, { from: 15, to: 35 }, { scope: "d2" }, { q: "GET" , source: ["app" as const] }]) {
    assert.deepEqual(
      st.readLogs(db, "s1", q).lines.map((l) => l.text),
      ring.read(q).lines.map((l) => l.text),
      JSON.stringify(q),
    );
  }
});

test("a follower's cursor returns only newer lines", () => {
  const db = mem();
  st.addLogs(db, "s1", "app", "app", [{ at: 1, text: "a\nb" }]);
  const first = st.readLogs(db, "s1");
  st.addLogs(db, "s1", "app", "app", [{ at: 2, text: "c" }]);
  assert.deepEqual(st.readLogs(db, "s1", { after: first.lastSeq }).lines.map((l) => l.text), ["c"]);
});

test("the line cap keeps the newest and counts what fell off", () => {
  const db = mem();
  for (let i = 0; i < 25; i++) st.addLogs(db, "s1", "d1", "build", [{ at: i, text: `n${i}` }], small);
  const r = st.readLogs(db, "s1", { scope: "d1" });
  assert.equal(r.lines.length, 10);
  assert.equal(r.lines[0]?.text, "n15");
  assert.equal(r.dropped, 15);
});

test("the byte cap drops the oldest, and one chatty scope leaves another alone", () => {
  const db = mem();
  const caps = { ...small, lines: 1000, bytes: 100 };
  for (let i = 0; i < 50; i++) st.addLogs(db, "s1", "loud", "app", [{ at: i, text: "x".repeat(19) }], caps);
  st.addLogs(db, "s1", "quiet", "app", [{ at: 99, text: "still here" }], caps);
  assert.equal(st.readLogs(db, "s1", { scope: "loud" }).lines.length, 5);
  assert.equal(st.readLogs(db, "s1", { scope: "quiet" }).lines.length, 1);
  assert.equal(st.readLogs(db, "s1", { scope: "loud" }).dropped, 45);
});

test("the site cap removes the oldest lines of the whole site", () => {
  const db = mem();
  for (let i = 0; i < 30; i++) st.addLogs(db, "s1", i % 2 ? "a" : "b", "app", [{ at: i, text: `l${i}` }]);
  assert.equal(st.trimSite(db, "s1", 10), 20);
  const left = st.readLogs(db, "s1").lines;
  assert.equal(left.length, 10);
  assert.equal(left[0]?.text, "l20");
  assert.equal(st.trimSite(db, "s1", 10), 0);
});

test("a search reads the newest twenty thousand lines, and a plain read only what it returns", () => {
  const db = mem();
  const many: { at: number; text: string }[] = [];
  for (let i = 0; i < 300; i++) many.push({ at: i, text: i % 100 === 0 ? `needle ${i}` : `hay ${i}` });
  st.addLogs(db, "s1", "app", "app", many, { ...LOG_CAPS });
  assert.deepEqual(st.readLogs(db, "s1", { q: "needle" }).lines.map((l) => l.text), ["needle 0", "needle 100", "needle 200"]);
  assert.equal(st.readLogs(db, "s1", { limit: 5 }).lines.length, 5);
});

test("scopes list with sizes, and dropping a scope forgets its lines and its count", () => {
  const db = mem();
  for (let i = 0; i < 15; i++) st.addLogs(db, "s1", "d1", "build", [{ at: i, text: "x" }], small);
  st.addLogs(db, "s1", "svc", "app", [{ at: 99, text: "y" }], small);
  const sc = st.logScopes(db, "s1");
  assert.deepEqual(sc.map((x) => [x.scope, x.lines, x.dropped]), [["svc", 1, 0], ["d1", 10, 5]]);
  st.dropScope(db, "s1", "d1");
  assert.equal(st.readLogs(db, "s1", { scope: "d1" }).lines.length, 0);
  assert.equal(st.readLogs(db, "s1", { scope: "d1" }).dropped, 0);
});

test("the log cursor is kept per scope and survives being set twice", () => {
  const db = mem();
  assert.equal(st.getCursor(db, "s1", "svc"), undefined);
  st.setCursor(db, "s1", "svc", "2026-11-19T10:00:00.000000000Z");
  st.setCursor(db, "s1", "svc", "2026-11-19T10:00:01.000000000Z");
  assert.deepEqual(st.getCursor(db, "s1", "svc"), { ns: "2026-11-19T10:00:01.000000000Z" });
});

test("usage and requests share a minute without overwriting each other, and a day is kept", () => {
  const db = mem();
  const m = 5000 * MINUTE;
  st.putRequests(db, "s1", m + 100, { requests: 10, errors: 1, p50: 20, p95: 90 });
  st.putUsage(db, "s1", m + 200, { cpu: 12.5, memMb: 100 });
  st.putUsage(db, "s1", m + 300, { cpu: 15, memMb: 110 });
  assert.deepEqual(st.readSamples(db, "s1", m, m), [{ at: m, cpu: 15, memMb: 110, requests: 10, errors: 1, p50: 20, p95: 90 }]);
  st.putUsage(db, "s2", m, { cpu: 1, memMb: 1 });
  st.putUsage(db, "s1", m + 1500 * MINUTE, { cpu: 2, memMb: 2 });
  assert.equal(st.readSamples(db, "s1", 0, m + 2000 * MINUTE).length, 1); // the first minute is more than a day old
  assert.equal(st.readSamples(db, "s2", 0, m + 2000 * MINUTE).length, 1);
});

test("a service is saved and read back whole, and restarts keep its history", () => {
  const db = mem();
  st.insertService(db, { id: "v1", siteId: "s1", name: "queue", kind: "worker", command: ["node", "w.js"], at: 5 });
  let v = fresh("v1", "s1", "queue", "worker");
  v = advance(v, { t: "want", at: 10 }).service;
  v = advance(v, { t: "spawned", at: 10 }).service;
  v = advance(v, { t: "exited", at: 1010, code: 1 }).service;
  st.saveService(db, v, "ctr_1");
  const back = st.getService(db, "v1");
  assert.equal(back?.state, "backoff");
  assert.deepEqual(back?.crashes, [1010]);
  assert.equal(back?.lastExit?.code, 1);
  assert.equal(back?.containerId, "ctr_1");
  assert.deepEqual(back?.command, ["node", "w.js"]);
  st.saveService(db, { ...v, state: "stopped" }, null);
  assert.equal(st.getService(db, "v1")?.containerId, undefined);
  st.deleteService(db, "v1", 99);
  assert.equal(st.getService(db, "v1"), undefined);
  assert.equal(st.listServices(db, "s1").length, 0);
});

test("a run saves only from the state it was read in, so a finish and a timeout cannot both win", () => {
  const db = mem();
  const run = { id: "r1", jobId: "j1", state: "running" as const, slot: 1, by: "schedule" as const, queuedAt: 1, startedAt: 2 };
  st.insertRun(db, "s1", run);
  assert.equal(st.saveRun(db, { ...run, state: "succeeded", endedAt: 9, exitCode: 0 }, "running"), true);
  assert.equal(st.saveRun(db, { ...run, state: "timed_out", endedAt: 10 }, "running"), false);
  assert.equal(st.getRun(db, "r1")?.state, "succeeded");
  assert.equal(st.getRun(db, "r1")?.siteId, "s1");
  assert.deepEqual(st.openRuns(db), []);
  st.insertRun(db, "s1", { ...run, id: "r2", state: "queued", queuedAt: 3 });
  assert.deepEqual(st.openRuns(db, "s1").map((r) => r.id), ["r2"]);
  assert.deepEqual(st.openRuns(db, "other"), []);
  assert.deepEqual(st.listRuns(db, "j1").map((r) => r.id), ["r2", "r1"]);
  st.deleteRuns(db, ["r1"]);
  assert.deepEqual(st.listRuns(db, "j1").map((r) => r.id), ["r2"]);
});

test("a job round-trips and a deleted job is gone from lists", () => {
  const db = mem();
  const j = { id: "j1", siteId: "s1", name: "Nightly", schedule: "0 3 * * *", command: ["node", "a.js", "--x"], zone: "Asia/Karachi", enabled: true, timeoutSec: 120, lastSlot: 0 };
  st.insertJob(db, j, "usr_1", 5);
  assert.deepEqual(st.getJob(db, "j1"), j);
  st.saveJob(db, { ...j, enabled: false, lastSlot: 77 });
  assert.equal(st.getJob(db, "j1")?.enabled, false);
  assert.equal(st.getJob(db, "j1")?.lastSlot, 77);
  assert.equal(st.listJobs(db, "s1").length, 1);
  st.deleteJob(db, "j1", 9);
  assert.equal(st.getJob(db, "j1"), undefined);
  assert.equal(st.listJobs(db).length, 0);
});

test("a backup moves only from the state it was read in, and pinning is kept", () => {
  const db = mem();
  const b = { id: "b1", siteId: "s1", kind: "postgres" as const, state: "queued" as const, by: "person" as const, at: 5 };
  st.insertBackup(db, b);
  assert.equal(st.saveBackup(db, { ...b, state: "running" }, "queued"), true);
  assert.equal(st.saveBackup(db, { ...b, state: "running" }, "queued"), false);
  assert.equal(st.saveBackup(db, { ...b, state: "ready", endedAt: 8, bytes: 1234, fileId: "fil_1" }, "running"), true);
  st.setPinned(db, "b1", true);
  assert.deepEqual(st.getBackup(db, "b1"), { ...b, state: "ready", endedAt: 8, bytes: 1234, fileId: "fil_1", pinned: true });
  assert.equal(st.listBackups(db, "s1").length, 1);
  st.deleteBackups(db, ["b1"]);
  assert.equal(st.listBackups(db).length, 0);
});

test("deleting a site's operations removes every table's rows for it and no one else's", () => {
  const db = mem();
  st.addLogs(db, "s1", "app", "app", [{ at: 1, text: "x" }]);
  st.addLogs(db, "s2", "app", "app", [{ at: 1, text: "y" }]);
  st.putUsage(db, "s1", 1, { cpu: 1, memMb: 1 });
  st.insertBackup(db, { id: "b1", siteId: "s1", kind: "postgres", state: "queued", by: "person", at: 1 });
  st.dropSiteOps(db, "s1");
  assert.equal(st.readLogs(db, "s1").lines.length, 0);
  assert.equal(st.readLogs(db, "s2").lines.length, 1);
  assert.equal(st.listBackups(db, "s1").length, 0);
  assert.equal(st.readSamples(db, "s1", 0, 1e12).length, 0);
});
