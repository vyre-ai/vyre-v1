// The sink: what a row may hold, batching, failure handling, settings, holds and retention (spec 4.18, ARCH 4.10, 4.11).
// no-content-in-logs: sealed and Restricted values never logged (log lint input).
// @reads ../migrations/0001_init.sql
// @reads ../fixtures/lines.jsonl

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeLogsDb, NOW, SPACE } from "../fixtures/db.ts";
import type { Row } from "../fixtures/db.ts";
import {
  CONTENT_KEYS, DAY_MS, DEFAULT_AGGREGATE_DAYS, DEFAULT_FULL_DAYS, LogWriter, MAX_QUEUE, cleanMsg, eraseActor, erasedActors, holdActive,
  levelName, levelNumber, placeHold, readSettings, releaseHold, runRetention, scrubAttrs, writeSettings,
} from "../handlers/sink.ts";
import { foldEvent, entityOf } from "../projections.ts";
import { seed } from "../fixtures/seed.ts";

const LINES = readFileSync(new URL("../fixtures/lines.jsonl", import.meta.url), "utf8").split("\n").filter((l) => l.length > 0);
const SECRET = "sk_live_abcdef123456";

function writer(db: FakeLogsDb, o: { secrets?: string[]; minLevel?: "debug" | "info" | "warn" | "error"; now?: () => number; batchMs?: number } = {}): LogWriter {
  return new LogWriter({
    db, space: SPACE, now: o.now ?? (() => NOW), batchMs: o.batchMs ?? 0, minLevel: o.minLevel ?? "debug",
    ...(o.secrets ? { secrets: () => o.secrets! } : {}),
  });
}

function everyCell(db: FakeLogsDb): string[] {
  const out: string[] = [];
  for (const t of ["logs_row", "logs_span", "logs_event"]) for (const r of db.rows(t)) for (const v of Object.values(r)) if (typeof v === "string") out.push(v);
  return out;
}

test("no-content-in-logs: sealed and Restricted values never logged (log lint input)", () => {
  const db = new FakeLogsDb();
  const w = writer(db);
  const accepted = LINES.map((l) => w.acceptLine(l));
  assert.deepEqual(accepted, [true, true, true, true, true, true, false], "six lines are rows, spans or events; the last is not JSON");

  const rows = db.rows("logs_row");
  assert.equal(rows.length, 3);
  const mail = JSON.parse(String(rows[1]!["attrs"])) as Record<string, unknown>;
  assert.deepEqual(mail, { count: 2, nested: { id: "rec_1" }, list: [{}, { n: 3 }] }, "content keys are dropped at every depth, counts and ids stay");
  const vault = JSON.parse(String(rows[2]!["attrs"])) as Record<string, unknown>;
  assert.deepEqual(vault, { n: 1 }, "a sealed card and a Restricted field never reach attrs");

  const all = everyCell(db).join("\n");
  for (const leaked of ["settlement", "private", "Re: case", "c2VhbGVk"]) assert.ok(!all.includes(leaked), `${leaked} must not be stored`);
  for (const key of CONTENT_KEYS) {
    for (const r of rows) assert.ok(!new RegExp(`"${key}"\\s*:`, "i").test(String(r["attrs"] ?? "")), `attrs holds no ${key} key`);
  }
});

test("a Restricted row keeps no attrs at all", () => {
  const db = new FakeLogsDb();
  const w = writer(db);
  assert.ok(w.write({ msg: "record.read", label: "restricted", attrs: { count: 1 } }));
  assert.ok(w.write({ msg: "record.read", label: 3, attrs: { count: 1 } }));
  assert.ok(w.write({ msg: "record.read", label: "internal", attrs: { count: 1 } }));
  const attrs = db.rows("logs_row").map((r) => r["attrs"]);
  assert.deepEqual(attrs, [null, null, "{\"count\":1}"]);
  assert.deepEqual(db.rows("logs_row").map((r) => r["label"]), [3, 3, 1]);
});

