// Search and the trace view through the real handlers (spec 4.18, ARCH 4.9 and 4.10).
// trace test: one trace id finds the whole chain in the trace view.
// @reads ../migrations/0001_init.sql

import test from "node:test";
import assert from "node:assert/strict";
import { FakeLogsDb, harness, NOW, SPACE, TRACE } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { HostError } from "../../../host/src/routes/errors.ts";
import { LogWriter, MAX_UPLOAD, eraseActor, readSettings, writeSettings, DAY_MS } from "../handlers/sink.ts";
import { buildWhere, limitOf } from "../handlers/search.ts";
import type { LogFilter, Page } from "../handlers/search.ts";
import * as impl from "../impl.ts";
import {
  clientUpload, exportLogs, filterOf, handlers, query, replayGet, replayStart, settingsGet, settingsSet, spans, tail, trace,
} from "../handlers/index.ts";

const T1 = "11111111111111111111111111111111";
const T2 = "22222222222222222222222222222222";
const T3 = "33333333333333333333333333333333";
const S1 = "aaaaaaaaaaaaaaa1", S2 = "aaaaaaaaaaaaaaa2", S3 = "bbbbbbbbbbbbbbb1";

function writerFor(db: FakeLogsDb, space: string = SPACE): LogWriter {
  return new LogWriter({ db, space, now: () => NOW, batchMs: 0, minLevel: "debug" });
}

/** Six rows over three traces, three spans, three events, plus a row of another Space on the same trace id. */
function dataset(h: Harness): void {
  const w = writerFor(h.raw);
  const r = (msg: string, o: Record<string, unknown>): void => { w.write({ msg, ...o }); };
  r("t.r1", { at: NOW - 5000, level: "info", traceId: T1, actor: "usr_ana", cap: "records.update", place: "records", entityId: "rec_1", result: "ok" });
  r("t.r2", { at: NOW - 4000, level: "info", traceId: T1, actor: "agt_scout", onBehalf: "usr_ana", cap: "mail.send", place: "mail", runId: "run_1", result: "ok" });
  r("t.r3", { at: NOW - 3000, level: "warn", traceId: T1, actor: "usr_bo", cap: "records.update", place: "records", entityId: "rec_2", result: "validation.bad_input" });
  r("t.r4", { at: NOW - 2000, level: "debug", traceId: T2, actor: "usr_ana", cap: "files.upload", place: "files", entityId: "fil_1", result: "ok" });
  r("t.r5", { at: NOW - 1000, level: "error", traceId: T2, actor: "usr_gone", cap: "files.delete", place: "files", entityId: "fil_1", result: "permission.no_grant" });
  r("t.r6", { at: NOW - 500, level: "info", traceId: T3, actor: "usr_bo", cap: "mail.send", place: "mail", runId: "run_1", result: "ok" });
  w.span({ traceId: T1, spanId: S1, name: "invoke.validate", at: NOW - 4900, durUs: 100 });
  w.span({ traceId: T1, spanId: S2, parent: S1, name: "invoke.handler", at: NOW - 4800, durUs: 2000 });
  w.span({ traceId: T2, spanId: S3, name: "invoke.handler", at: NOW - 1900, durUs: 500 });
  w.event({ traceId: T1, seq: 10, type: "record.updated", at: NOW - 4950, actor: "usr_ana", entity: "record/rec_1" });
  w.event({ traceId: T1, seq: 11, type: "message.sent", at: NOW - 3900, actor: "agt_scout" });
  w.event({ traceId: T2, seq: 12, type: "file.uploaded", at: NOW - 1950, actor: "usr_gone" });
  writerFor(h.raw, "spc_other").write({ msg: "t.other", at: NOW - 100, traceId: T1, actor: "usr_ana" });
}

const msgs = (out: { rows: { msg: string }[] }): string[] => out.rows.map((r) => r.msg);

