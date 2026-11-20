// A check-in that failed for a passing trouble (the server stopped, no AI account yet) is tried again when an account is saved, and otherwise on the bounded backoff; once, never in a loop.
import test from "node:test";
import assert from "node:assert/strict";
import { LEAD, host, labGoal, step, world } from "../fixtures/world.ts";
import { onCleared } from "../handlers/events.ts";
import type { World } from "../fixtures/world.ts";

const claim = (w: World, e: { payload: Record<string, any> }) =>
  w.call("goals.wake_claim", { goalId: e.payload.goalId, wakeId: e.payload.wakeId, attempt: e.payload.attempt }, host); // eslint-disable-line @typescript-eslint/no-explicit-any
const saved = (w: World) => onCleared(w.ctx(host), { name: "vault.item_created", payload: { itemId: "vit_1" } });

test("restart with no account: the check-in failed with host_lost, then an account is saved and the check-in goes out at once, once", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal({ plan: [step("a", "Remind Lab 7")] }));
  await claim(w, w.woken()[0]!);
  const first = w.woken().length;
  await w.turn("turn.failed", { turnId: "trn_a", threadId: goal.threadId, agentId: LEAD, code: "host_lost" });
  assert.equal(w.woken().length, first, "the failed check-in waits out its backoff: nothing goes out yet");
  w.tick(10_000);
  await w.sweep();
  assert.equal(w.woken().length, first, "ten seconds later it still waits (the first wait is a minute)");

  assert.deepEqual(await saved(w), [goal.id], "an AI account was saved");
  assert.equal(w.woken().length, first + 1, "the check-in is asked again at once");
  // the same event again does nothing: the wake is with the agent now
  assert.deepEqual(await saved(w), []);
  assert.equal(w.woken().length, first + 1);

  // it fails again (still no account that can pay): the longer wait, not a loop
  await claim(w, w.woken().at(-1)!);
  await w.turn("turn.failed", { turnId: "trn_b", threadId: goal.threadId, agentId: LEAD, code: "host_lost" });
  assert.equal(w.woken().length, first + 1);
  w.tick(60_000);
  await w.sweep();
  assert.equal(w.woken().length, first + 1, "a minute later it still waits: the second wait is five");
  // a later account pulls it forward again; the clock alone would take the five minutes
  assert.deepEqual(await saved(w), [goal.id]);
  assert.equal(w.woken().length, first + 2);
});

test("a held goal and a goal that is not live are not touched by a saved account's retry pull", async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal({ plan: [step("a", "Remind Lab 7")] }));
  await claim(w, w.woken()[0]!);
  await w.turn("turn.failed", { turnId: "trn_a", threadId: goal.threadId, agentId: LEAD, code: "host_lost" });
  await w.call("goals.pause", { goalId: goal.id, reason: "wait" });
  const before = w.woken().length;
  assert.deepEqual(await saved(w), []);
  assert.equal(w.woken().length, before, "a paused goal is not asked");
});