test("known secrets never reach a row, span or event", () => {
  const db = new FakeLogsDb();
  const w = writer(db, { secrets: [SECRET, "abc"] });
  w.write({ msg: "vault.used", actor: SECRET, cap: `x.${SECRET}`, attrs: { ref: SECRET, note: `before ${SECRET} after`, nested: [SECRET, "fine"], short: "abc", shortInside: "zabcz" } });
  w.write({ msg: SECRET });
  w.span({ traceId: "0123456789abcdef0123456789abcdef", spanId: "1111111111111111", name: `s.${SECRET}` });
  w.span({ traceId: "0123456789abcdef0123456789abcdef", spanId: "2222222222222222", name: "s.ok", attrs: { ref: SECRET } });
  w.event({ traceId: "0123456789abcdef0123456789abcdef", seq: 1, type: "record.updated", actor: SECRET });
  assert.ok(!everyCell(db).some((c) => c.includes(SECRET)), "the secret appears in no stored cell");
  const rows = db.rows("logs_row");
  assert.equal(rows[0]!["actor"], null);
  assert.equal(rows[0]!["cap"], null);
  assert.deepEqual(JSON.parse(String(rows[0]!["attrs"])), { ref: "[redacted]", note: "[redacted]", nested: ["[redacted]", "fine"], short: "[redacted]", shortInside: "zabcz" }, "short secrets match whole strings only");
  assert.equal(rows[1]!["msg"], "log.redacted");
  assert.equal(db.rows("logs_span").length, 1, "a span named after the secret is refused");
  assert.equal(db.rows("logs_event").length, 0, "an event by an actor that is a secret is refused");
});

test("msg is a template key; anything else becomes log.redacted", () => {
  assert.equal(cleanMsg("record.updated", []), "record.updated");
  assert.equal(cleanMsg("Dear client, the settlement", []), "log.redacted");
  assert.equal(cleanMsg("Record.Updated", []), "log.redacted");
  assert.equal(cleanMsg("", []), "log.redacted");
  assert.equal(cleanMsg(42, []), "log.redacted");
  assert.equal(cleanMsg(undefined, []), "log.redacted");
  assert.equal(cleanMsg("a".repeat(200), []), "log.redacted");
});

test("scrubAttrs: size cap, depth cap, non-finite numbers and empty results", () => {
  assert.equal(scrubAttrs(undefined, []), null);
  assert.equal(scrubAttrs({}, []), null);
  assert.equal(scrubAttrs({ body: "x" }, []), null, "only content keys leaves nothing");
  assert.equal(scrubAttrs("text", []), null);
  assert.equal(scrubAttrs([1, 2], []), null);
  assert.deepEqual(scrubAttrs({ n: Number.NaN, m: 2 }, []), { m: 2 });
  assert.deepEqual(scrubAttrs({ big: "x".repeat(9000) }, []), { dropped: "size" });
  const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
  assert.ok(!JSON.stringify(scrubAttrs({ ...deep, ok: 1 }, [])).includes("\"g\""), "past six levels is dropped");
  assert.deepEqual(scrubAttrs({ Body: "x", TEXT: "y", id: "rec_1" }, []), { id: "rec_1" }, "key match ignores case");
});

test("rows keep ids, times and counts in their columns", () => {
  const db = new FakeLogsDb();
  const w = writer(db);
  w.acceptLine(LINES[0]!);
  const r = db.rows("logs_row")[0]!;
  const want: Row = {
    id: 1, at: 1760000000000, level: 20, trace_id: "0123456789abcdef0123456789abcdef", span_id: "abcdef0123456789", space: SPACE,
    actor: "usr_owner", on_behalf: "usr_ana", run_id: null, thread_id: null, device: null, place: null, cap: "records.update", entity: "record",
    entity_id: "rec_seed", result: "ok", dur_ms: 4, cost_micros: 0, tokens_in: null, tokens_out: null, label: 1, app_version: "1.0.0",
    server_version: "1.0.0", machine: null, msg: "record.updated", attrs: "{\"count\":1}",
  };
  assert.deepEqual(r, want);
});