test("trace test: one trace id finds the whole chain in the trace view", async () => {
  const h = harness();
  dataset(h);
  const out = await trace(h.ctx, { traceId: T1 });
  assert.deepEqual(out.logs.map((l) => l.msg), ["t.r1", "t.r2", "t.r3"], "log rows in time order, none from other traces or other Spaces");
  assert.deepEqual(out.spans.map((s) => s.spanId), [S1, S2], "spans in start order");
  assert.deepEqual(out.spans.map((s) => s.parent ?? null), [null, S1], "the child span names its parent");
  assert.deepEqual(out.events.map((e) => [e.seq, e.type, e.actor, e.entity ?? null]), [[10, "record.updated", "usr_ana", "record/rec_1"], [11, "message.sent", "agt_scout", null]]);
  for (const l of out.logs) assert.equal(l.traceId, T1);
  for (const s of out.spans) assert.equal(s.traceId, T1);
  assert.equal(out.logs[1]!.onBehalf, "usr_ana");
  assert.equal(out.spans[1]!.durUs, 2000);

  const other = await trace(h.ctx, { traceId: T2 });
  assert.deepEqual(other.logs.map((l) => l.msg), ["t.r4", "t.r5"]);
  assert.deepEqual(other.events.map((e) => e.seq), [12]);
  const none = await trace(h.ctx, { traceId: "44444444444444444444444444444444" });
  assert.deepEqual(none, { logs: [], spans: [], events: [] });
});

test("trace view blanks an erased person in rows and events", async () => {
  const h = harness();
  dataset(h);
  eraseActor(h.raw, "usr_gone", NOW);
  const out = await trace(h.ctx, { traceId: T2 });
  assert.equal(out.logs[0]!.actor, "usr_ana");
  assert.equal("actor" in out.logs[1]!, false, "the erased actor key is absent");
  assert.equal(out.events[0]!.actor, "");
});

test("search by person, agent, place, record, run, trace, capability, result and level", async () => {
  const h = harness();
  dataset(h);
  const by = async (f: LogFilter & Page): Promise<string[]> => msgs(await query(h.ctx, f));
  assert.deepEqual(await by({}), ["t.r6", "t.r5", "t.r4", "t.r3", "t.r2", "t.r1"], "newest first, only this Space");
  assert.deepEqual(await by({ person: "usr_ana" }), ["t.r4", "t.r2", "t.r1"], "a person matches as actor or on behalf of");
  assert.deepEqual(await by({ agent: "agt_scout" }), ["t.r2"]);
  assert.deepEqual(await by({ place: "mail" }), ["t.r6", "t.r2"]);
  assert.deepEqual(await by({ recordId: "rec_1" }), ["t.r1"]);
  assert.deepEqual(await by({ recordId: "fil_1" }), ["t.r5", "t.r4"]);
  assert.deepEqual(await by({ runId: "run_1" }), ["t.r6", "t.r2"]);
  assert.deepEqual(await by({ traceId: T2 }), ["t.r5", "t.r4"]);
  assert.deepEqual(await by({ cap: "records.update" }), ["t.r3", "t.r1"]);
  assert.deepEqual(await by({ result: "ok" }), ["t.r6", "t.r4", "t.r2", "t.r1"]);
  assert.deepEqual(await by({ level: "warn" }), ["t.r5", "t.r3"], "level is a floor: warn finds warn and error");
  assert.deepEqual(await by({ level: "error" }), ["t.r5"]);
  assert.deepEqual(await by({ level: "debug" }), ["t.r6", "t.r5", "t.r4", "t.r3", "t.r2", "t.r1"]);
  assert.deepEqual(await by({ sinceMs: NOW - 3000 }), ["t.r6", "t.r5", "t.r4", "t.r3"]);
  assert.deepEqual(await by({ untilMs: NOW - 3000 }), ["t.r3", "t.r2", "t.r1"]);
  assert.deepEqual(await by({ sinceMs: NOW - 4000, untilMs: NOW - 2000 }), ["t.r4", "t.r3", "t.r2"]);
  assert.deepEqual(await by({ person: "usr_bo", cap: "mail.send" }), ["t.r6"], "filters combine");
  assert.deepEqual(await by({ person: "usr_ana", level: "warn" }), []);
  assert.deepEqual(await by({ person: "usr_ana", agent: "agt_scout" }), ["t.r2"], "person and agent both must match");
});

