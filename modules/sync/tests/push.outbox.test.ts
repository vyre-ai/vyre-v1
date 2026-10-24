// The device outbox (ARCH 5.4, 5.10): ops with stable ids, base seqs and `after` links, ordered batches, retry with backoff, and settling from a push result. Run on both stores.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { parseHlc, compareHlc } from "../../../lib/hlc.ts";
import { MAX_PUSH_OPS, parsePushReq } from "../../../sync/src/protocol.ts";
import type { PushRes } from "../../../sync/src/protocol.ts";
import { BACKOFF_CAP_MS, createOutbox, defaultBackoff, memoryOutboxStore, sqlOutboxStore } from "../../../sync/src/outbox/index.ts";
import type { OutboxStore } from "../../../sync/src/outbox/index.ts";

const DDL = `
CREATE TABLE pending_ops (n INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT UNIQUE, trace_id TEXT, hlc TEXT, cap TEXT, v INTEGER, entity TEXT, id TEXT, input BLOB, base_seq TEXT, state TEXT, tries INTEGER, last_error TEXT, at INTEGER);
CREATE TABLE rejected (op_id TEXT PRIMARY KEY, error BLOB, copy_out BLOB, at INTEGER);`;

function sqlite(file = ":memory:"): { store: OutboxStore; db: DatabaseSync } {
  const db = new DatabaseSync(file);
  db.exec(DDL);
  return { db, store: sqlOutboxStore({ run: (sql, p) => { db.prepare(sql).run(...p); }, all: (sql, p) => db.prepare(sql).all(...p) as Record<string, unknown>[] }) };
}

const NOW = 1_760_000_000_000;
const res = (over: Partial<PushRes>): PushRes => ({ applied: [], rejected: [], conflicts: [], held: [], serverHlc: "000000000001-0000-srv", ...over });

for (const [name, make] of [["memory", () => ({ store: memoryOutboxStore() })], ["sqlite pending_ops", () => sqlite()]] as const) {
  const mk = () => {
    let t = NOW, n = 0;
    const { store } = make();
    const ob = createOutbox({ store, deviceId: "dev_a", now: () => t, newOpId: () => `op${++n}`, newTraceId: () => "0123456789abcdef0123456789abcdef" });
    return { ob, store, advance: (ms: number) => { t += ms; } };
  };
  const patch = (f: string, v: unknown) => ({ cap: "records.update", entity: "contact", id: "c1", input: { fields: { [f]: v } } });

  test(`${name}: enqueue gives a stable id, an increasing hlc and the version the person edited`, () => {
    const { ob } = mk();
    const a = ob.enqueue({ ...patch("name", "B"), seqOf: { name: 7 } });
    const b = ob.enqueue({ ...patch("stage", "won"), seqOf: { stage: 9 } });
    assert.deepEqual([a.opId, b.opId], ["op1", "op2"]);
    assert.ok(compareHlc(parseHlc(a.hlc)!, parseHlc(b.hlc)!) < 0, "hlc grows even inside one millisecond");
    assert.deepEqual(a.baseSeq, { name: 7 });
    assert.deepEqual(b.baseSeq, { stage: 9 });
    assert.equal(a.after, undefined);
    assert.equal(ob.pending(), 2);
    assert.ok(parsePushReq({ deviceId: "dev_a", epoch: 0, ops: ob.batch() }).ok, "the batch is a valid push");
  });

  test(`${name}: a second edit of a queued field keeps the first edit's base and names it in \`after\``, () => {
    const { ob } = mk();
    const one = ob.enqueue({ ...patch("name", "B"), seqOf: { name: 7 } });
    const two = ob.enqueue({ ...patch("name", "C"), seqOf: { name: 7 } });
    const three = ob.enqueue({ ...patch("name", "D"), seqOf: { name: 99 } });
    assert.deepEqual(two.baseSeq, { name: 7 });
    assert.deepEqual(two.after, { name: one.opId });
    assert.deepEqual(three.baseSeq, { name: 7 }, "the base is the first queued op's, whatever the caller saw since");
    assert.deepEqual(three.after, { name: two.opId });
    const other = ob.enqueue({ cap: "records.update", entity: "contact", id: "c2", input: { fields: { name: "x" } }, seqOf: { name: 3 } });
    assert.deepEqual(other.baseSeq, { name: 3 });
    assert.equal(other.after, undefined, "another row is not linked");
    const mixed = ob.enqueue({ ...patch("stage", "won"), seqOf: { stage: 4 } });
    assert.deepEqual(mixed.baseSeq, { stage: 4 });
    assert.equal(mixed.after, undefined, "another field of the same row is not linked");
  });

  test(`${name}: a call that is not a patch carries no base and no link`, () => {
    const { ob } = mk();
    const op = ob.enqueue({ cap: "chat.send", v: 3, input: { thread: "t1", body: "hi" } });
    assert.deepEqual(op.baseSeq, {});
    assert.equal(op.v, 3);
    assert.equal(op.entity, undefined);
  });

  test(`${name}: batch is in order and at most 200`, () => {
    const { ob } = mk();
    for (let i = 0; i < 250; i++) ob.enqueue({ cap: "chat.send", input: { i } });
    const b = ob.batch();
    assert.equal(b.length, MAX_PUSH_OPS);
    assert.deepEqual(b.map((o) => (o.input as { i: number }).i), Array.from({ length: 200 }, (_, i) => i));
    assert.equal(ob.batch(5).length, 5);
  });

  test(`${name}: applied ops leave, refused ops move to Rejected with their values, held ops wait`, () => {
    const { ob, store } = mk();
    const a = ob.enqueue(patch("name", "B"));
    const b = ob.enqueue(patch("stage", "won"));
    const c = ob.enqueue({ cap: "chat.send", input: { x: 1 } });
    const d = ob.enqueue({ cap: "chat.send", input: { x: 2 } });
    const ack = ob.acknowledge(res({
      applied: [{ opId: a.opId, seq: 11 }],
      rejected: [{ opId: b.opId, error: { code: "permission.no_grant", message: "No access." }, copyOut: { stage: "won" } }],
      held: [{ opId: c.opId, taskId: "tsk_1" }],
      conflicts: [{ id: "cfl_1", entity: "contact", rowId: "c1", field: "name", state: "open" }],
    }));
    assert.deepEqual(ack.applied, [a.opId]);
    assert.equal(ack.conflicts.length, 1);
    assert.deepEqual(ob.batch().map((o) => o.opId), [d.opId], "held and settled ops are not sent again");
    assert.equal(ob.pending(), 2, "the held op and the next one");
    const rej = store.rejected();
    assert.equal(rej.length, 1);
    assert.equal(rej[0]!.opId, b.opId);
    assert.deepEqual(rej[0]!.copyOut, { stage: "won" });
    assert.equal((rej[0]!.error as { code: string }).code, "permission.no_grant");
    ob.settleHeld(c.opId);
    assert.equal(ob.pending(), 1);
  });

  test(`${name}: a failed push keeps the same ids and backs off, and a delayed op holds back the ones after it`, () => {
    const { ob, advance } = mk();
    const a = ob.enqueue({ cap: "chat.send", input: { i: 1 } });
    const b = ob.enqueue({ cap: "chat.send", input: { i: 2 } });
    ob.failed([a.opId, b.opId], "offline");
    assert.deepEqual(ob.batch(), [], "both wait");
    assert.equal(ob.nextDue(), NOW + 500);
    advance(499);
    assert.deepEqual(ob.batch(), []);
    advance(1);
    assert.deepEqual(ob.batch().map((o) => o.opId), [a.opId, b.opId], "same ids as before");
    ob.failed([a.opId], "offline");
    advance(999);
    assert.deepEqual(ob.batch(), [], "a delayed first op holds back the second, so order never breaks");
    advance(1);
    assert.equal(ob.batch().length, 2);
  });
}

