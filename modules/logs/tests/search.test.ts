// Search and the trace view: one trace id returns the whole chain.
import test from "node:test";
import assert from "node:assert/strict";
import { createBook } from "../handlers/sink.ts";
import type { SqlDb } from "../handlers/sink.ts";
import { query, traceView } from "../handlers/search.ts";
import { bookFor, handlers } from "../handlers/index.ts";
import type { LogCtx } from "../handlers/index.ts";
import { toApiLog } from "../handlers/search.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";
const ROOT = "1111111111111111";
const MID = "2222222222222222";
const LEAF = "3333333333333333";

test("trace test: one trace id finds the whole chain in the trace view", () => {
  const book = createBook({ space: "spc_trace", now: () => 2000, batchMs: 0 });
  book.span({ traceId: TRACE, spanId: ROOT, name: "gateway", at: 1000, durUs: 800 });
  book.span({ traceId: TRACE, spanId: MID, parent: ROOT, name: "handler", at: 1100, durUs: 500 });
  book.span({ traceId: TRACE, spanId: LEAF, parent: MID, name: "provider", at: 1200, durUs: 200 });
  book.write({ traceId: TRACE, spanId: ROOT, msg: "gateway.accepted", at: 1000, actor: "usr_owner", onBehalf: "usr_ana", cap: "records.update", entity: "record", entityId: "rec_1", result: "ok", durMs: 8, costMicros: 1, place: "records", runId: "run_a1b2c3" });
  book.write({ traceId: TRACE, spanId: MID, msg: "handler.done", at: 1100, actor: "agt_helper", cap: "records.update", entityId: "rec_1", result: "ok" });
  book.write({ traceId: TRACE, spanId: LEAF, msg: "provider.called", at: 1200, actor: "agt_helper", cap: "records.update", result: "ok" });
  book.event({ traceId: TRACE, seq: 1, type: "record.updated", at: 1150, actor: "usr_owner", entity: "rec_1" });
  book.event({ traceId: TRACE, seq: 2, type: "record.updated", at: 1250, actor: "agt_helper", entity: "rec_1" });
  book.write({ traceId: OTHER, msg: "other.done", at: 1000, actor: "usr_other" });
  book.span({ traceId: OTHER, spanId: "4444444444444444", name: "other", at: 1000, durUs: 1 });
  book.event({ traceId: OTHER, seq: 1, type: "other.done", at: 1000, actor: "usr_other" });

  const view = traceView(book, TRACE);
  assert.deepEqual(view.logs.map((row) => row.msg), ["gateway.accepted", "handler.done", "provider.called"]);
  assert.deepEqual(view.spans.map((span) => span.spanId), [ROOT, MID, LEAF]);
  assert.equal(view.spans[0]?.parent, undefined);
  assert.equal(view.spans[1]?.parent, ROOT);
  assert.equal(view.spans[2]?.parent, LEAF === view.spans[2]?.spanId ? MID : "");
  assert.deepEqual(view.events.map((ev) => ev.seq), [1, 2]);
  assert.equal(view.events[0]?.entity, "rec_1");
  const byId = new Map(view.spans.map((span) => [span.spanId, span]));
  const seen: string[] = [];
  let cursor: string | undefined = LEAF;
  while (cursor) {
    seen.push(cursor);
    cursor = byId.get(cursor)?.parent;
  }
  assert.deepEqual(seen, [LEAF, MID, ROOT]);
  assert.equal(JSON.stringify(view).includes(OTHER), false);
  assert.equal(view.logs[0]?.actor, "usr_owner");
  assert.equal(view.logs[0]?.onBehalf, "usr_ana");
  assert.equal(view.logs[0]?.cap, "records.update");
  assert.equal(view.logs[0]?.entityId, "rec_1");
  assert.equal(view.logs[0]?.result, "ok");
  assert.equal(view.logs[0]?.durMs, 8);
  assert.equal(view.logs[0]?.costMicros, 1);

  const listed = query(book, { traceId: TRACE });
  assert.equal(listed.total, 3);
  assert.equal(listed.rows.length, 3);
  const page = query(book, { traceId: TRACE }, { limit: 2 });
  assert.equal(page.rows.length, 2);
  assert.ok(page.next);
  const rest = query(book, { traceId: TRACE }, { limit: 2, cursor: page.next });
  assert.equal(rest.rows.length, 1);
  assert.equal(rest.next, undefined);

  book.erase("usr_owner");
  const blanked = toApiLog(book, book.rawRows().find((row) => row.msg === "gateway.accepted") ?? book.rawRows()[0]!);
  assert.equal(blanked.actor, undefined);
  assert.equal(blanked.onBehalf, undefined);
  assert.equal(book.rawRows().find((row) => row.msg === "gateway.accepted")?.actor, "usr_owner");
});