test("each search reports a total and returns the full row shape", async () => {
  const h = harness();
  dataset(h);
  const out = await query(h.ctx, { runId: "run_1" });
  assert.equal(out.total, 2);
  assert.equal(out.next, undefined);
  assert.deepEqual(out.rows[1], {
    id: 2, at: NOW - 4000, level: "info", msg: "t.r2", traceId: T1, actor: "agt_scout", onBehalf: "usr_ana", runId: "run_1", place: "mail",
    cap: "mail.send", result: "ok",
  });
});

test("paging walks newest to oldest with a stable total", async () => {
  const h = harness();
  dataset(h);
  const p1 = await query(h.ctx, { limit: 2 });
  assert.deepEqual([msgs(p1), p1.total, p1.next], [["t.r6", "t.r5"], 6, "5"]);
  const p2 = await query(h.ctx, { limit: 2, cursor: p1.next! });
  assert.deepEqual([msgs(p2), p2.total, p2.next], [["t.r4", "t.r3"], 6, "3"]);
  const p3 = await query(h.ctx, { limit: 2, cursor: p2.next! });
  assert.deepEqual([msgs(p3), p3.total, p3.next], [["t.r2", "t.r1"], 6, undefined]);
  const exact = await query(h.ctx, { limit: 6 });
  assert.equal(exact.next, undefined, "a page that holds everything has no next");
  const stale = await query(h.ctx, { limit: 2, cursor: "example" });
  assert.deepEqual(msgs(stale), ["t.r6", "t.r5"], "a cursor that is not a number starts from the top");
  assert.equal(limitOf(undefined), 50);
  assert.equal(limitOf({ limit: 9999 }), 500);
  assert.equal(limitOf({ limit: 0 }), 1);
  assert.equal(limitOf({ limit: 7.9 }), 7);
});

test("a search for an erased person finds nothing, and erased actors are blank in results", async () => {
  const h = harness();
  dataset(h);
  eraseActor(h.raw, "usr_gone", NOW);
  const gone = await query(h.ctx, { person: "usr_gone" });
  assert.deepEqual([gone.rows, gone.total], [[], 0]);
  const asAgent = await query(h.ctx, { agent: "usr_gone" });
  assert.equal(asAgent.total, 0);
  const all = await query(h.ctx, {});
  assert.equal(all.rows.find((r) => r.msg === "t.r5")!.actor, undefined);
  assert.equal(all.rows.find((r) => r.msg === "t.r4")!.actor, "usr_ana");
  assert.equal(h.raw.rows("logs_row").find((r) => r["msg"] === "t.r5")!["actor"], "usr_gone", "the stored id stays");
  const ex = await exportLogs(h.ctx, { person: "usr_gone" });
  assert.equal(h.raw.rows("logs_export").find((r) => r["id"] === ex.fileId)!["row_count"], 0);
});

test("spans by trace or by name, with an offset cursor", async () => {
  const h = harness();
  dataset(h);
  const t1 = await spans(h.ctx, { traceId: T1 });
  assert.deepEqual(t1.spans.map((s) => s.name), ["invoke.validate", "invoke.handler"]);
  assert.equal(t1.total, 2);
  const a = await spans(h.ctx, { name: "invoke.handler", limit: 1 });
  assert.deepEqual([a.spans.map((s) => s.spanId), a.total, a.next], [[S2], 2, "1"], "the speed page rolls spans up by budget name");
  const b = await spans(h.ctx, { name: "invoke.handler", limit: 1, cursor: a.next! });
  assert.deepEqual([b.spans.map((s) => s.spanId), b.total, b.next], [[S3], 2, undefined]);
  const none = await spans(h.ctx, { name: "no.such.span" });
  assert.deepEqual([none.spans, none.total], [[], 0]);
});

test("export writes the matching rows, oldest first, as lines of a file", async () => {
  const h = harness({ principal: "usr_admin" });
  dataset(h);
  const out = await exportLogs(h.ctx, { person: "usr_ana" });
  assert.match(out.fileId, /^fil_[a-z0-9]+$/);
  const row = h.raw.rows("logs_export")[0]!;
  assert.equal(row["id"], out.fileId);
  assert.equal(row["row_count"], 3);
  assert.equal(row["principal"], "usr_admin");
  const lines = String(row["lines"]).split("\n").map((l) => JSON.parse(l) as { msg: string });
  assert.deepEqual(lines.map((l) => l.msg), ["t.r1", "t.r2", "t.r4"]);
  const empty = await exportLogs(h.ctx, { cap: "no.such" });
  assert.equal(h.raw.rows("logs_export").find((r) => r["id"] === empty.fileId)!["row_count"], 0);
});