test("bad ids are dropped, not stored: trace ids are 32 hex, span ids 16 hex", () => {
  const db = new FakeLogsDb();
  const w = writer(db);
  w.write({ msg: "a.b", traceId: "not-a-trace", spanId: "zz", actor: "has space", cap: "x\ny" });
  const r = db.rows("logs_row")[0]!;
  assert.equal(r["trace_id"], null);
  assert.equal(r["span_id"], null);
  assert.equal(r["actor"], null);
  assert.equal(r["cap"], null);
  assert.equal(w.span({ traceId: "short", spanId: "1111111111111111", name: "a" }), false);
  assert.equal(w.span({ traceId: "0123456789abcdef0123456789abcdef", spanId: "1111111111111111", name: "has space" }), false);
  assert.equal(w.event({ traceId: "0123456789abcdef0123456789abcdef", seq: 0, type: "a.b", actor: "usr_x" }), false);
  assert.equal(w.event({ traceId: "0123456789abcdef0123456789abcdef", type: "a.b", actor: "usr_x" }), false);
});

test("a future timestamp is clamped to now; level names and numbers map both ways", () => {
  const db = new FakeLogsDb();
  const w = writer(db);
  w.write({ msg: "a.b", at: NOW + 10 * DAY_MS });
  assert.equal(db.rows("logs_row")[0]!["at"], NOW);
  assert.equal(levelNumber("warn"), 30);
  assert.equal(levelNumber(40), 40);
  assert.equal(levelNumber("loud"), 20);
  assert.equal(levelName(10), "debug");
  assert.equal(levelName(20), "info");
  assert.equal(levelName(35), "warn");
  assert.equal(levelName(99), "error");
});

test("the Space level drops rows below it, and keeps errors", () => {
  const db = new FakeLogsDb();
  const w = writer(db, { minLevel: "warn" });
  assert.equal(w.write({ msg: "a.b", level: "debug" }), false);
  assert.equal(w.write({ msg: "a.b", level: "info" }), false);
  assert.equal(w.write({ msg: "a.b", level: "warn" }), true);
  assert.equal(w.write({ msg: "a.b", level: "error" }), true);
  w.setMinLevel("debug");
  assert.equal(w.write({ msg: "a.b", level: "debug" }), true);
  assert.deepEqual(db.rows("logs_row").map((r) => r["level"]), [30, 40, 10]);
  assert.equal(w.write("not an object"), false);
  assert.equal(w.write(null), false);
});

test("batching holds rows until flush and writes them in order", () => {
  const db = new FakeLogsDb();
  const w = writer(db, { batchMs: 60_000 });
  w.write({ msg: "a.one" });
  w.write({ msg: "a.two" });
  w.span({ traceId: "0123456789abcdef0123456789abcdef", spanId: "1111111111111111", name: "s.one" });
  w.event({ traceId: "0123456789abcdef0123456789abcdef", seq: 7, type: "a.b", actor: "usr_x" });
  assert.equal(w.pending(), 4);
  assert.equal(db.rows("logs_row").length, 0, "nothing is written inside the batch window");
  w.flush();
  assert.equal(w.pending(), 0);
  assert.deepEqual(db.rows("logs_row").map((r) => r["msg"]), ["a.one", "a.two"]);
  assert.equal(db.rows("logs_span").length, 1);
  assert.equal(db.rows("logs_event").length, 1);
  w.flush();
  assert.equal(db.rows("logs_row").length, 2, "an empty flush writes nothing");
});

test("a failing insert keeps the rest queued and a later flush writes each row once", () => {
  const db = new FakeLogsDb();
  let fail = true;
  const flaky = {
    all: (sql: string, ...a: unknown[]) => db.all(sql, ...a),
    run: (sql: string, ...a: unknown[]) => {
      if (fail && a.includes("a.two")) throw new Error("disk full");
      return db.run(sql, ...a);
    },
  };
  const w = new LogWriter({ db: flaky, space: SPACE, now: () => NOW, batchMs: 60_000, minLevel: "debug" });
  for (const m of ["a.one", "a.two", "a.three"]) w.write({ msg: m });
  assert.throws(() => w.flush(), /disk full/);
  assert.deepEqual(db.rows("logs_row").map((r) => r["msg"]), ["a.one"]);
  assert.equal(w.pending(), 2, "the failed row and the one after it wait");
  fail = false;
  w.flush();
  assert.deepEqual(db.rows("logs_row").map((r) => r["msg"]), ["a.one", "a.two", "a.three"]);
});

