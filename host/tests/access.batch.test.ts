// The access events the host hands to access.sync, in the log's order (host/src/daemon/access.ts accessBatch; review of #905, finding 1). The store skips anything at or below its cursor, so
// a suspension at seq 41 handed over after a new record at seq 42 was lost for good. The batch is read from the log after what was folded, so the order of the pushes no longer matters.
import test from "node:test";
import assert from "node:assert/strict";
import { accessBatch } from "../src/daemon/access.ts";

const enc = (o: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(o));
type Ev = { seq: number; type: string; payload: unknown };
const LOG = [
  { seq: 40, type: "record.created", payload: enc({}) },
  { seq: 41, type: "principal.suspended", payload: enc({ principalId: "svc_x" }) },
  { seq: 42, type: "resource.created", payload: enc({ id: "rec_1", type: "record" }) },
  { seq: 43, type: "chat.posted", payload: enc({}) },
];
const read = (log: typeof LOG) => async (after: number, limit: number) => log.filter((e) => e.seq > after).slice(0, limit);
const seqs = (es: readonly Ev[]): number[] => es.map((e) => e.seq);

test("a push of 42 before 41 hands both over, in seq order, in one batch; the late push of 41 adds nothing", async () => {
  const pushed: Ev[] = [{ seq: 42, type: "resource.created", payload: { id: "rec_1", type: "record" } }];
  const one = await accessBatch({ held: pushed, fedTo: 39, booted: true, read: read(LOG) });
  assert.deepEqual(seqs(one.events), [41, 42]);
  assert.equal(one.upTo, 43);
  assert.deepEqual(one.events[0]?.payload, { principalId: "svc_x" }, "decoded from the log");
  const two = await accessBatch({ held: [{ seq: 41, type: "principal.suspended", payload: { principalId: "svc_x" } }], fedTo: one.upTo, booted: true, read: read(LOG) });
  assert.deepEqual(seqs(two.events), [], "41 was already handed over in order");
});

test("across batches: events committed after a batch come in the next one, in order", async () => {
  const log = LOG.slice(0, 3);
  const one = await accessBatch({ held: [{ seq: 42, type: "resource.created", payload: {} }], fedTo: 39, booted: true, read: read(log) });
  assert.deepEqual(seqs(one.events), [41, 42]);
  log.push({ seq: 44, type: "grant.revoked", payload: enc({ grantId: "gr_1" }) }, { seq: 45, type: "member.removed", payload: enc({ personId: "usr_a" }) });
  const two = await accessBatch({ held: [{ seq: 45, type: "member.removed", payload: {} }], fedTo: one.upTo, booted: true, read: read(log) });
  assert.deepEqual(seqs(two.events), [44, 45], "the revoke whose push has not come yet is in it too");
});

test("at start: the boot replay (already read from the log) goes first in order, the host's own seq -1 objects go last, and nothing is handed over twice", async () => {
  const held: Ev[] = [
    { seq: -1, type: "resource.created", payload: { id: "contact", type: "record_type" } },
    { seq: 42, type: "resource.created", payload: {} }, { seq: 41, type: "principal.suspended", payload: {} },
  ];
  const b = await accessBatch({ held, fedTo: 43, booted: false, read: read(LOG) });
  assert.deepEqual(seqs(b.events), [41, 42, -1]);
  assert.deepEqual(seqs(b.boot), [-1, 42, 41], "what is kept for a retry if the module cannot take it");
  // once a sync has folded, a stray push at or below what was folded is dropped; seq -1 objects still go
  const later = await accessBatch({ held, fedTo: 43, booted: true, read: read(LOG) });
  assert.deepEqual(seqs(later.events), [-1]);
});
