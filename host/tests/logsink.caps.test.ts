// logs.db stays small and quiet: routine successes are counted, not stored per run, and the file keeps a week and a size cap while the daemon runs, giving the space back to the disk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LogSink, LOGS_SCHEMA, ROLLUP_MS, SLOW_MS, invokeLogs, jobRanLog } from "../src/logsink/index.ts";

const T0 = 1_800_000_000_000;
const DAY = 86_400_000;
const tmp = (): string => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-logcaps-")), "logs.db");
type Row = { msg: string; level: number; result: string | null; dur_ms: number | null; actor: string | null; cap: string | null; attrs: string | null };
const rows = (sink: LogSink): Row[] => { sink.flush(); return sink.db.prepare("SELECT msg, level, result, dur_ms, actor, cap, attrs FROM logs ORDER BY id").all() as unknown as Row[]; };
const n = (sink: LogSink, sql: string): number => Number(sink.db.prepare(sql).get()?.["n"]);

test("a routine job run is counted, and its window ends in one job.ran row with the count, the total time and the slowest", () => {
  let now = T0;
  const sink = new LogSink({ batchMs: 0, now: () => now });
  const ran = jobRanLog(sink, () => "spc_test");
  ran({ job: "commands.poll", ok: true, ms: 2 });                 // the first run of a job is a row
  for (let i = 0; i < 3599; i++) { now += 1000; ran({ job: "commands.poll", ok: true, ms: i === 7 ? 9 : 1 }); }
  assert.deepEqual(rows(sink).map((r) => [r.msg, r.level, r.result]), [["job.ran", 10, "ok"]], "an hour of polls wrote nothing past the first");
  now += 2000; ran({ job: "commands.poll", ok: true, ms: 1 });   // the window is over: this run starts the next one
  const all = rows(sink);
  assert.equal(all.length, 2);
  assert.equal(all[1]!.msg, "job.ran");
  assert.equal(all[1]!.level, 10);
  assert.equal(all[1]!.dur_ms, 9, "dur_ms is the slowest run of the window");
  assert.deepEqual(JSON.parse(all[1]!.attrs!), { count: 3599, ms: 3598 + 9 });
  sink.close();
});

test("a failure, a recovery and a slow run are rows of their own; a failure that repeats the last one is counted", () => {
  let now = T0;
  const sink = new LogSink({ batchMs: 0, now: () => now });
  const ran = jobRanLog(sink, () => "spc_test");
  const tick = (r: Parameters<typeof ran>[0]): void => { now += 1000; ran(r); };
  tick({ job: "hooks.pump", ok: true, ms: 3 });
  tick({ job: "hooks.pump", ok: true, ms: 3 });
  tick({ job: "hooks.pump", ok: false, ms: 4, error: "disk full" });
  tick({ job: "hooks.pump", ok: false, ms: 4, error: "disk full" });
  tick({ job: "hooks.pump", ok: false, ms: 4, error: "disk full" });
  tick({ job: "hooks.pump", ok: false, ms: 4, error: "locked" });
  tick({ job: "hooks.pump", ok: true, ms: 3 });
  tick({ job: "hooks.pump", ok: true, ms: SLOW_MS + 5 });
  assert.deepEqual(rows(sink).map((r) => [r.level, r.result, r.attrs]), [
    [10, "ok", null],
    [40, "error", '{"error":"disk full"}'],
    [40, "error", '{"error":"locked"}'],
    [20, "ok", null],
    [20, "ok", '{"slow":true}'],
  ]);
  sink.close();
});

test("close writes what every open window has counted, so a restart loses no count", () => {
  const file = tmp();
  let now = T0;
  const sink = new LogSink({ path: file, batchMs: 0, now: () => now });
  const ran = jobRanLog(sink, () => "spc_test");
  for (let i = 0; i < 5; i++) { now += 1000; ran({ job: "schedule.tick", ok: true, ms: 1 }); }
  for (let i = 0; i < 3; i++) { now += 1000; ran({ job: "schedule.tick", ok: false, ms: 1, error: "x" }); }
  sink.close();
  const db = new DatabaseSync(file, { readOnly: true });
  const got = db.prepare("SELECT level, result, attrs FROM logs ORDER BY id").all().map((r) => [r["level"], r["result"], r["attrs"] ? JSON.parse(String(r["attrs"])).count ?? null : null]);
  db.close();
  assert.deepEqual(got, [[10, "ok", null], [40, "error", null], [10, "ok", 4], [40, "error", 2]]);
});

