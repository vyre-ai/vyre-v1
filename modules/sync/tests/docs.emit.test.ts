// @reads /modules/sync/migrations/0001_pull.sql
// sync.doc.update puts doc.updated in the Space log, in the same commit as the seq it answers (ruling 76). The document server's own `append` writes the sync module's store; the capability's
// emit is what reaches the Space log, so the handler must call it. The "log" here is what the capability's emit collects, which is what the host commits with the call.
import test from "node:test";
import assert from "node:assert/strict";
import { toB64 } from "../docs/index.ts";
import { ADA, docRig, edit, TRACE } from "./docs.rig.test.ts";
import { createDocHandlers } from "../handlers/docs.ts";

const OWNER = { entity: "note", id: "n1" };

function caller() {
  const log: { name: string; subject: string; payload: Record<string, unknown> }[] = [];
  return { log, ctx: { trace: { traceId: TRACE }, principal: ADA, emit: (name: string, subject: string, payload: unknown) => { log.push({ name, subject, payload: payload as Record<string, unknown> }); } } };
}

test("an accepted update emits one doc.updated with the doc id, the size, the actor and the seq it answered", async () => {
  const rig = docRig();
  rig.allow("not_a", [ADA], { owner: OWNER });
  const h = createDocHandlers(rig.server);
  const { log, ctx } = caller();
  const bytes = edit([], 0, "alpha secret text");
  const out = await h["sync.doc.update"](ctx, { doc: "not_a", update: toB64(bytes) });
  assert.deepEqual(out, { seq: 1 });
  assert.equal(log.length, 1);
  assert.deepEqual(log[0], { name: "doc.updated", subject: "not_a", payload: { doc: "not_a", bytes: bytes.length, actor: ADA, seq: 1 } });
  assert.ok(!JSON.stringify(log).includes("secret"), "no content in the event");
  const second = await h["sync.doc.update"](ctx, { doc: "not_a", update: toB64(edit([bytes], 0, "beta ")) });
  assert.equal(second.seq, 2);
  assert.deepEqual(log.map((e) => e.payload["seq"]), [1, 2], "one event per accepted update, seq in step with the answer");
});

test("an empty update and a refused update emit nothing", async () => {
  const rig = docRig();
  rig.allow("not_a", [ADA], { owner: OWNER });
  const h = createDocHandlers(rig.server);
  const { log, ctx } = caller();
  await h["sync.doc.update"](ctx, { doc: "not_a", update: toB64(new Uint8Array([0, 0])) });
  assert.equal(log.length, 0, "an update that changes nothing is not an event");
  await assert.rejects(() => h["sync.doc.update"](ctx, { doc: "not_missing", update: toB64(edit([], 0, "x")) }));
  assert.equal(log.length, 0, "a refused update is not an event");
});

test("a caller with no emit still works (the server's own store keeps its copy)", async () => {
  const rig = docRig();
  rig.allow("not_a", [ADA], { owner: OWNER });
  const h = createDocHandlers(rig.server);
  assert.deepEqual(await h["sync.doc.update"]({ trace: { traceId: TRACE }, principal: ADA }, { doc: "not_a", update: toB64(edit([], 0, "alpha")) }), { seq: 1 });
  assert.equal(rig.events.filter((e) => e.type === "doc.updated").length, 1);
});