test("the queue is bounded: the oldest rows are dropped and counted", () => {
  const db = new FakeLogsDb();
  const w = writer(db, { batchMs: 60_000 });
  for (let i = 0; i < MAX_QUEUE + 5; i++) w.write({ msg: "a.b", attrs: { n: i } });
  assert.equal(w.pending(), MAX_QUEUE);
  assert.equal(w.dropped, 5);
  w.flush();
  const first = db.rows("logs_row")[0]!;
  assert.equal(JSON.parse(String(first["attrs"])).n, 5, "rows 0 to 4 were the ones dropped");
});

test("acceptLine routes spans, events and rows, and refuses what it cannot read", () => {
  const db = new FakeLogsDb();
  const w = writer(db);
  assert.equal(w.acceptLine("{"), false);
  assert.equal(w.acceptLine("[1,2]"), false);
  assert.equal(w.acceptLine("\"text\""), false);
  assert.equal(w.acceptLine("{\"kind\":\"span\",\"name\":\"x\"}"), false, "a span without ids");
  assert.equal(w.acceptLine("{\"kind\":\"event\",\"type\":\"a.b\"}"), false, "an event without trace, seq and actor");
  assert.equal(w.acceptLine(LINES[3]!), true);
  assert.equal(w.acceptLine(LINES[5]!), true);
  assert.equal(w.acceptLine(LINES[0]!), true);
  assert.equal(db.rows("logs_span").length, 1);
  assert.equal(db.rows("logs_event").length, 1);
  assert.equal(db.rows("logs_row").length, 1);
  assert.equal(db.rows("logs_span")[0]!["dur_us"], 3200);
  assert.equal(db.rows("logs_event")[0]!["entity"], "record/rec_seed");
});

test("a span written twice keeps one row (the last write)", () => {
  const db = new FakeLogsDb();
  const w = writer(db);
  const s = { traceId: "0123456789abcdef0123456789abcdef", spanId: "1111111111111111", name: "s.one" };
  w.span({ ...s, durUs: 5 });
  w.span({ ...s, durUs: 9 });
  assert.deepEqual(db.rows("logs_span").map((r) => r["dur_us"]), [9]);
});

test("the event consumer folds any event type into logs_event and replays without duplicates", () => {
  const db = new FakeLogsDb();
  const tx = { run: (sql: string, ...a: unknown[]) => ({ ...db.run(sql, ...a), lastInsertRowid: 0 }), get: () => undefined, all: () => [], exec: () => undefined };
  const ev = (seq: number, type: string, entity?: string, entity_id?: string) => ({
    seq, id: `evt_${seq}`, type, sv: 1, hlc: "h", at: NOW + seq, trace_id: "0123456789abcdef0123456789abcdef", actor: "usr_owner", depth: 0,
    label: 0, vis: "space" as const, enc: 0, commit: "c", prev: "p", hash: "h", payload: new Uint8Array(),
    ...(entity ? { entity } : {}), ...(entity_id ? { entity_id } : {}),
  });
  foldEvent(tx, ev(1, "record.updated", "record", "rec_1"));
  foldEvent(tx, ev(2, "message.sent", "channel"));
  foldEvent(tx, ev(3, "anything.at.all"));
  foldEvent(tx, ev(1, "record.updated", "record", "rec_1"));
  const rows = db.rows("logs_event");
  assert.deepEqual(rows.map((r) => [r["seq"], r["type"], r["entity"]]), [[1, "record.updated", "record/rec_1"], [2, "message.sent", "channel"], [3, "anything.at.all", null]]);
  assert.equal(entityOf({}), null);
});