test("a fast read keeps its first span per capability and caller each window, so its trace opens; writes, failures and slow reads keep every span", () => {
  let now = T0;
  const sink = new LogSink({ batchMs: 0, now: () => now });
  const { onSpan: span } = invokeLogs(sink, "spc_test", { routine: (cap) => cap.endsWith(".get"), read: (cap) => cap.endsWith(".get") });
  let i = 0;
  const call = (cap: string, o: { status?: "ok" | "error"; ms?: number; principal?: string } = {}): string => {
    const traceId = (++i).toString(16).padStart(32, "0");
    now += 100;
    span({ traceId, spanId: "1".repeat(16), name: "invoke", cap, startedAt: now, ms: o.ms ?? 2, status: o.status ?? "ok", principal: o.principal ?? "usr_a" });
    return traceId;
  };
  const first = call("spaces.get");
  const second = call("spaces.get");
  const other = call("spaces.get", { principal: "usr_b" });
  const write = call("notes.create");
  const failed = call("spaces.get", { status: "error" });
  const slow = call("spaces.get", { ms: SLOW_MS });
  for (let k = 0; k < 10; k++) call("spaces.get");
  assert.equal(sink.trace(first).spans.length, 1, "the first read of the window opens");
  assert.equal(sink.trace(second).spans.length, 0, "a repeat is counted");
  for (const t of [other, write, failed, slow]) assert.equal(sink.trace(t).spans.length, 1, t);
  assert.equal(n(sink, "SELECT COUNT(*) AS n FROM spans"), 5);
  now += ROLLUP_MS;
  call("spaces.get");
  const rolled = rows(sink).filter((r) => r.msg === "invoke.reads");
  assert.equal(rolled.length, 1, "one row for usr_a's reads; usr_b read once, which is its kept span");
  assert.equal(rolled[0]!.cap, "spaces.get");
  assert.equal(rolled[0]!.actor, "usr_a");
  assert.equal(JSON.parse(rolled[0]!.attrs!).count, 11);
  assert.equal(n(sink, "SELECT COUNT(*) AS n FROM spans"), 6, "the first read of the new window is kept");
  sink.close();
});

test("a new logs.db is WAL with synchronous NORMAL and incremental vacuum", () => {
  const file = tmp();
  const sink = new LogSink({ path: file });
  assert.equal(sink.db.prepare("PRAGMA journal_mode").get()?.["journal_mode"], "wal");
  assert.equal(sink.db.prepare("PRAGMA synchronous").get()?.["synchronous"], 1);
  assert.equal(sink.db.prepare("PRAGMA auto_vacuum").get()?.["auto_vacuum"], 2);
  sink.close();
});

test("rows past the age cap are pruned while the sink runs, in small batches; tombstones and the id sequence survive", () => {
  const file = tmp();
  let now = T0;
  const sink = new LogSink({ path: file, batchMs: 0, now: () => now, keepMs: 7 * DAY });
  sink.log({ space: "-", level: 20, msg: "old", actor: "usr_gone" });
  sink.span({ trace_id: "a".repeat(32), span_id: "a".repeat(16), parent: null, name: "invoke", at: now, dur_us: 1, attrs: null });
  sink.erase("usr_gone");
  for (let i = 0; i < 4500; i++) sink.log({ space: "-", level: 20, msg: "old.bulk" });
  now += 3 * DAY;
  sink.log({ space: "-", level: 20, msg: "young" });
  now += 5 * DAY;                                 // the first rows are now eight days old
  sink.log({ space: "-", level: 20, msg: "after" });
  const left = (sink.db.prepare("SELECT msg FROM logs ORDER BY id").all() as { msg: string }[]).map((r) => r.msg);
  assert.deepEqual(left, ["young", "after"], "a flush a minute after the last prune pruned every old row");
  assert.equal(n(sink, "SELECT COUNT(*) AS n FROM spans"), 0);
  assert.equal(n(sink, "SELECT COUNT(*) AS n FROM log_tombstones"), 1, "an erased person stays erased");
  const lastId = n(sink, "SELECT MAX(id) AS n FROM logs");
  now += 8 * DAY;
  sink.log({ space: "-", level: 20, msg: "later" });
  assert.deepEqual((sink.db.prepare("SELECT id, msg FROM logs").all() as { id: number; msg: string }[]).map((r) => [r.id, r.msg]), [[lastId + 1, "later"]], "ids go on from the last one, never reused");
  sink.close();
  const again = new LogSink({ path: file, batchMs: 0, now: () => now });
  again.log({ space: "-", level: 20, msg: "reopened" });
  again.flush();
  assert.equal(n(again, "SELECT MAX(id) AS n FROM logs"), lastId + 2, "and after a restart too");
  again.close();
});