test("backoff doubles from 500 ms and stops at 30 s", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(defaultBackoff), [500, 1000, 2000, 4000, 8000]);
  assert.equal(defaultBackoff(20), BACKOFF_CAP_MS);
});

test("the device clock follows the server: after observe the next hlc is later than the server's", () => {
  let t = NOW;
  const ob = createOutbox({ store: memoryOutboxStore(), deviceId: "dev_a", now: () => t });
  const first = ob.enqueue({ cap: "chat.send", input: {} });
  const ahead = (NOW + 120_000).toString(16).padStart(12, "0") + "-0004-srv";
  ob.observe(ahead);
  const next = ob.enqueue({ cap: "chat.send", input: {} });
  assert.ok(compareHlc(parseHlc(next.hlc)!, parseHlc(ahead)!) > 0);
  assert.ok(compareHlc(parseHlc(first.hlc)!, parseHlc(next.hlc)!) < 0);
  t -= 1_000_000;
  const back = ob.enqueue({ cap: "chat.send", input: {} });
  assert.ok(compareHlc(parseHlc(back.hlc)!, parseHlc(next.hlc)!) > 0, "a clock set backwards never issues a smaller hlc");
});

test("sqlite: the queue survives a restart, with ids, bases and links intact", () => {
  const { store } = sqlite();
  const t = NOW;
  const first = createOutbox({ store, deviceId: "dev_a", now: () => t, newOpId: (() => { let n = 0; return () => `op${++n}`; })() });
  first.enqueue({ cap: "records.update", entity: "contact", id: "c1", input: { fields: { name: "B" } }, seqOf: { name: 7 } });
  const two = first.enqueue({ cap: "records.update", entity: "contact", id: "c1", input: { fields: { name: "C" } }, seqOf: { name: 7 }, enc: { key: "k", nonce: "n" } });
  const again = createOutbox({ store, deviceId: "dev_a", now: () => t, lastHlc: two.hlc });
  const ops = again.batch();
  assert.deepEqual(ops.map((o) => o.opId), ["op1", "op2"]);
  assert.deepEqual(ops[1]!.baseSeq, { name: 7 });
  assert.deepEqual(ops[1]!.after, { name: "op1" });
  assert.deepEqual(ops[1]!.enc, { key: "k", nonce: "n" });
  assert.deepEqual(ops[1]!.input, { fields: { name: "C" } });
  const after = again.enqueue({ cap: "chat.send", input: {} });
  assert.ok(compareHlc(parseHlc(after.hlc)!, parseHlc(two.hlc)!) > 0, "the clock continues from where it was");
});

test("sqlite: a bare base map from an older writer is read as the base", () => {
  const { store, db } = sqlite();
  db.prepare("INSERT INTO pending_ops (op_id, trace_id, hlc, cap, v, entity, id, input, base_seq, state, tries, last_error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, NULL, ?)")
    .run("old1", "0123456789abcdef0123456789abcdef", "00000000000a-0000-dev_a", "records.update", 1, "contact", "c1", '{"fields":{"name":"x"}}', '{"name":4}', 1);
  const row = store.queued()[0]!;
  assert.deepEqual(row.op.baseSeq, { name: 4 });
  assert.equal(row.op.after, undefined);
});