test("settings default to 30 days full and 180 days of summaries, and round-trip", () => {
  const db = new FakeLogsDb();
  assert.deepEqual(readSettings(db, SPACE), { level: "info", fullDays: DEFAULT_FULL_DAYS, aggregateDays: DEFAULT_AGGREGATE_DAYS });
  assert.equal(DEFAULT_FULL_DAYS, 30);
  assert.equal(DEFAULT_AGGREGATE_DAYS, 180);
  writeSettings(db, SPACE, { level: "warn", fullDays: 7, aggregateDays: 90 });
  assert.deepEqual(readSettings(db, SPACE), { level: "warn", fullDays: 7, aggregateDays: 90 });
  writeSettings(db, SPACE, { level: "debug", fullDays: 8, aggregateDays: 91 });
  assert.equal(db.rows("logs_settings").length, 1, "one row per Space");
  assert.deepEqual(readSettings(db, "spc_other"), { level: "info", fullDays: 30, aggregateDays: 180 });
});

function seedAged(db: FakeLogsDb): void {
  // three rows 40 days old (two the same capability and result), one 10 days old, one 200 days old
  const mk = (ageDays: number, cap: string, result: string, cost: number, dur: number) => {
    const w = writer(db, { now: () => NOW - ageDays * DAY_MS });
    w.write({ msg: "a.b", cap, result, costMicros: cost, durMs: dur });
    w.span({ traceId: "0123456789abcdef0123456789abcdef", spanId: String(ageDays).padStart(16, "0"), name: "s.x" });
    w.event({ traceId: "0123456789abcdef0123456789abcdef", seq: ageDays + 1, type: "a.b", actor: "usr_x" });
  };
  mk(40, "records.update", "ok", 5, 10);
  mk(40, "records.update", "ok", 7, 20);
  mk(40, "records.update", "validation.bad_input", 0, 3);
  mk(10, "records.update", "ok", 1, 1);
  mk(200, "records.update", "ok", 2, 2);
}

test("retention folds rows older than fullDays into one summary per day, level, capability and result", () => {
  const db = new FakeLogsDb();
  seedAged(db);
  assert.equal(db.rows("logs_row").length, 5);
  const r = runRetention(db, SPACE, NOW);
  assert.deepEqual(r, { held: false, folded: 4, deleted: 4 });
  assert.equal(db.rows("logs_row").length, 1, "only the 10 day old row stays");
  const aggs = db.rows("logs_aggregate");
  assert.equal(aggs.length, 2, "the 200 day old summary is past 180 days and is gone");
  const ok = aggs.find((a) => a["result"] === "ok")!;
  assert.deepEqual([ok["n_rows"], ok["cost_micros"], ok["dur_ms"], ok["cap"], ok["level"]], [2, 12, 30, "records.update", 20]);
  const bad = aggs.find((a) => a["result"] === "validation.bad_input")!;
  assert.equal(bad["n_rows"], 1);
  assert.equal(Number(ok["day"]) % DAY_MS, 0, "summaries are per day");
  assert.equal(db.rows("logs_span").length, 1, "spans and events follow the full window");
  assert.equal(db.rows("logs_event").length, 1);
});

test("retention twice leaves the same state; a later run adds new old rows to the same summary", () => {
  const db = new FakeLogsDb();
  seedAged(db);
  runRetention(db, SPACE, NOW);
  const before = JSON.stringify(db.rows("logs_aggregate"));
  assert.deepEqual(runRetention(db, SPACE, NOW), { held: false, folded: 0, deleted: 0 });
  assert.equal(JSON.stringify(db.rows("logs_aggregate")), before);
  writer(db, { now: () => NOW - 40 * DAY_MS }).write({ msg: "a.b", cap: "records.update", result: "ok", costMicros: 100, durMs: 5 });
  runRetention(db, SPACE, NOW);
  const ok = db.rows("logs_aggregate").find((a) => a["result"] === "ok")!;
  assert.deepEqual([ok["n_rows"], ok["cost_micros"]], [3, 112], "the late row added to the existing day");
});

test("retention folds more than one batch of rows", () => {
  const db = new FakeLogsDb();
  const w = writer(db, { now: () => NOW - 60 * DAY_MS, batchMs: 60_000 });
  for (let i = 0; i < 2_500; i++) w.write({ msg: "a.b", cap: "x.y", result: "ok", costMicros: 1 });
  w.flush();
  const r = runRetention(db, SPACE, NOW);
  assert.equal(r.folded, 2_500);
  assert.equal(db.rows("logs_row").length, 0);
  assert.deepEqual(db.rows("logs_aggregate").map((a) => [a["n_rows"], a["cost_micros"]]), [[2_500, 2_500]]);
});

