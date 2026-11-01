// Grants (chat design, holes 1 and 3): rows only a person's press or own message writes, voided by any edit, spent once, matched by the Gate at act time.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { HOUR, alice, as, bob, bot } from "../fixtures/seed.ts";

const gate = { id: alice.id, kind: "person" as const, origin: "gate", depth: 0 };
const set = (h: Harness, who: unknown, over: Record<string, unknown> = {}) => h.call("gate.grants.set", {
  automationId: "aut_0123456789abcdef0123456789abcdef", defHash: "h1", press: "save", steps: [{ stepId: "letter", act: "send", targets: ["lee@acme.test"], computed: false, changed: true }], ...over,
}, who as never);
const stepTake = (h: Harness, targets: string[], defHash = "h1") => h.call("gate.grants.take", { act: "send", targets, step: { automationId: "aut_0123456789abcdef0123456789abcdef", nodeId: "letter", defHash } }, gate);
const ask = (h: Harness, messageId: string, asked: { act: string; target: string }[], threadId = "thr_chat", who: unknown = alice) => h.call("gate.grants.ask", { threadId, messageId, asked }, who as never);
const take = (h: Harness, targets: string[], threads = ["thr_chat"], act = "send") => h.call("gate.grants.take", { act, targets, turn: { person: alice.id, threads } }, gate);
const granted = async (p: Promise<{ granted: boolean }>): Promise<boolean> => (await p).granted;

test("a person's press writes a row; the definition hash voids it", async () => {
  const h = harness();
  assert.equal((await set(h, alice)).grants.length, 1);
  assert.equal(await granted(stepTake(h, ["lee@acme.test"])), true);
  assert.equal(await granted(stepTake(h, ["lee@acme.test"], "h2")), false, "any edit voids it, whatever path made the edit");
  assert.equal(await granted(stepTake(h, ["new@acme.test"])), false, "a new target is not covered");
  assert.equal(await granted(stepTake(h, ["lee@acme.test", "new@acme.test"])), false, "every target must be covered");
  assert.equal(await granted(stepTake(h, [])), false, "a call that names none is not covered by a row that names one");
});

test("an agent's save writes nothing and clears what was there", async () => {
  const h = harness();
  await set(h, alice);
  assert.deepEqual((await set(h, as(bot, { actingFor: alice.id }))).grants, []);
  assert.equal(await granted(stepTake(h, ["lee@acme.test"])), false);
});

test("Turn on names what a step names; only a step the person wrote covers what it computes", async () => {
  const h = harness();
  const computed = { stepId: "letter", act: "send", targets: [], computed: true, changed: false };
  assert.deepEqual((await set(h, alice, { press: "on", steps: [computed] })).grants, [], "Turn on does not hand over a computed target");
  assert.equal(await granted(stepTake(h, ["any@acme.test"])), false);
  assert.deepEqual((await set(h, alice, { press: "save", steps: [{ ...computed, changed: true }] })).grants.map((g: { target: string }) => g.target), ["*"]);
  assert.equal(await granted(stepTake(h, ["any@acme.test"])), true);
});

test("a save keeps the row of a step it did not touch, and gives none to a step an agent wrote", async () => {
  const h = harness();
  await set(h, alice);
  const same = { stepId: "letter", act: "send", targets: ["lee@acme.test"], computed: false, changed: false };
  const theirs = { stepId: "other", act: "send", targets: ["sam@acme.test"], computed: false, changed: false };
  const rows = (await set(h, alice, { defHash: "h2", steps: [same, theirs] })).grants;
  assert.deepEqual(rows.map((g: { stepId: string; target: string }) => [g.stepId, g.target]), [["letter", "lee@acme.test"]]);
});

test("take is for the server alone", async () => {
  const h = harness();
  await assert.rejects(h.call("gate.grants.take", { act: "send", targets: [], turn: { person: alice.id, threads: ["thr_chat"] } }, as(bot)), (e) => codeOf(e) === "permission.role_lacks_permission");
});

test("only a person's own message asks, and a grant is spent once", async () => {
  const h = harness();
  await assert.rejects(ask(h, "msg_1", [{ act: "send", target: "evil@bad.test" }], "thr_chat", as(bot, { actingFor: alice.id })), (e) => codeOf(e) === "permission.role_lacks_permission");
  assert.equal(await granted(take(h, ["evil@bad.test"])), false);
  await ask(h, "msg_2", [{ act: "send", target: "lee@acme.test" }]);
  assert.equal(await granted(take(h, ["lee@evil.test"])), false, "another target is a Need");
  assert.equal(await granted(take(h, ["lee@acme.test"], ["thr_chat"], "post")), false, "another act is a Need");
  assert.equal(await granted(take(h, ["lee@acme.test"])), true);
  assert.equal(await granted(take(h, ["lee@acme.test"])), false, "single use");
});

test("a grant is one person's", async () => {
  const h = harness();
  await ask(h, "msg_1", [{ act: "send", target: "lee@acme.test" }], "thr_chat", bob);
  assert.equal(await granted(take(h, ["lee@acme.test"])), false);
});

test("a grant follows the request into a Job under the chat, not into another chat", async () => {
  const h = harness();
  await ask(h, "msg_1", [{ act: "send", target: "lee@acme.test" }]);
  assert.equal(await granted(take(h, ["lee@acme.test"], ["thr_other"])), false);
  assert.equal(await granted(take(h, ["lee@acme.test"], ["thr_job", "thr_chat"])), true);
});

test("a new message ends what the last one left unused; a grant also expires", async () => {
  const h = harness();
  await ask(h, "msg_1", [{ act: "send", target: "lee@acme.test" }]);
  await ask(h, "msg_2", []);
  assert.equal(await granted(take(h, ["lee@acme.test"])), false);
  await ask(h, "msg_3", [{ act: "send", target: "sam@acme.test" }]);
  h.advance(25 * HOUR);
  assert.equal(await granted(take(h, ["sam@acme.test"])), false);
});

test("a request with no target covers one call of any target, and stays stopped in a thread outside content reached", async () => {
  const h = harness();
  await ask(h, "msg_1", [{ act: "push_protected", target: "" }]);
  assert.equal(await granted(take(h, ["origin"], ["thr_chat"], "push_protected")), true);
  assert.equal(await granted(take(h, ["origin"], ["thr_chat"], "push_protected")), false);
});

test("a person may ask for the same thing twice in one replayed message: one row", async () => {
  const h = harness();
  await ask(h, "msg_1", [{ act: "send", target: "lee@acme.test" }]);
  await ask(h, "msg_1", [{ act: "send", target: "lee@acme.test" }]);
  assert.equal(await granted(take(h, ["lee@acme.test"])), true);
  assert.equal(await granted(take(h, ["lee@acme.test"])), false);
});

test("a call that shows no target takes any ask for its act, once, in a clean thread", async () => {
  const h = harness();
  await ask(h, "msg_1", [{ act: "push_protected", target: "main" }]);
  assert.equal(await granted(take(h, [], ["thr_chat"], "push_protected")), true);
  assert.equal(await granted(take(h, [], ["thr_chat"], "push_protected")), false);
});
