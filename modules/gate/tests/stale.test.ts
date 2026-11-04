// A held act nobody answered expires as Not sent: after 7 days, or when its chat or task closed. The call is never sent, the task closes, and the agent hears the denial with the plain reason.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { as, bot, parkInput } from "../fixtures/seed.ts";
import { NOTE_CHAT, NOTE_STALE, NOTE_TASK, STALE_MS, expireStaleHolds } from "../handlers/stale.ts";
import { findHold } from "../projections.ts";

const svc = { id: "svc_host", kind: "service" as const };
const DAY = 24 * 3_600_000;
const park = (h: ReturnType<typeof harness>, n: number, over: Record<string, unknown> = {}) => h.call("gate.park", parkInput({ input: { to: [`pat${n}@acme.test`], subject: `Retainer ${n}`, body: "Dear Pat." }, payloadHash: `ph_${n}`, decisionId: `dec_${n}`, ...over }), as(bot));

test("an approval that waited 7 days expires as Not sent, with its task closed and the agent told; a newer one stays", async () => {
  const h = harness();
  h.callee("threads.get", () => ({ thread: { threadId: "thr_1" } }));
  h.callee("tasks.get", () => ({ task: { state: "todo" } }));
  const old = await park(h, 1, { threadId: "thr_1" });
  h.advance(6 * DAY);
  const fresh = await park(h, 2, { threadId: "thr_1" });
  h.advance(DAY + 1000);
  assert.deepEqual(await expireStaleHolds(h.ctxFor(null, svc)), { dropped: 1 });
  assert.equal(findHold(h.db, old.holdId)!.state, "denied");
  assert.equal(findHold(h.db, fresh.holdId)!.state, "held");
  assert.deepEqual(h.callsTo("tasks.withdraw").map((c) => [c.input.taskId, c.input.note]), [[old.taskId, NOTE_STALE]]);
  const told = h.events.find((e) => e.name === "gate.denied");
  assert.deepEqual([told?.payload["holdId"], told?.payload["note"]], [old.holdId, NOTE_STALE], "the denial that wakes the parked turn carries the plain reason");
  assert.equal(STALE_MS, 7 * DAY);
  assert.ok(!/gate|hold/i.test(NOTE_STALE + NOTE_CHAT + NOTE_TASK), "no internal words in what people and agents read");
});

test("an approval whose chat was closed or gone, or whose task was closed, expires at once", async () => {
  const h = harness();
  h.callee("threads.get", (i: { threadId: string }) => (i.threadId === "thr_closed" ? { thread: { threadId: i.threadId, closedAt: 5 } } : i.threadId === "thr_gone" ? (() => { throw { error: { code: "validation.not_found" } }; })() : { thread: { threadId: i.threadId } }));
  h.callee("tasks.get", (i: { taskId: string }) => ({ task: { state: i.taskId === "tsk_x" ? "done" : "todo" } }));
  const a = await park(h, 1, { threadId: "thr_closed" });
  const b = await park(h, 2, { threadId: "thr_gone" });
  const c = await park(h, 3, { threadId: "thr_open" });
  h.callee("tasks.get", (i: { taskId: string }) => ({ task: { state: i.taskId === c.taskId ? "canceled" : "todo" } }));
  const d = await park(h, 4, { threadId: "thr_open" });
  const out = await expireStaleHolds(h.ctxFor(null, svc));
  assert.deepEqual(out, { dropped: 3 });
  assert.deepEqual([a, b, c, d].map((x) => findHold(h.db, x.holdId)!.state), ["denied", "denied", "denied", "held"]);
  assert.deepEqual(h.callsTo("tasks.withdraw").map((x) => x.input.note).sort(), [NOTE_CHAT, NOTE_CHAT, NOTE_TASK].sort());
  assert.deepEqual(await expireStaleHolds(h.ctxFor(null, svc)), { dropped: 0 }, "nothing more to expire");
});
