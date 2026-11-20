// A check-in that failed for a passing trouble (the server stopped, no AI account yet) is tried again when an account is saved, and otherwise on the bounded backoff; once, never in a loop.
import test from "node:test";
import assert from "node:assert/strict";
import { LEAD, host, labGoal, step, world } from "../fixtures/world.ts";
import { onCleared } from "../handlers/events.ts";
import type { World } from "../fixtures/world.ts";

const claim = (w: World, e: { payload: Record<string, any> }) =>
  w.call("goals.wake_claim", { goalId: e.payload.goalId, wakeId: e.payload.wakeId, attempt: e.payload.attempt }, host); // eslint-disable-line @typescript-eslint/no-explicit-any
const saved = (w: World) =>
  onCleared(w.ctx(host), { name: "vault.item_created", payload: { itemId: "vit_1", kind: "api_key" } });

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
    w.state.itemKinds["vit_1"] = "api_key";
    assert.deepEqual(
      await onCleared(w.ctx(host), { name, payload: { itemId: "vit_1", kind: "api_key", enabled: true } }),
      [goal.id],
      name,
    );
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

test("a shared subscription turned OFF clears nothing and asks nothing again; turned on it does", async () => {
  const off = await failedGoal();
  const before = off.w.woken().length;
  assert.deepEqual(
    await onCleared(off.w.ctx(host), { name: "engine.subscription_share_changed", payload: { enabled: false } }),
    [],
  );
  assert.deepEqual(
    await onCleared(off.w.ctx(host), { name: "engine.subscription_share_changed", payload: {} }),
    [],
    "no flag is not an on",
  );
  assert.equal(off.w.woken().length, before);
  assert.deepEqual(lines(off.w, off.goal.id), []);
  const on = await failedGoal();
  assert.deepEqual(
    await onCleared(on.w.ctx(host), { name: "engine.subscription_share_changed", payload: { enabled: true } }),
    [on.goal.id],
  );
  assert.match(lines(on.w, on.goal.id)[0]!, /an AI account was connected/);
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
  const connected = /an AI account was connected/;
  const saved = /an AI sign-in or key was saved, so it tried again/;
  // [event, payload, the kind the Vault says the item has (for an update), the line it must write or null for nothing]
  const cases: [string, Record<string, unknown>, string | undefined, RegExp | null][] = [
    ["provider.added", { providerId: "prv_1", connection: "subscription" }, undefined, connected],
    ["engine.subscription_share_changed", { enabled: true }, undefined, connected],
    ["engine.subscription_share_changed", { enabled: false }, undefined, null],
    ["vault.item_created", { itemId: "v", kind: "ai_subscription" }, undefined, connected],
    ["vault.item_created", { itemId: "v", kind: "api_key" }, undefined, saved],
    ["vault.item_created", { itemId: "v", kind: "login" }, undefined, null],
    ["vault.item_created", { itemId: "v", kind: "card" }, undefined, null],
    ["vault.item_created", { itemId: "v", kind: "note" }, undefined, null],
    ["vault.item_updated", { itemId: "v", fieldsChanged: ["token"] }, "api_key", saved],
    ["vault.item_updated", { itemId: "v", fieldsChanged: ["token"] }, "ai_subscription", saved],
    ["vault.item_updated", { itemId: "v", fieldsChanged: ["password"] }, "login", null],
    ["vault.item_updated", { itemId: "v", fieldsChanged: ["accessToken"] }, "other", null],
    ["vault.item_updated", { itemId: "v_unreadable", fieldsChanged: ["x"] }, undefined, saved],
    // the event carries its kind: a Mine item the Vault refuses to read for the host still counts
    ["vault.item_updated", { itemId: "v_unreadable", fieldsChanged: ["x"], kind: "api_key" }, undefined, saved],
    ["vault.item_updated", { itemId: "v_unreadable", fieldsChanged: ["x"], kind: "ai_subscription" }, undefined, saved],
    ["vault.item_updated", { itemId: "v_unreadable", fieldsChanged: ["x"], kind: "login" }, undefined, null],
  ];
  for (const [name, payload, kind, words] of cases) {
    const { w, goal } = await failedGoal();
    if (kind) w.state.itemKinds["v"] = kind;
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
