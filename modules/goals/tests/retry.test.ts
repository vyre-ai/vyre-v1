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

test("every way an AI account can arrive asks the waiting check-in again: a pasted key, a subscription sign-in and a Space key (provider.added), a shared subscription, a saved vault item", async () => {
  for (const name of [
    "provider.added",
    "engine.subscription_share_changed",
    "vault.item_created",
    "vault.item_updated",
  ]) {
    const w = world({ count: 10 });
    const { goal } = await w.call("goals.create", labGoal({ plan: [step("a", "Remind Lab 7")] }));
    await claim(w, w.woken()[0]!);
    await w.turn("turn.failed", { turnId: "trn_a", threadId: goal.threadId, agentId: LEAD, code: "host_lost" });
    const before = w.woken().length;
    assert.deepEqual(await onCleared(w.ctx(host), { name, payload: {} }), [goal.id], name);
    assert.equal(w.woken().length, before + 1, name);
  }
  const impl = (await import("../impl.ts")) as { consumers: Record<string, { on: string[] }> };
  for (const name of [
    "provider.added",
    "engine.subscription_share_changed",
    "vault.item_created",
    "vault.item_updated",
  ])
    assert.ok(impl.consumers["goals.cleared"]!.on.includes(name), `goals.cleared listens to ${name}`);
});

const lines = (w: World, goalId: string): string[] =>
  (
    w.db.all(
      "SELECT text FROM goals_activity WHERE goal_id = ? AND kind = 'wake' AND text LIKE '%asked to check in again%'",
      goalId,
    ) as { text: string }[]
  ).map((r) => r.text);
const failedGoal = async () => {
  const w = world({ count: 10 });
  const { goal } = await w.call("goals.create", labGoal({ plan: [step("a", "Remind Lab 7")] }));
  await claim(w, w.woken()[0]!);
  await w.turn("turn.failed", { turnId: "trn_a", threadId: goal.threadId, agentId: LEAD, code: "host_lost" });
  return { w, goal };
};

test("the activity line says only what is true for the event: an AI account was connected, or a key was saved; an item that is not an account pulls nothing forward", async () => {
  const cases: [string, Record<string, unknown>, RegExp | null][] = [
    ["provider.added", { providerId: "prv_1", connection: "subscription" }, /an AI account was connected/],
    ["engine.subscription_share_changed", {}, /an AI account was connected/],
    ["vault.item_created", { itemId: "v", kind: "ai_subscription" }, /an AI account was connected/],
    ["vault.item_created", { itemId: "v", kind: "api_key" }, /a key was saved, so it tried again/],
    [
      "vault.item_updated",
      { itemId: "v", fieldsChanged: ["token"], settingsChanged: [] },
      /a key was saved, so it tried again/,
    ],
    ["vault.item_created", { itemId: "v", kind: "login" }, null],
    ["vault.item_created", { itemId: "v", kind: "card" }, null],
    ["vault.item_created", { itemId: "v", kind: "note" }, null],
  ];
  for (const [name, payload, words] of cases) {
    const { w, goal } = await failedGoal();
    const before = w.woken().length;
    const out = await onCleared(w.ctx(host), { name, payload });
    if (words === null) {
      assert.deepEqual(out, [], `${name} ${JSON.stringify(payload)} is not an account`);
      assert.equal(w.woken().length, before);
      assert.deepEqual(lines(w, goal.id), []);
    } else {
      assert.deepEqual(out, [goal.id], name);
      assert.equal(w.woken().length, before + 1);
      const said = lines(w, goal.id);
      assert.equal(said.length, 1, "one line");
      assert.match(said[0]!, words, `${name}: ${said[0]}`);
      assert.doesNotMatch(said[0]!, /AI account was saved/, "the old claim is gone");
    }
  }
});