test("a file over the size cap loses its oldest rows until it takes three quarters of the cap, and the file shrinks", () => {
  const file = tmp();
  let now = T0;
  const maxBytes = 512 * 1024;
  const sink = new LogSink({ path: file, batchMs: 60_000, now: () => now, maxBytes });
  const pad = "x".repeat(400);
  for (let i = 0; i < 6000; i++) { sink.log({ space: "-", level: 20, msg: "fill", attrs: { i, pad } }); if (i % 500 === 0) sink.span({ trace_id: i.toString(16).padStart(32, "0"), span_id: "b".repeat(16), parent: null, name: "invoke", at: now, dur_us: 1, attrs: null }); now += 5; }
  sink.drain();
  sink.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const before = fs.statSync(file).size;
  assert.ok(before > 2 * maxBytes, `filled past the cap: ${before}`);
  now += 61_000;
  sink.log({ space: "-", level: 20, msg: "newest" });
  sink.flush();
  sink.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  for (let i = 0; i < 20 && fs.statSync(file).size > maxBytes; i++) { now += 61_000; sink.log({ space: "-", level: 20, msg: "newest" }); sink.flush(); sink.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); }
  const size = fs.statSync(file).size;
  assert.ok(size <= maxBytes, `the file shrank under the cap: ${before} -> ${size}`);
  const kept = sink.db.prepare("SELECT MIN(json_extract(attrs, '$.i')) AS lo, MAX(json_extract(attrs, '$.i')) AS hi FROM logs WHERE msg = 'fill'").get()!;
  assert.equal(kept["hi"], 5999, "the newest rows stay");
  assert.ok(Number(kept["lo"]) > 0, "the oldest went");
  assert.ok((sink.db.prepare("SELECT msg FROM logs").all() as { msg: string }[]).some((r) => r.msg === "newest"));
  sink.close();
});

test("a logs.db from before the caps is pruned and vacuumed once at open, and takes incremental vacuum", () => {
  const file = tmp();
  const old = new DatabaseSync(file);
  old.exec(LOGS_SCHEMA);
  const ins = old.prepare("INSERT INTO logs (id, at, level, space, msg) VALUES (?, ?, 20, '-', ?)");
  old.exec("BEGIN");
  for (let i = 1; i <= 3000; i++) ins.run(i, T0 - 30 * DAY + i, "ancient");
  ins.run(3001, T0, "recent");
  old.exec("COMMIT");
  assert.equal(old.prepare("PRAGMA auto_vacuum").get()?.["auto_vacuum"], 0);
  old.close();
  const sink = new LogSink({ path: file, batchMs: 0, now: () => T0 });
  assert.equal(sink.db.prepare("PRAGMA auto_vacuum").get()?.["auto_vacuum"], 2);
  assert.equal(sink.db.prepare("PRAGMA journal_mode").get()?.["journal_mode"], "wal");
  assert.deepEqual((sink.db.prepare("SELECT msg FROM logs").all() as { msg: string }[]).map((r) => r.msg), ["recent"]);
  assert.equal(n(sink, "SELECT freelist_count AS n FROM pragma_freelist_count"), 0, "the vacuum gave the pruned pages back");
  sink.log({ space: "-", level: 20, msg: "next" });
  sink.flush();
  assert.equal(n(sink, "SELECT MAX(id) AS n FROM logs"), 3002, "the sequence carries on past the pruned rows");
  sink.close();
});

