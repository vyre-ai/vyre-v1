// Check 1: server-authoritative op-log, filtered pull by cursor, idempotent push, newest-wins per field with loser history.
// Plus perf: 100k snapshot, 10k pull, local write latency, remote edit propagation over real HTTP + SSE hint.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { Server, Client, direct, hlcStr } from "./sync.mjs";
import { NodeDb, metric, pct } from "./adapters.mjs";

const op = (opId, id, fields, ms, dev, baseSeq = {}) => ({ opId, hlc: hlcStr(ms, 0, dev), id, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { v }])), baseSeq });

test("idempotent push: an op pushed three times yields one event", () => {
  const s = new Server();
  const o = op("a-1", "r1", { title: "hello" }, 1000, "a");
  const r1 = s.push("alice", [o]); const r2 = s.push("alice", [o]); const r3 = s.push("alice", [o, o]);
  assert.equal(s.p("SELECT COUNT(*) c FROM events WHERE kind='set'").get().c, 1);
  assert.deepEqual(r1.applied, r2.applied); assert.equal(r3.applied.length, 2);
  assert.equal(s.p("SELECT COUNT(*) c FROM field_history").get().c, 0);
});

test("newest hlc wins per field regardless of arrival order; loser kept in history", () => {
  const finals = [];
  for (const order of [["A", "B"], ["B", "A"]]) {
    const s = new Server(); s.push("alice", [op("seed", "r1", { title: "t0", note: "n0" }, 1, "a")]); s.grant("bob", "r1");
    const A = op("A", "r1", { title: "from A", note: "A note" }, 100, "a", { title: 1, note: 1 });
    const B = op("B", "r1", { title: "from B" }, 200, "b", { title: 1 });
    for (const k of order) s.push(k === "A" ? "alice" : "bob", [k === "A" ? A : B]);
    const rows = Object.fromEntries(s.p("SELECT field, v FROM rows WHERE id='r1'").all().map((r) => [r.field, r.v]));
    const hist = s.p("SELECT field, v, reason FROM field_history WHERE id='r1' ORDER BY v").all().map((h) => `${h.field}:${h.v}:${h.reason}`);
    finals.push(JSON.stringify({ rows, hist }));
    assert.equal(rows.title, '"from B"'); assert.equal(rows.note, '"A note"');
    assert.ok(hist.includes('title:"from A":lww_loser')); assert.ok(hist.includes('title:"t0":lww_loser'));
  }
  assert.equal(finals[0], finals[1]); // same state and same history set under both arrival orders
});

test("filtered pull by cursor: pages, only visible rows, protected field opens conflict", () => {
  const s = new Server();
  for (let i = 0; i < 10; i++) s.push("alice", [op("o" + i, "r" + i, { title: "t" + i }, 10 + i, "a")]);
  for (const i of [2, 5, 7]) s.grant("bob", "r" + i);
  let cursor = 0; const got = [];
  for (let g = 0; g < 100; g++) { const r = s.pull("bob", { cursor, limit: 3 }); for (const c of r.changes) got.push(c); cursor = r.next; if (!r.more) break; }
  assert.deepEqual([...new Set(got.map((c) => c.id))].sort(), ["r2", "r5", "r7"]);
  assert.ok(got.every((c) => c.op === "upsert"));
  assert.equal(s.pull("bob", { cursor, limit: 3 }).changes.length, 0);
  // protected concurrent edit
  const p1 = s.push("alice", [op("p1", "r2", { status: "open" }, 50, "a")]).applied[0].seq;
  s.push("alice", [op("p2", "r2", { status: "closed" }, 60, "a", { status: p1 })]); // saw p1: not concurrent
  const r = s.push("bob", [op("p3", "r2", { status: "won" }, 70, "b", { status: p1 })]); // also based on p1: concurrent with p2
  assert.equal(r.conflicts.length, 1);
  assert.equal(JSON.parse(s.p("SELECT v FROM rows WHERE id='r2' AND field='status'").get().v), "closed");
  assert.equal(s.p("SELECT COUNT(*) c FROM conflicts").get().c, 1);
});

test("hlc skew: a client hlc more than 5 minutes ahead is clamped and recorded", () => {
  const s = new Server(":memory:", { now: () => 1_000_000 });
  const r = s.push("alice", [op("x", "r1", { title: "t" }, 1_000_000 + 3_600_000, "a")]);
  assert.ok(r.applied[0].skew >= 3_600_000);
  assert.ok(s.p("SELECT hlc FROM rows WHERE id='r1'").get().hlc.startsWith(hlcStr(1_000_000, 0, "").slice(0, 12)));
});

