import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LogStore, LogClient, LogError, GENERATED_COLUMNS, hashOf } from "../src/log/index.ts";
import type { NewEvent } from "../src/log/index.ts";
import { formatHlc, parseHlc, compareHlc } from "../../lib/hlc.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-log-"));
const ev = (i: number, over: Partial<NewEvent> = {}): NewEvent => ({
  type: "record.updated", sv: 1, trace_id: TRACE, actor: "usr_dana", vis: "space",
  entity: "rec", entity_id: `r${i % 3}`, fields: ["name"], payload: { i }, ...over,
});
function fresh(n = 0, clock?: () => number) {
  const file = path.join(dir(), "events.db");
  const store = new LogStore({ db: new DatabaseSync(file), space: "sp_1", ...(clock ? { clock } : {}) });
  for (let i = 0; i < n; i += 10) store.appendBatch(Array.from({ length: Math.min(10, n - i) }, (_, j) => ev(i + j)));
  return { file, store };
}

test("a clean log verifies: gap-free seq from 1, head matches", () => {
  const { store } = fresh(50);
  assert.equal(store.count(), 50);
  const v = store.verify();
  assert.equal(v.ok, true);
  if (v.ok) { assert.equal(v.seq, 50); assert.equal(v.head, store.head.hash); }
  assert.deepEqual(store.read({ limit: 1000 }).map((e) => e.seq), Array.from({ length: 50 }, (_, i) => i + 1));
  assert.equal(store.verify({ from: 40, prev: store.get(40)!.hash }).ok, true, "verify can start from a trusted checkpoint");
});

test("tamper: an edited envelope is found at its seq", () => {
  const { store } = fresh(50);
  store.db.exec(`UPDATE events SET event = replace(event, '"depth":0', '"depth":9') WHERE seq = 10`);
  const v = store.verify();
  assert.equal(v.ok, false);
  if (!v.ok) { assert.equal(v.at, 10); assert.match(v.why, /hash/); }
});

test("tamper: a re-hashed envelope still breaks the next link", () => {
  const { store } = fresh(30);
  const row = store.db.prepare("SELECT event FROM events WHERE seq = 5").get() as { event: string };
  const e = JSON.parse(row.event);
  e.actor = "usr_mallory";
  e.hash = hashOf(e); // the forger's best move: recompute this event's own hash
  store.db.prepare("UPDATE events SET event = ? WHERE seq = 5").run(JSON.stringify(e));
  const v = store.verify();
  assert.equal(v.ok, false);
  if (!v.ok) { assert.equal(v.at, 6); assert.match(v.why, /prev/); }
});

test("tamper: a deleted row is a seq gap; a cut tail is a short log", () => {
  const a = fresh(40);
  a.store.db.exec("DELETE FROM events WHERE seq = 20");
  const gap = a.store.verify();
  assert.equal(gap.ok, false);
  if (!gap.ok) { assert.ok(gap.at >= 20 && gap.at <= 21); assert.match(gap.why, /contiguous/); }
  const b = fresh(40);
  b.store.db.exec("DELETE FROM events WHERE seq = 40");
  const cut = b.store.verify();
  assert.equal(cut.ok, false);
  if (!cut.ok) assert.match(cut.why, /shorter/);
});

test("payload edits and erasure leave the chain intact but break the commitment", () => {
  const { store } = fresh(10);
  assert.equal(store.proves(3), true);
  store.db.prepare("UPDATE events SET payload = ? WHERE seq = 3").run(new TextEncoder().encode('{"i":999}'));
  assert.equal(store.verify().ok, true, "the chain covers the commit, not the payload bytes");
  assert.equal(store.proves(3), false, "an edited payload no longer matches its commit");
  assert.equal(store.proves(4), true);
  assert.equal(store.erase(4), true);
  assert.equal(store.proves(4), false);
  assert.equal(new TextDecoder().decode(store.get(4)!.payload), '{"erased":true}');
  assert.equal(store.verify().ok, true);
  assert.equal(store.erase(999), false);
});

test("indexed columns are generated from the event, so a database edit cannot disagree with it", () => {
  const { store } = fresh(6);
  for (const c of ["type", "entity", "entity_id", "trace_id", "run_id", "vis", "label", "origin", "hash"]) assert.ok(GENERATED_COLUMNS.includes(c), c);
  const row = store.db.prepare("SELECT type, entity_id, vis, label, hash FROM events WHERE seq = 2").get() as Record<string, unknown>;
  assert.equal(row.type, "record.updated");
  assert.equal(row.entity_id, "r1");
  assert.equal(row.vis, "space");
  assert.equal(row.label, 0);
  assert.equal(row.hash, store.get(2)!.hash);
  assert.throws(() => store.db.exec("UPDATE events SET type = 'x.y' WHERE seq = 2"), /generated/i);
});

test("re-appending an id writes nothing and returns the stored event", () => {
  const { store } = fresh(3);
  const first = store.appendBatch([ev(1, { id: "evt_fixed_0001" })])[0]!;
  assert.ok(first.ok && !first.duplicate);
  const again = store.appendBatch([ev(1, { id: "evt_fixed_0001" }), ev(2, { id: "evt_fixed_0001" })]);
  assert.ok(again.every((r) => r.ok && r.duplicate));
  assert.equal(store.count(), 4);
  assert.equal((again[0] as { event: { seq: number } }).event.seq, (first as { event: { seq: number } }).event.seq);
});

