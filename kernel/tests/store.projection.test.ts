import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProjectionHost, payloadOf } from "../src/store/projection.ts";
import type { AsyncConsumer, InlineProjection } from "../src/store/projection.ts";
import type { NewEvent } from "../src/log/types.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-proj-"));
const ev = (type: string, payload: unknown): NewEvent => ({ type, sv: 1, trace_id: TRACE, actor: "usr_dana", vis: "space", payload });

const counter = (version = 1, over: Partial<InlineProjection> = {}): InlineProjection => ({
  name: "test.counter", version, mode: "inline", rebuild: "replay",
  init: (tx) => tx.exec("CREATE TABLE IF NOT EXISTS tc (k TEXT PRIMARY KEY, n INTEGER NOT NULL)"),
  reset: (tx) => tx.exec("DELETE FROM tc"),
  on: { "thing.added": (tx, e) => { const p = payloadOf<{ k: string }>(e); tx.run("INSERT INTO tc (k, n) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1", p.k); } },
  ...over,
});
const total = (h: ProjectionHost) => h.tx.all<{ k: string; n: number }>("SELECT k, n FROM tc ORDER BY k");

test("inline reducers run in the commit: the row is there as soon as append returns", () => {
  const h = ProjectionHost.open({ path: ":memory:", space: "sp_1", projections: [counter()] });
  h.append(ev("thing.added", { k: "a" }));
  h.store.appendBatch([ev("thing.added", { k: "a" }), ev("thing.added", { k: "b" })]);
  assert.deepEqual(total(h), [{ k: "a", n: 2 }, { k: "b", n: 1 }]);
  assert.equal(h.projectionVersion("test.counter")?.applied, 3);
});

test("a reducer that throws rolls the whole batch back: no event, no row, head restored", () => {
  const boom = counter(1, { on: { "thing.added": (tx, e) => { const p = payloadOf<{ k: string }>(e); if (p.k === "bad") throw new Error("reducer failed"); tx.run("INSERT INTO tc (k, n) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1", p.k); } } });
  const h = ProjectionHost.open({ path: ":memory:", space: "sp_1", projections: [boom] });
  h.append(ev("thing.added", { k: "ok" }));
  const rs = h.store.appendBatch([ev("thing.added", { k: "also" }), ev("thing.added", { k: "bad" })]);
  assert.ok(rs.every((r) => !r.ok), "every item of the batch fails together");
  assert.equal(h.store.count(), 1);
  assert.deepEqual(total(h), [{ k: "ok", n: 1 }]);
  assert.equal(h.store.head.seq, 1);
  h.append(ev("thing.added", { k: "after" }));
  assert.equal(h.store.head.seq, 2, "the log carries on from the restored head");
  assert.equal(h.store.verify().ok, true);
});

test("an inline reducer may not be async", () => {
  const bad = counter(1, { on: { "thing.added": (async () => {}) as never } });
  const h = ProjectionHost.open({ path: ":memory:", space: "sp_1", projections: [bad] });
  assert.throws(() => h.append(ev("thing.added", { k: "a" })), /synchronous/);
  assert.equal(h.store.count(), 0);
});

test("a changed version rebuilds from the log on open; the same version only catches up", () => {
  const file = path.join(dir(), "events.db");
  const a = ProjectionHost.open({ path: file, space: "sp_1", projections: [counter(1)] });
  for (const k of ["x", "y", "x"]) a.append(ev("thing.added", { k }));
  a.close();
  // v2 counts twice per event: only a replay can make old events agree
  const doubled = counter(2, { on: { "thing.added": (tx, e) => { const p = payloadOf<{ k: string }>(e); tx.run("INSERT INTO tc (k, n) VALUES (?, 2) ON CONFLICT(k) DO UPDATE SET n = n + 2", p.k); } } });
  const b = ProjectionHost.open({ path: file, space: "sp_1", projections: [doubled] });
  assert.deepEqual(total(b), [{ k: "x", n: 4 }, { k: "y", n: 2 }]);
  b.close();
  const c = ProjectionHost.open({ path: file, space: "sp_1", projections: [doubled] });
  assert.deepEqual(total(c), [{ k: "x", n: 4 }, { k: "y", n: 2 }], "no second replay");
  c.rebuild("test.counter");
  assert.deepEqual(total(c), [{ k: "x", n: 4 }, { k: "y", n: 2 }]);
  c.close();
});

test("a projection added later is built from the whole log", () => {
  const file = path.join(dir(), "events.db");
  const a = ProjectionHost.open({ path: file, space: "sp_1", projections: [] });
  a.append(ev("thing.added", { k: "late" }));
  a.close();
  const b = ProjectionHost.open({ path: file, space: "sp_1", projections: [counter()] });
  assert.deepEqual(total(b), [{ k: "late", n: 1 }]);
  b.close();
});

test("upcast lifts an old event shape before the reducer sees it", () => {
  const up = counter(1, { upcast: { "thing.added": (e) => ({ ...e, payload: new TextEncoder().encode(JSON.stringify({ k: String((payloadOf<{ name: string }>(e)).name) })) }) } });
  const h = ProjectionHost.open({ path: ":memory:", space: "sp_1", projections: [up] });
  h.append(ev("thing.added", { name: "old" }));
  assert.deepEqual(total(h), [{ k: "old", n: 1 }]);
});

test("async consumers keep a durable cursor: a failing event stops them, the retry resumes there", async () => {
  const seen: string[] = [];
  let failOn: string | null = "c";
  const cons: AsyncConsumer = {
    name: "test.mirror", version: 1, mode: "async", rebuild: "replay",
    on: { "thing.added": async (_tx, e) => { const k = payloadOf<{ k: string }>(e).k; if (k === failOn) throw new Error("nope"); seen.push(k); } },
  };
  const file = path.join(dir(), "events.db");
  const h = ProjectionHost.open({ path: file, space: "sp_1", projections: [cons] });
  for (const k of ["a", "b", "c", "d"]) h.append(ev("thing.added", { k }));
  assert.equal(h.consumerCursor("test.mirror"), 0, "nothing runs at append time");
  const r1 = await h.pump("test.mirror");
  assert.equal(r1.error, "nope");
  assert.deepEqual([r1.processed, r1.cursor, seen], [2, 2, ["a", "b"]]);
  h.close();
  const again = ProjectionHost.open({ path: file, space: "sp_1", projections: [cons] });
  assert.equal(again.consumerCursor("test.mirror"), 2, "the cursor survives a restart");
  failOn = null;
  const r2 = await again.pump("test.mirror");
  assert.deepEqual([r2.error, r2.processed, r2.cursor, seen], [undefined, 2, 4, ["a", "b", "c", "d"]]);
  assert.deepEqual((await again.drain()).map((r) => r.processed), [0]);
  again.close();
});

test("a consumer version bump replays it from event 1", async () => {
  const seen: string[] = [];
  const mk = (version: number): AsyncConsumer => ({ name: "test.m", version, mode: "async", rebuild: "replay", on: { "thing.added": (_tx, e) => { seen.push(payloadOf<{ k: string }>(e).k); } } });
  const file = path.join(dir(), "events.db");
  const a = ProjectionHost.open({ path: file, space: "sp_1", projections: [mk(1)] });
  a.append(ev("thing.added", { k: "a" }));
  await a.drain();
  a.close();
  const b = ProjectionHost.open({ path: file, space: "sp_1", projections: [mk(2)] });
  await b.drain();
  assert.deepEqual(seen, ["a", "a"]);
  b.close();
});