test("search by person, agent, place, record, run and trace", () => {
  const book = createBook({ space: "spc_find", now: () => 50, batchMs: 0 });
  book.write({ at: 10, msg: "by.person", actor: "usr_ana", onBehalf: "usr_owner", place: "inbox", entityId: "rec_9", runId: "run_person1", traceId: TRACE, cap: "mail.send", result: "ok", level: "info" });
  book.write({ at: 20, msg: "by.agent", actor: "agt_helper", place: "records", entityId: "rec_2", runId: "run_agent01", traceId: OTHER, cap: "records.get", result: "error", level: "error" });
  const msgs = (filter: Parameters<typeof query>[1]): string[] => query(book, filter).rows.map((row) => row.msg);
  assert.deepEqual(msgs({ person: "usr_ana" }), ["by.person"]);
  assert.deepEqual(msgs({ person: "usr_owner" }), ["by.person"]);
  assert.deepEqual(msgs({ agent: "agt_helper" }), ["by.agent"]);
  assert.deepEqual(msgs({ place: "inbox" }), ["by.person"]);
  assert.deepEqual(msgs({ recordId: "rec_9" }), ["by.person"]);
  assert.deepEqual(msgs({ runId: "run_agent01" }), ["by.agent"]);
  assert.deepEqual(msgs({ traceId: OTHER }), ["by.agent"]);
  assert.deepEqual(msgs({ cap: "mail.send" }), ["by.person"]);
  assert.deepEqual(msgs({ level: "error" }), ["by.agent"]);
  assert.deepEqual(msgs({ result: "ok" }), ["by.person"]);
  assert.deepEqual(msgs({ sinceMs: 15, untilMs: 20 }), ["by.agent"]);
});

test("logs.trace handler returns the chain for one trace id", async () => {
  const book = bookFor("spc_chain", () => 2000);
  book.span({ traceId: TRACE, spanId: ROOT, name: "gateway", at: 1000, durUs: 10 });
  book.span({ traceId: TRACE, spanId: MID, parent: ROOT, name: "handler", at: 1100, durUs: 5 });
  book.write({ traceId: TRACE, spanId: ROOT, msg: "gateway.accepted", at: 1000, actor: "usr_owner", cap: "records.update", result: "ok" });
  book.write({ traceId: TRACE, spanId: MID, msg: "handler.done", at: 1100, actor: "usr_owner", cap: "records.update", result: "ok" });
  book.event({ traceId: TRACE, seq: 1, type: "record.updated", at: 1100, actor: "usr_owner", entity: "rec_1" });
  book.write({ traceId: OTHER, msg: "other.done", at: 1000 });
  book.flush();
  const ctx: LogCtx = {
    space: "spc_chain",
    principal: { kind: "person", id: "usr_owner" },
    trace: { traceId: TRACE },
    now: () => 2000,
    db: { all() { throw new Error("db off"); }, run() { throw new Error("db off"); } },
    emit() { /* read path emits nothing */ },
  };
  const view = await handlers["logs.trace"](ctx, { traceId: TRACE });
  assert.deepEqual(view.logs.map((row) => row.msg), ["gateway.accepted", "handler.done"]);
  assert.deepEqual(view.spans.map((span) => span.parent ?? span.spanId), [ROOT, ROOT]);
  assert.equal(view.events.length, 1);
  assert.equal(JSON.stringify(view).includes(OTHER), false);
});

test("a logs.db read rebuilds the trace chain", () => {
  const db: SqlDb = {
    all(sql) {
      if (sql.includes("FROM logs_row")) return [{ id: 1, at: 10, level: 20, space: "spc_sql", msg: "record.updated", trace_id: TRACE, span_id: ROOT, actor: "usr_a", on_behalf: "usr_b", cap: "records.update", entity_id: "rec_1", result: "ok", dur_ms: 2, cost_micros: 3, attrs: "{\"count\":1}" }];
      if (sql.includes("FROM logs_span")) return [
        { space: "spc_sql", trace_id: TRACE, span_id: ROOT, name: "gateway", at: 10, dur_us: 8 },
        { space: "spc_sql", trace_id: TRACE, span_id: MID, parent: ROOT, name: "handler", at: 12, dur_us: 4 },
      ];
      if (sql.includes("FROM logs_event")) return [{ space: "spc_sql", trace_id: TRACE, seq: 1, type: "record.updated", at: 11, actor: "usr_a", entity: "rec_1" }];
      return [];
    },
    run() { return { changes: 0 }; },
  };
  const book = createBook({ space: "spc_sql", now: () => 1000, batchMs: 0, db });
  const view = traceView(book, TRACE);
  assert.equal(view.logs.length, 1);
  assert.equal(view.logs[0]?.traceId, TRACE);
  assert.equal(view.logs[0]?.actor, "usr_a");
  assert.equal(view.logs[0]?.onBehalf, "usr_b");
  assert.equal(view.logs[0]?.entityId, "rec_1");
  assert.equal(view.logs[0]?.durMs, 2);
  assert.equal(view.logs[0]?.costMicros, 3);
  assert.deepEqual(view.logs[0]?.attrs, { count: 1 });
  assert.deepEqual(view.spans.map((span) => span.spanId), [ROOT, MID]);
  assert.equal(view.spans[1]?.parent, ROOT);
  assert.equal(view.events[0]?.type, "record.updated");
  const seen: string[] = [];
  let cursor: string | undefined = MID;
  const byId = new Map(view.spans.map((span) => [span.spanId, span]));
  while (cursor) {
    seen.push(cursor);
    cursor = byId.get(cursor)?.parent;
  }
  assert.deepEqual(seen, [MID, ROOT]);
});