test("a malformed event is refused alone and the rest of its batch commits", () => {
  const { store } = fresh(0);
  const r = store.appendBatch([ev(1), { ...ev(2), type: "NotAType" }, ev(3), { ...ev(4), trace_id: "short" }, { ...ev(5), vis: "everyone" as never }]);
  assert.deepEqual(r.map((x) => x.ok), [true, false, true, false, false]);
  assert.equal(store.count(), 2);
  assert.deepEqual(store.read().map((e) => e.seq), [1, 2]);
  assert.equal(store.verify().ok, true);
});

test("hlc: a client value more than 5 minutes ahead is clamped and the skew recorded; server hlcs keep rising", () => {
  const NOW = 1_800_000_000_000;
  const { store } = fresh(0, () => NOW);
  const ahead = formatHlc({ ms: NOW + 3_600_000, counter: 7, deviceId: "devA" });
  const [a] = store.appendBatch([ev(0, { hlc: ahead })]);
  const [b] = store.appendBatch([ev(1)]);
  assert.ok(a!.ok && b!.ok);
  const ea = (a as { event: { hlc: string; skew_ms?: number } }).event, eb = (b as { event: { hlc: string } }).event;
  assert.equal(parseHlc(ea.hlc)!.ms, NOW);
  assert.equal(ea.skew_ms, 3_600_000);
  assert.ok(compareHlc(parseHlc(ea.hlc)!, parseHlc(eb.hlc)!) < 0);
  const ok = store.appendBatch([ev(2, { hlc: formatHlc({ ms: NOW + 1000, counter: 0, deviceId: "devA" }) })])[0] as { event: { skew_ms?: number } };
  assert.equal(ok.event.skew_ms, undefined, "inside the bound passes untouched");
  const bad = store.appendBatch([ev(3, { hlc: "garbage" })])[0]!;
  assert.equal(bad.ok, false);
});

test("reopening continues the same chain; another space is refused", () => {
  const { file, store } = fresh(12);
  const head = store.head;
  store.close();
  const again = new LogStore({ db: new DatabaseSync(file), space: "sp_1" });
  assert.deepEqual(again.head, head);
  again.appendBatch([ev(100)]);
  assert.equal(again.head.seq, 13);
  assert.equal(again.verify().ok, true);
  again.close();
  assert.throws(() => new LogStore({ db: new DatabaseSync(file), space: "sp_other" }), (e: unknown) => e instanceof LogError && e.code === "wrong_space");
});

test("per-chat sequence replay: interleaved chats read back in order, resumable from a cursor with no gap or repeat", async () => {
  const file = path.join(dir(), "events.db");
  const log = await LogClient.open({ path: file, space: "sp_1" });
  try {
    const chats = ["thr_a", "thr_b", "thr_c"];
    const counter: Record<string, number> = { thr_a: 0, thr_b: 0, thr_c: 0 };
    const sent: Promise<unknown>[] = [];
    for (let i = 0; i < 90; i++) {
      const c = chats[(i * 7 + (i >> 2)) % 3]!;
      counter[c]!++;
      sent.push(log.append(ev(i, { type: "message.created", entity: "thread", entity_id: c, payload: { chat: c, n: counter[c] } })));
    }
    const evs = await Promise.all(sent);
    assert.equal(evs.length, 90);
    for (const c of chats) {
      const all = await log.read({ entity: "thread", entity_id: c, limit: 1000 });
      assert.equal(all.length, counter[c]);
      assert.deepEqual(all.map((e) => JSON.parse(new TextDecoder().decode(e.payload)).n), Array.from({ length: counter[c]! }, (_, i) => i + 1), `${c}: n is 1..N in order`);
      // replay "everything after N": read half, then resume from the last seq seen
      const half = await log.read({ entity: "thread", entity_id: c, limit: Math.floor(all.length / 2) });
      const rest = await log.read({ entity: "thread", entity_id: c, after: half[half.length - 1]!.seq, limit: 1000 });
      assert.deepEqual([...half, ...rest].map((e) => e.seq), all.map((e) => e.seq), `${c}: resume has no gap and no repeat`);
    }
    assert.equal((await log.read({ type: "message.*", limit: 1000 })).length, 90);
    assert.equal((await log.read({ type: "record.*", limit: 1000 })).length, 0);
    const v = await log.verify();
    assert.equal(v.ok, true);
    assert.equal((await log.currentHead()).seq, 90);
  } finally { await log.close(); }
});

test("group commit: 200 concurrent appends all land once, seqs are 1..200, the chain verifies", async () => {
  const log = await LogClient.open({ path: path.join(dir(), "events.db"), space: "sp_1" });
  try {
    const out = await Promise.all(Array.from({ length: 200 }, (_, i) => log.append(ev(i))));
    assert.deepEqual(out.map((e) => e.seq).sort((a, b) => a - b), Array.from({ length: 200 }, (_, i) => i + 1));
    assert.equal((await log.verify()).ok, true);
    await assert.rejects(log.append({ ...ev(1), type: "bad" }), (e: unknown) => e instanceof LogError && e.code === "bad_event");
  } finally { await log.close(); }
});