test("tail registers a stream with only the filter keys", async () => {
  const h = harness({ principal: "usr_admin" });
  const input = { person: "usr_ana", level: "warn" as const, cursor: "9", stray: 1 };
  const out = await tail(h.ctx, input);
  assert.match(out.streamId, /^stm_[a-z0-9]+$/);
  const row = h.raw.rows("logs_stream")[0]!;
  assert.equal(row["id"], out.streamId);
  assert.equal(row["principal"], "usr_admin");
  assert.deepEqual(JSON.parse(String(row["filter"])), { person: "usr_ana", level: "warn" });
  assert.deepEqual(filterOf({}), {});
});

test("client upload stores entries by trace id for the device, under the Space level", async () => {
  const h = harness({ principal: "usr_dev", actingFor: "usr_ana" });
  const entries = [
    { at: NOW - 10, traceId: T1, level: "info" as const, msg: "client.opened", attrs: { count: 2 } },
    { at: NOW - 9, level: "debug" as const, msg: "client.noise" },
    { at: NOW - 8, level: "error" as const, msg: "Dear client, the settlement", attrs: { text: "private", n: 1 } },
  ];
  const out = await clientUpload(h.ctx, { device: "dev_a1b2c3", entries });
  assert.deepEqual(out, { accepted: 2 }, "the debug entry is below the Space level");
  const rows = h.raw.rows("logs_row");
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0]!["device"], rows[0]!["place"], rows[0]!["actor"], rows[0]!["on_behalf"], rows[0]!["trace_id"], rows[0]!["msg"]], ["dev_a1b2c3", "client", "usr_dev", "usr_ana", T1, "client.opened"]);
  assert.deepEqual([rows[1]!["msg"], rows[1]!["attrs"], rows[1]!["level"]], ["log.redacted", "{\"n\":1}", 40], "free text becomes a template key and content keys are dropped");
  assert.equal(h.events.length, 1);
  const ev = h.events[0]!;
  assert.deepEqual([ev.name, ev.subject, ev.vis], ["client_log.uploaded", "entity/dev_a1b2c3", "owner"]);
  const payload = ev.payload as { device: string; sizeBytes: number };
  assert.equal(payload.device, "dev_a1b2c3");
  assert.ok(payload.sizeBytes > 50);

  writeSettings(h.raw, SPACE, { level: "debug", fullDays: 30, aggregateDays: 180 });
  assert.deepEqual(await clientUpload(h.ctx, { device: "dev_a1b2c3", entries }), { accepted: 3 });
  assert.deepEqual(await clientUpload(h.ctx, { device: "dev_a1b2c3", entries: [] }), { accepted: 0 });
});

test("client upload writes at most MAX_UPLOAD entries per call", async () => {
  const h = harness({ principal: "usr_dev" });
  const entries = Array.from({ length: MAX_UPLOAD + 1 }, (_, i) => ({ at: NOW - 1, level: "info" as const, msg: "client.tick", attrs: { n: i } }));
  const out = await clientUpload(h.ctx, { device: "dev_a1b2c3", entries });
  assert.equal(out.accepted, MAX_UPLOAD);
  assert.equal(h.raw.rows("logs_row").length, MAX_UPLOAD);
});

function runRows(h: Harness): void {
  const w = writerFor(h.raw);
  w.write({ msg: "run.a", at: NOW - 300, runId: "run_9", cap: "records.update", result: "ok" });
  w.write({ msg: "run.b", at: NOW - 200, runId: "run_9", cap: "mail.send", result: "ok", attrs: { outward: true } });
  w.write({ msg: "run.c", at: NOW - 100, runId: "run_9", cap: "files.delete", result: "permission.no_grant" });
  w.write({ msg: "run.note", at: NOW - 50, runId: "run_9" });
}

