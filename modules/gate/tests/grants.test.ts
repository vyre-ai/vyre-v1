// Grants (chat design, holes 1 and 3): rows only a person's press or own message writes, voided by any edit, spent once, matched by the Gate at act time.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { HOUR, alice, as, bob, bot } from "../fixtures/seed.ts";
import { rejectAllOf } from "../impl.ts";

const gate = { id: alice.id, kind: "person" as const, origin: "gate", depth: 0 };
const set = (h: Harness, who: unknown, over: Record<string, unknown> = {}) => h.call("gate.grants.set", {
  automationId: "aut_0123456789abcdef0123456789abcdef", defHash: "h1", press: "save", steps: [{ stepId: "letter", act: "send", targets: ["lee@acme.test"], computed: false, changed: true }], ...over,
}, { depth: 1, ...(who as object) } as never);
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

test("nobody writes rows from outside: only an automation capability calls set", async () => {
  await assert.rejects(harness().call("gate.grants.set", { automationId: "aut_0123456789abcdef0123456789abcdef", defHash: "h1", press: "on", steps: [] }, { id: alice.id, depth: 0 } as never), (e) => codeOf(e) === "permission.role_lacks_permission");
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

const mark = (h: Harness, threads: string[], links?: string[]) => h.call("gate.taint.mark", { threads, source: "automations.read_link", ...(links ? { links } : {}) }, gate);
const known = async (h: Harness, url: string, threads = ["thr_chat"]): Promise<boolean> => (await h.call("gate.links.known", { url, threads }, gate)).known;

test("after outside content an outward act stops even if asked; the person speaking again clears it", async () => {
  const h = harness();
  await ask(h, "msg_1", [{ act: "send", target: "lee@acme.test" }]);
  await mark(h, ["thr_chat"]);
  assert.equal(await granted(take(h, ["lee@acme.test"])), false, "tainted");
  await ask(h, "msg_2", [{ act: "send", target: "lee@acme.test" }]);
  assert.equal(await granted(take(h, ["lee@acme.test"])), true, "a named target in a new turn goes");
});

test("a request with no target stays stopped in a thread outside content reached, after the person speaks too", async () => {
  const h = harness();
  await mark(h, ["thr_chat"]);
  await ask(h, "msg_1", [{ act: "send", target: "" }]);
  assert.equal(await granted(take(h, ["evil@bad.test"])), false);
  assert.equal(await granted(take(h, [])), false);
});

test("a taint in a Job's thread reaches the chat above, and taint is the server's to mark", async () => {
  const h = harness();
  await ask(h, "msg_1", [{ act: "send", target: "lee@acme.test" }]);
  await mark(h, ["thr_job", "thr_chat"]);
  assert.equal(await granted(take(h, ["lee@acme.test"])), false);
  await assert.rejects(h.call("gate.taint.mark", { threads: ["thr_chat"], source: "x" }, as(bot)), (e) => codeOf(e) === "permission.role_lacks_permission");
});

test("a link the person gave or a page linked to is known; one put together is not; the table holds hashes", async () => {
  const h = harness();
  await h.call("gate.grants.ask", { threadId: "thr_chat", messageId: "msg_1", asked: [], links: ["https://acme.test/a?x=1#top"] }, alice as never);
  assert.equal(await known(h, "https://acme.test/a?x=1"), true);
  assert.equal(await known(h, "https://acme.test/a?x=2"), false, "a changed query is a new link");
  assert.equal(await known(h, "https://acme.test/a?x=1", ["thr_other"]), false);
  await mark(h, ["thr_chat"], ["https://acme.test/b"]);
  assert.equal(await known(h, "https://acme.test/b"), true);
  assert.equal(JSON.stringify(h.db.all("SELECT * FROM gate_links")).includes("acme.test"), false);
});

const allow = (h: Harness, who: unknown, over: Record<string, unknown> = {}) => h.call("gate.allow.set", { act: "approve", target: "files.write", threadId: "thr_chat", ...over }, who as never);
const allowed = (h: Harness, act = "approve", cap = "files.write", agentId = bot.id, threads = ["thr_chat"]) => h.call("gate.grants.take", { act, targets: [], always: { person: alice.id, agentId, threads, cap } }, gate);

test("Always allow is a row: scoped, with an expiry, read live, and taken back at the next act", async () => {
  const h = harness();
  const { rule } = await allow(h, alice, { agentId: bot.id });
  assert.equal(rule.kind, "always");
  assert.equal(rule.expiresAt, h.now() + 30 * 24 * HOUR);
  assert.equal(await granted(allowed(h)), true);
  assert.equal(await granted(allowed(h)), true, "a rule is not spent");
  assert.equal(await granted(allowed(h, "approve", "files.delete")), false, "another capability");
  assert.equal(await granted(allowed(h, "approve", "files.write", "agt_other")), false, "another agent");
  assert.equal(await granted(allowed(h, "approve", "files.write", bot.id, ["thr_other"])), false, "another chat");
  assert.deepEqual((await h.call("gate.allow.list", {}, alice as never)).rules.map((r: { id: string }) => r.id), [rule.id]);
  await h.call("gate.allow.remove", { id: rule.id }, alice as never);
  assert.equal(await granted(allowed(h)), false);
  await allow(h, alice, { days: 1 });
  h.advance(25 * HOUR);
  assert.equal(await granted(allowed(h)), false, "expired");
});

test("Always allow: only a person, one agent or chat, an outward act needs an admin, money never", async () => {
  const h = harness();
  await assert.rejects(allow(h, as(bot, { actingFor: alice.id })), (e) => codeOf(e) === "permission.role_lacks_permission");
  await assert.rejects(h.call("gate.allow.set", { act: "approve", target: "files.write" }, alice as never), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(allow(h, alice, { act: "send", target: "lee@acme.test" }), (e) => codeOf(e) === "permission.role_lacks_permission");
  const admin = harness({ authorize: (_w, action) => action.perm === "policy.manage" });
  assert.equal((await allow(admin, alice, { act: "send", target: "lee@acme.test" })).rule.act, "send");
  await assert.rejects(allow(admin, alice, { act: "pay", target: "stripe" }), (e) => codeOf(e) === "permission.role_lacks_permission");
});

test("a rule is removed only by who wrote it or an admin; a person leaving takes their asks and rules with them", async () => {
  const h = harness();
  const { rule } = await allow(h, alice);
  await assert.rejects(h.call("gate.allow.remove", { id: rule.id }, bob as never), (e) => codeOf(e) === "permission.not_found");
  await ask(h, "msg_1", [{ act: "send", target: "lee@acme.test" }]);
  await rejectAllOf(h.ctxFor(null, { id: "svc_host", kind: "service" }), alice.id, "left");
  assert.equal(await granted(allowed(h)), false);
  assert.equal(await granted(take(h, ["lee@acme.test"])), false);
});