test("a read that keeps failing the same way is one row per window: the first failure and a new error keep their span and rows, repeats are counted, and the recovery is a row", () => {
  let now = T0;
  const sink = new LogSink({ batchMs: 0, now: () => now });
  const logs = invokeLogs(sink, "spc_test", { routine: (cap) => cap.endsWith(".get") || cap.startsWith("host.hook."), read: (cap) => cap.endsWith(".get") });
  let i = 0;
  // what the pipeline does on a failure: the span, then the rows
  const call = (cap: string, o: { status?: "ok" | "error" | "denied"; code?: string; ms?: number; unexpected?: boolean } = {}): string => {
    const traceId = (++i).toString(16).padStart(32, "0");
    now += 1000;
    const status = o.status ?? "ok";
    logs.onSpan({ traceId, spanId: "2".repeat(16), name: "invoke", cap, startedAt: now, ms: o.ms ?? 2, status, ...(o.code ? { code: o.code } : {}), principal: "usr_a" });
    if (status !== "ok") {
      if (o.unexpected) logs.log.error("handler threw", { cap, traceId, stack: "at x" });
      logs.log.info("invoke", { cap, traceId, status: o.code });
    }
    return traceId;
  };
  const first = call("settings.get", { status: "error", code: "validation.bad_input" });
  const repeats = [1, 2, 3].map(() => call("settings.get", { status: "error", code: "validation.bad_input" }));
  const changed = call("settings.get", { status: "error", code: "internal.unexpected", unexpected: true });
  const again = call("settings.get", { status: "error", code: "internal.unexpected", unexpected: true });
  const slow = call("settings.get", { status: "error", code: "internal.unexpected", ms: SLOW_MS });
  const refused = [1, 2].map(() => call("settings.get", { status: "denied", code: "permission.no_grant" }));
  const writes = [1, 2].map(() => call("notes.create", { status: "error", code: "validation.bad_input" }));
  const hook = [1, 2].map(() => call("host.hook.periodic.x", { status: "error", code: "internal.unexpected" }));
  const recovered = call("settings.get");
  for (const t of [first, changed, slow, ...refused, ...writes, ...hook, recovered]) assert.equal(sink.trace(t).spans.length, 1, `kept: ${t}`);
  for (const t of [...repeats, again]) assert.deepEqual(sink.trace(t), { logs: [], spans: [] }, `counted: ${t}`);
  assert.deepEqual(sink.trace(changed).logs.map((l) => l.msg), ["handler threw", "invoke"], "a new error keeps its rows");
  assert.deepEqual(sink.trace(recovered).logs.map((l) => [l.msg, l.level]), [["invoke.recovered", 20]]);
  sink.close();
});

test("the counted failures of a window close as one invoke row with the error code and the count", () => {
  const file = tmp();
  let now = T0;
  const sink = new LogSink({ path: file, batchMs: 0, now: () => now });
  const logs = invokeLogs(sink, "spc_test", { routine: () => true, read: () => true });
  for (let k = 0; k < 5; k++) {
    now += 1000;
    const traceId = k.toString(16).padStart(32, "0");
    logs.onSpan({ traceId, spanId: "3".repeat(16), name: "invoke", cap: "settings.get", startedAt: now, ms: 2, status: "error", code: "validation.bad_input", principal: "usr_a" });
    logs.log.info("invoke", { cap: "settings.get", traceId, status: "validation.bad_input" });
  }
  sink.close();
  const db = new DatabaseSync(file, { readOnly: true });
  const got = db.prepare("SELECT msg, level, cap, actor, result, attrs FROM logs ORDER BY id").all().map((r) => [r["msg"], r["level"], r["cap"], r["actor"], r["result"], r["attrs"] ? JSON.parse(String(r["attrs"])).count ?? null : null]);
  db.close();
  assert.deepEqual(got, [["invoke", 20, "settings.get", null, "validation.bad_input", null], ["invoke", 20, "settings.get", "usr_a", "validation.bad_input", 4]], "the first failure as the pipeline logged it (its result in the result column), then the four repeats on one row");
});