test("replay re-runs a failed Run on what the logs kept and records outward calls without sending", async () => {
  const h = harness({ principal: "usr_admin" });
  dataset(h);
  runRows(h);
  const { replayId } = await replayStart(h.ctx, { atSeq: 11, runId: "run_9" });
  assert.match(replayId, /^rpl_[a-z0-9]+$/);
  assert.deepEqual(h.events.map((e) => [e.name, e.subject, e.vis]), [["replay.started", `entity/${replayId}`, "owner"], ["replay.finished", `entity/${replayId}`, "owner"]]);
  assert.deepEqual(h.events[0]!.payload, { replayId, atSeq: 11, runId: "run_9" });
  assert.deepEqual(h.events[1]!.payload, { replayId, recordedOutward: 1 });
  const got = await replayGet(h.ctx, { replayId });
  assert.deepEqual(got, {
    state: "done",
    recordedOutward: 1,
    steps: [
      { name: "copy", ok: true, detail: "2 events up to 11" },
      { name: "seal", ok: true, detail: "sealed and Restricted values replaced" },
      { name: "records.update", ok: true, detail: "replayed" },
      { name: "mail.send", ok: true, detail: "recorded, not sent" },
      { name: "files.delete", ok: false, detail: "original result permission.no_grant" },
    ],
  });
  assert.equal(h.raw.rows("logs_row").length, 6 + 1 + 4, "a replay writes no log rows of its own and changes nothing it replays");
});

test("replay of a sync conflict, of a missing Run, and of a bare sequence number", async () => {
  const h = harness();
  dataset(h);
  writerFor(h.raw).write({ msg: "sync.apply", at: NOW - 10, entityId: "cfl_1", cap: "sync.apply", result: "ok" });
  const c = await replayGet(h.ctx, await replayStart(h.ctx, { atSeq: 12, conflictId: "cfl_1" }));
  assert.equal(c.state, "done");
  assert.deepEqual(c.steps.map((s) => s.name), ["copy", "seal", "sync.apply"]);
  assert.equal(c.steps[0]!.detail, "3 events up to 12");

  const missing = await replayGet(h.ctx, await replayStart(h.ctx, { atSeq: 1, runId: "run_none" }));
  assert.equal(missing.state, "failed");
  assert.deepEqual(missing.steps.map((s) => [s.name, s.ok]), [["copy", true], ["seal", true], ["source", false]]);
  assert.equal(missing.recordedOutward, 0);

  const bare = await replayGet(h.ctx, await replayStart(h.ctx, { atSeq: 0 }));
  assert.deepEqual([bare.state, bare.steps.map((s) => s.name)], ["done", ["copy", "seal"]]);
  assert.equal(bare.steps[0]!.detail, "0 events up to 0");
  assert.equal(h.events.filter((e) => e.name === "replay.finished").length, 3, "every replay ends with replay.finished");
  assert.equal(h.events.filter((e) => e.name === "replay.started").length, 3);
  const third = h.events.filter((e) => e.name === "replay.started")[2]!.payload as Record<string, unknown>;
  assert.deepEqual(Object.keys(third).sort(), ["atSeq", "replayId"], "no runId key when none was given");
});

test("replay_get of an id nobody started is a typed not_found with the trace id", async () => {
  const h = harness();
  await assert.rejects(
    () => replayGet(h.ctx, { replayId: "rpl_missing" }),
    (e: unknown) => e instanceof VyreErr && e.error.code === "validation.not_found" && e.error.traceId === TRACE && e.error.next.length > 0 && e.error.retryable === false,
  );
  const { replayId } = await replayStart(h.ctx, { atSeq: 1 });
  await assert.rejects(() => replayGet({ ...h.ctx, space: "spc_other" }, { replayId }), VyreErr, "a replay is visible only inside its own Space");
});