test("a hold blocks expiry until it is released or its end date passes", () => {
  const db = new FakeLogsDb();
  seedAged(db);
  placeHold(db, SPACE, "hld_open");
  assert.equal(holdActive(db, SPACE, NOW), true);
  assert.deepEqual(runRetention(db, SPACE, NOW), { held: true, folded: 0, deleted: 0 });
  assert.equal(db.rows("logs_row").length, 5);
  releaseHold(db, SPACE, "hld_open");
  placeHold(db, SPACE, "hld_dated", NOW + DAY_MS);
  assert.equal(holdActive(db, SPACE, NOW), true);
  assert.equal(runRetention(db, SPACE, NOW).held, true);
  assert.equal(holdActive(db, SPACE, NOW + 2 * DAY_MS), false, "a dated hold ends");
  assert.equal(runRetention(db, SPACE, NOW + 2 * DAY_MS).held, false);
});

test("shorter windows in settings apply to the next retention run", () => {
  const db = new FakeLogsDb();
  seedAged(db);
  writeSettings(db, SPACE, { level: "info", fullDays: 5, aggregateDays: 30 });
  const r = runRetention(db, SPACE, NOW);
  assert.equal(r.folded, 5, "the 10 day old row is now past the window too");
  assert.equal(db.rows("logs_row").length, 0);
  assert.equal(db.rows("logs_aggregate").length, 1, "only the 10 day old summary is inside 30 days");
});

test("old exports and streams expire with the window", () => {
  const db = new FakeLogsDb();
  db.run("INSERT INTO logs_export (id, space, principal, at, row_count, lines) VALUES (?, ?, ?, ?, ?, ?)", "fil_old", SPACE, "usr_a", NOW - 40 * DAY_MS, 0, "");
  db.run("INSERT INTO logs_export (id, space, principal, at, row_count, lines) VALUES (?, ?, ?, ?, ?, ?)", "fil_new", SPACE, "usr_a", NOW - DAY_MS, 0, "");
  db.run("INSERT INTO logs_stream (id, space, filter, principal, at) VALUES (?, ?, ?, ?, ?)", "stm_old", SPACE, "{}", "usr_a", NOW - 2 * DAY_MS);
  db.run("INSERT INTO logs_stream (id, space, filter, principal, at) VALUES (?, ?, ?, ?, ?)", "stm_new", SPACE, "{}", "usr_a", NOW - 1000);
  runRetention(db, SPACE, NOW);
  assert.deepEqual(db.rows("logs_export").map((r) => r["id"]), ["fil_new"]);
  assert.deepEqual(db.rows("logs_stream").map((r) => r["id"]), ["stm_new"]);
});

test("erasing a person leaves a tombstone and keeps the rows", () => {
  const db = new FakeLogsDb();
  writer(db).write({ msg: "a.b", actor: "usr_gone" });
  eraseActor(db, "usr_gone", NOW);
  eraseActor(db, "usr_gone", NOW + 1);
  assert.deepEqual([...erasedActors(db)], ["usr_gone"]);
  assert.equal(db.rows("logs_row").length, 1);
  assert.equal(db.rows("logs_row")[0]!["actor"], "usr_gone", "the id stays; reads blank it");
  assert.equal(db.rows("logs_tombstone").length, 1);
});

test("the seed rows fit the migration and read back through the search", () => {
  const db = new FakeLogsDb();
  for (const row of seed.rows) {
    const names = Object.keys(row);
    db.run(`INSERT INTO ${seed.table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`, ...names.map((n) => (row as Record<string, unknown>)[n]));
  }
  const stored = db.rows(seed.table);
  assert.equal(stored.length, seed.rows.length);
  assert.equal(stored[0]!["msg"], "record.updated");
  assert.equal(JSON.parse(String(stored[0]!["attrs"])).count, 1);
});
