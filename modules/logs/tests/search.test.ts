// Trace view: one trace id returns the whole chain of logs, spans and events.
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx, ScopedDb } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { createJsonSink, memoryDb } from "../handlers/sink.ts";

const SPACE = "spc_a1b2c3";
const TRACE = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";
const NOW = 1_760_000_000_000;

function fake(db: ScopedDb, now = NOW): Ctx {
  return {
    space: SPACE,
    principal: { kind: "person", id: "usr_a1b2c3" },
    trace: { traceId: TRACE, spanId: "0123456789abcdef" },
    origin: "test",
    depth: 0,
    now: () => now,
    db,
    emit: () => ({
      seq: 1, id: "evt_test1", type: "log.accessed", sv: 1, hlc: "0", at: now,
      traceId: TRACE, actor: "usr_a1b2c3", depth: 0, label: 0, vis: "owner", enc: 0, payload: {},
    }),
    call: async () => ({}),
    authorize: () => ({ effect: "allow", reason: "test", decisionId: "dec_a" }),
    vault: { fill: async () => {}, use: (handle: string) => ({ handle }) },
    http: async () => ({ status: 200, text: async () => "" }),
    log: { debug() {}, info() {}, warn() {}, error() {} },
    schedule: async () => "sch_a",
    seal: { seal: () => ({ keyId: "k", nonce: "n", bytes: "" }), unseal: () => new Uint8Array() },
  };
}

test("trace test: one trace id finds the whole chain in the trace view", async () => {
  const db = memoryDb();
  const sink = createJsonSink(db, SPACE, { batchMs: 0, now: () => NOW });
  const root = "aaaaaaaaaaaaaaaa";
  const child = "bbbbbbbbbbbbbbbb";
  const leaf = "cccccccccccccccc";
  const line = (when: number, spanId: string, msg: string, traceId = TRACE): void => {
    sink.line(JSON.stringify({
      when, traceId, spanId, actor: "agt_a1b2c3", onBehalf: "usr_a1b2c3", capability: "records.get",
      record: "rec_a1b2c3", result: "ok", duration: 5, cost: 7, msg, place: "console", runId: "run_a1b2c3",
    }));
  };
  line(NOW, root, "chain.root");
  line(NOW + 1, child, "chain.child");
  line(NOW + 2, leaf, "chain.leaf");
  sink.line(JSON.stringify({
    when: NOW, traceId: OTHER, actor: "usr_c1b2c3", capability: "records.list", record: "rec_other1", result: "ok", msg: "chain.other",
  }));
  sink.span({ traceId: TRACE, spanId: root, name: "root", at: NOW, durUs: 1000 });
  sink.span({ traceId: TRACE, spanId: child, parent: root, name: "child", at: NOW + 1, durUs: 500 });
  sink.span({ traceId: TRACE, spanId: leaf, parent: child, name: "leaf", at: NOW + 2, durUs: 100 });
  sink.event({ traceId: TRACE, seq: 1, type: "cap.ok", at: NOW, actor: "agt_a1b2c3", entity: "rec_a1b2c3" });
  sink.event({ traceId: TRACE, seq: 2, type: "cap.next", at: NOW + 2, actor: "agt_a1b2c3" });
  sink.event({ traceId: OTHER, seq: 1, type: "cap.other", at: NOW, actor: "usr_c1b2c3" });

  const view = await handlers["logs.trace"](fake(db), { traceId: TRACE });
  assert.deepEqual(view.logs.map((l) => l.msg), ["chain.root", "chain.child", "chain.leaf"]);
  assert.ok(view.logs.every((l) => l.traceId === TRACE));
  assert.equal(view.logs[0]?.actor, "agt_a1b2c3");
  assert.equal(view.logs[0]?.onBehalf, "usr_a1b2c3");
  assert.equal(view.logs[0]?.cap, "records.get");
  assert.equal(view.logs[0]?.entityId, "rec_a1b2c3");
  assert.equal(view.logs[0]?.result, "ok");
  assert.equal(view.logs[0]?.durMs, 5);
  assert.equal(view.logs[0]?.costMicros, 7);
  assert.equal(view.spans.length, 3);
  const by = new Map(view.spans.map((s) => [s.spanId, s]));
  assert.equal(by.get(root)?.name, "root");
  assert.equal(by.get(root)?.parent, undefined);
  assert.equal(by.get(child)?.parent, root);
  assert.equal(by.get(leaf)?.parent, child);
  assert.deepEqual(view.events.map((e) => [e.seq, e.type]), [[1, "cap.ok"], [2, "cap.next"]]);
  assert.equal(view.events[0]?.entity, "rec_a1b2c3");
  assert.ok(view.logs.every((l) => l.msg !== "chain.other"));
  assert.ok(view.events.every((e) => e.type !== "cap.other"));
});

test("search by person, agent, place, record, run and trace", async () => {
  const db = memoryDb();
  const sink = createJsonSink(db, SPACE, { batchMs: 0, now: () => NOW });
  sink.line(JSON.stringify({
    when: NOW, traceId: TRACE, actor: "agt_a1b2c3", onBehalf: "usr_a1b2c3", capability: "records.get",
    record: "rec_a1b2c3", result: "ok", duration: 5, cost: 7, msg: "hit.row", place: "console", runId: "run_a1b2c3",
  }));
  sink.line(JSON.stringify({
    when: NOW + 1, traceId: OTHER, actor: "usr_c1b2c3", capability: "records.list", record: "rec_other1",
    result: "ok", msg: "miss.row", place: "api", runId: "run_other1",
  }));
  const ctx = fake(db);
  const one = async (q: { person?: string; agent?: string; place?: string; recordId?: string; runId?: string; traceId?: string }): Promise<void> => {
    const out = await handlers["logs.query"](ctx, q);
    assert.deepEqual(out.rows.map((r) => r.msg), ["hit.row"]);
  };
  await one({ person: "usr_a1b2c3" });
  await one({ agent: "agt_a1b2c3" });
  await one({ place: "console" });
  await one({ recordId: "rec_a1b2c3" });
  await one({ runId: "run_a1b2c3" });
  await one({ traceId: TRACE });
  const miss = await handlers["logs.query"](ctx, { person: "usr_missing" });
  assert.equal(miss.rows.length, 0);

  const exported = await handlers["logs.export"](ctx, { traceId: TRACE });
  assert.match(exported.fileId, /^fil_[a-z0-9]+$/);
  const settings = await handlers["logs.settings_get"](ctx);
  assert.deepEqual(settings, { level: "info", fullDays: 30, aggregateDays: 180 });
  const saved = await handlers["logs.settings_set"](ctx, { level: "warn", fullDays: 7, aggregateDays: 90 });
  assert.equal(saved.ok, true);
  const replay = await handlers["logs.replay_start"](ctx, { atSeq: 4, runId: "run_a1b2c3" });
  assert.match(replay.replayId, /^rpl_[a-z0-9]+$/);
  const got = await handlers["logs.replay_get"](ctx, { replayId: replay.replayId });
  assert.equal(got.state, "done");
  assert.equal(got.recordedOutward, 1);
  assert.equal(got.steps.some((s) => s.name === "outward.stub" && s.ok), true);
});