test("settings: defaults, partial updates, validation, and retention applied at once", async () => {
  const h = harness();
  assert.deepEqual(await settingsGet(h.ctx, {}), { level: "info", fullDays: 30, aggregateDays: 180 });
  const old = (age: number): void => { new LogWriter({ db: h.raw, space: SPACE, now: () => NOW - age * DAY_MS, batchMs: 0, minLevel: "debug" }).write({ msg: "a.b", cap: "x.y", result: "ok" }); };
  old(100); old(40); old(3);
  const bad = async (input: { level?: "debug"; fullDays?: number; aggregateDays?: number }): Promise<string> => {
    try { await settingsSet(h.ctx, input); return "no error"; } catch (e) { return e instanceof VyreErr ? e.error.code : "other"; }
  };
  assert.equal(await bad({ fullDays: 0 }), "validation.bad_input");
  assert.equal(await bad({ aggregateDays: 0 }), "validation.bad_input");
  assert.equal(await bad({ aggregateDays: 10 }), "validation.bad_input", "summaries outlive full rows: 10 < the current 30");
  assert.equal(await bad({ fullDays: 10, aggregateDays: 5 }), "validation.bad_input");
  assert.equal(h.raw.rows("logs_row").length, 3, "a refused change touches nothing");
  assert.deepEqual(readSettings(h.raw, SPACE), { level: "info", fullDays: 30, aggregateDays: 180 });

  assert.deepEqual(await settingsSet(h.ctx, { fullDays: 7, aggregateDays: 60 }), { ok: true });
  assert.deepEqual(await settingsGet(h.ctx, {}), { level: "info", fullDays: 7, aggregateDays: 60 });
  assert.equal(h.raw.rows("logs_row").length, 1, "rows older than 7 days were folded");
  assert.equal(h.raw.rows("logs_aggregate").length, 1, "the 100 day old summary is past 60 days");

  assert.deepEqual(await settingsSet(h.ctx, { level: "warn" }), { ok: true });
  assert.deepEqual(await settingsGet(h.ctx, {}), { level: "warn", fullDays: 7, aggregateDays: 60 }, "an update keeps what it does not name");
  assert.deepEqual(await settingsSet(h.ctx, { fullDays: 7.9 }), { ok: true });
  assert.equal((await settingsGet(h.ctx, {})).fullDays, 7);
});

test("buildWhere names every filter and always scopes to the Space", () => {
  assert.deepEqual(buildWhere(SPACE, {}), { sql: "space = ?", args: [SPACE] });
  const w = buildWhere(SPACE, { person: "usr_a", place: "mail", level: "warn", sinceMs: 5, untilMs: 9 });
  assert.equal(w.sql, "space = ? AND (actor = ? OR on_behalf = ?) AND place = ? AND level >= ? AND at >= ? AND at <= ?");
  assert.deepEqual(w.args, [SPACE, "usr_a", "usr_a", "mail", 30, 5, 9]);
  assert.equal(buildWhere(SPACE, { sinceMs: 0 }).sql, "space = ? AND at >= ?", "zero is a real time, not an absent filter");
});

test("rows of another Space are invisible to queries, spans, traces and settings", async () => {
  const h = harness();
  dataset(h);
  const o = { ...h.ctx, space: "spc_other" };
  const rows = await query(o, {});
  assert.deepEqual(msgs(rows), ["t.other"]);
  assert.deepEqual((await trace(o, { traceId: T1 })).logs.map((l) => l.msg), ["t.other"]);
  assert.deepEqual((await spans(o, {})).spans, []);
  assert.deepEqual(await settingsGet(o, {}), { level: "info", fullDays: 30, aggregateDays: 180 });
});

test("the module reaches only logs_* tables: the host guard refuses anything else", () => {
  const h = harness();
  assert.throws(() => h.ctx.db.all("SELECT * FROM audit_log"), (e: unknown) => e instanceof HostError && e.error.code === "permission.no_grant");
  assert.throws(() => h.ctx.db.run("DELETE FROM records_row"), HostError);
  assert.doesNotThrow(() => h.ctx.db.all("SELECT * FROM logs_row"));
});

test("every handler is registered under its capability name", () => {
  assert.deepEqual(Object.keys(handlers).sort(), [
    "logs.client_upload", "logs.export", "logs.query", "logs.replay_get", "logs.replay_start", "logs.settings_get", "logs.settings_set",
    "logs.spans", "logs.tail", "logs.trace",
  ]);
  for (const fn of Object.values(handlers)) assert.equal(typeof fn, "function");
});

test("impl.ts exposes the handlers, the event consumer and no codecs", () => {
  assert.equal(impl.handlers, handlers);
  assert.deepEqual(Object.keys(impl.consumers), ["logs.events"]);
  assert.deepEqual(impl.inline, {});
  assert.deepEqual(impl.projections.map((p) => p.name), ["logs.events"]);
  assert.deepEqual(impl.codecs, {});
});
