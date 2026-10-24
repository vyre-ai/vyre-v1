// Push (spec 2.24, 3.11): device tokens, the one-device rule, and a payload that carries no content.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { MIN, alice, as, bob, bot, sendInput, svc } from "../fixtures/seed.ts";
import { buildPush, kindOf } from "../impl.ts";

const me = as(alice);
const sender = as(svc);
const register = (h: Harness, device: string, platform: string, token = `tok-${device}`, who = me) => h.call("notifications.push.register", { device, platform, token }, who);
const approval = (h: Harness, over: Record<string, unknown> = {}) => h.call("notifications.send", sendInput({ kind: "approval.requested", title: "Wire $48,000 to Lee Smith, ssn 123-45-6789", subject: { type: "task", id: "tsk_1" }, ...over }), sender);

test("push payload carries no content: the Space name, a deep link, a tag and the action keys, and nothing from the title or body", async () => {
  const h = harness({ computerIdleMs: 10 * MIN });
  await register(h, "devphone", "ios");
  const r = await approval(h, { body: "Please wire the funds today", data: { from: "Bob", secret: "hunter2" } });
  assert.equal(r.outcome, "interrupt");
  assert.equal(h.pushes.length, 1);
  const p = h.pushes[0]!;
  assert.deepEqual(p, {
    device: "devphone", platform: "ios", token: "tok-devphone", title: "Northwind needs you", deepLink: "vyre://task/tsk_1", tag: "approval.requested:tsk_1",
    category: "needs_you", actions: [{ key: "approve", cap: "tasks.act" }, { key: "send_back", cap: "tasks.act" }],
  });
  const wire = JSON.stringify({ ...p, token: undefined });
  for (const leak of ["Wire", "48,000", "Lee", "Smith", "ssn", "123-45", "Please", "funds", "hunter2", "Bob"]) assert.ok(!wire.includes(leak), `the push must not contain "${leak}"`);
  assert.deepEqual(Object.keys(p).sort(), ["actions", "category", "deepLink", "device", "platform", "tag", "title", "token"]);
});

test("push payload: a kind without inline actions has no category; no subject deep-links to the place; the title is the kind's push title", () => {
  const dm = kindOf("dm")!, call = kindOf("call.incoming")!, backstop = kindOf("approval.backstop")!;
  const row = { id: "ntf_1", person: "usr_alice", kind: "call.incoming" as const, level: "interrupt" as const, place: "inbox" as const, title: "Incoming call from Lee Smith", body: "secret", count: 1, at: 1, actions: [] };
  assert.deepEqual(buildPush(row, call, "Northwind"), { title: "Northwind is calling", deepLink: "vyre://inbox", tag: "ntf_1" });
  assert.deepEqual(buildPush({ ...row, kind: "dm", place: "chats", subject: { type: "thread", id: "thr_9" }, collapseKey: "dm:thr_9" }, dm, "Acme Law"), {
    title: "Acme Law needs you", deepLink: "vyre://thread/thr_9", tag: "dm:thr_9", category: "needs_you", actions: [{ key: "reply", cap: "chat.post" }],
  });
  assert.equal(buildPush(row, backstop, "N").actions?.[0]?.key, "open");
});

test("push goes to the phone after the computer has been idle 5 minutes; while the app is open nothing is pushed", async () => {
  const h = harness({ computerIdleMs: 4 * MIN });
  await register(h, "devphone", "android");
  const open = await approval(h, { subject: { type: "task", id: "tsk_a" } });
  assert.equal(open.outcome, "interrupt");
  assert.equal(h.pushes.length, 0, "4 minutes idle: the banner on the computer is the notification");
  assert.equal(h.events[0]!.payload.pushed, false);
  h.idle(5 * MIN);
  await approval(h, { subject: { type: "task", id: "tsk_b" } });
  assert.equal(h.pushes.length, 1);
  assert.equal(h.events[0]!.payload.pushed, true);
  assert.equal(h.events[0]!.payload.device, "devphone");
  h.idle(undefined);   // no computer session at all
  await approval(h, { subject: { type: "task", id: "tsk_c" } });
  assert.equal(h.pushes.length, 2);
});

test("one device at a time: the phone, never both; the computer's own token only when there is no phone", async () => {
  const h = harness({ computerIdleMs: 10 * MIN });
  await register(h, "devmac", "mac");
  await approval(h, { subject: { type: "task", id: "tsk_1" } });
  assert.deepEqual(h.pushes.map((p) => p.device), ["devmac"]);
  h.advance(MIN);
  await register(h, "devold", "ios");
  h.advance(MIN);
  await register(h, "devnew", "android");
  await approval(h, { subject: { type: "task", id: "tsk_2" } });
  assert.deepEqual(h.pushes.map((p) => p.device), ["devmac", "devnew"], "the phone registered last");
});

test("only Interrupt pushes; a badge, a digest, a capped and a muted notification never do; a repeat into a loud row is not pushed again", async () => {
  const h = harness({ computerIdleMs: 10 * MIN });
  await register(h, "devphone", "ios");
  const go = (over: Record<string, unknown>, who = sender) => h.call("notifications.send", sendInput(over), who);
  await go({ kind: "task.assigned", data: { from: "Bob", title: "x" } });
  await go({ kind: "member.joined", data: { name: "n", space: "s" } });
  assert.equal(h.pushes.length, 0);
  for (let i = 0; i < 4; i++) await go({ kind: "dm", data: { agentId: bot.id, i } }, as(bot));
  assert.equal(h.pushes.length, 3, "three interrupts, the fourth is capped");
  await h.call("notifications.mute.set", { target: { kind: "person", id: "usr_bob" } }, me);
  await go({ kind: "dm", data: { fromId: "usr_bob", from: "Bob" } });
  assert.equal(h.pushes.length, 3);
  await go({ kind: "approval.requested", title: "x", subject: { type: "task", id: "tsk_r" } });
  await go({ kind: "approval.requested", title: "x", subject: { type: "task", id: "tsk_r" } });
  assert.equal(h.pushes.length, 4, "the same approval twice is one push");
});

test("register: replaces the token of a device, a device belongs to whoever signed in last, the event never carries the token, bad input is refused", async () => {
  const h = harness();
  assert.deepEqual(await register(h, "dev_1", "ios", "first-token"), { registered: true });
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["notification.push_registered", { person: alice.id, device: "dev_1", platform: "ios" }]]);
  assert.ok(!JSON.stringify(h.events).includes("first-token"));
  await register(h, "dev_1", "ios", "second-token");
  const rows = h.sqlite.prepare("SELECT person, platform, token FROM notifications_push").all() as { person: string; platform: string; token: string }[];
  assert.equal(rows.length, 1);
  assert.ok(!rows[0]!.token.includes("second-token"), "the token is sealed at rest");
  await register(h, "dev_1", "ios", "bobs-token", as(bob));
  assert.deepEqual((h.sqlite.prepare("SELECT person FROM notifications_push").all() as { person: string }[]).map((r) => r.person), [bob.id]);
  await assert.rejects(register(h, "dev_2", "ios", "   "), (e) => { assert.equal(codeOf(e), "validation.bad_input"); return true; });
  await assert.rejects(register(h, "dev_2", "ios", "x".repeat(5000)), (e) => { assert.equal(codeOf(e), "validation.bad_input"); return true; });
});

test("without a seal the token is still stored and delivered", async () => {
  const h = harness({ noSeal: true, computerIdleMs: 10 * MIN });
  await register(h, "dev_1", "ios", "plain-token");
  await approval(h);
  assert.equal(h.pushes[0]!.token, "plain-token");
});

test("unregister removes only my own device", async () => {
  const h = harness({ computerIdleMs: 10 * MIN });
  await register(h, "dev_1", "ios");
  assert.deepEqual(await h.call("notifications.push.unregister", { device: "dev_1" }, as(bob)), { removed: false });
  assert.deepEqual(await h.call("notifications.push.unregister", { device: "dev_1" }, me), { removed: true });
  assert.deepEqual(await h.call("notifications.push.unregister", { device: "dev_1" }, me), { removed: false });
  const r = await approval(h);
  assert.equal(r.outcome, "interrupt");
  assert.equal(h.pushes.length, 0, "no device, no push, the row still lands");
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications_items").get()!.n, 1);
});

test("a dead token is dropped; a failing transport or no transport never fails the notification", async () => {
  const gone = harness({ computerIdleMs: 10 * MIN, sendResult: "gone" });
  await register(gone, "dev_1", "ios");
  assert.equal((await approval(gone)).outcome, "interrupt");
  assert.equal(gone.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications_push").get()!.n, 0);
  assert.equal(gone.events.at(-1)!.payload.pushed, false);

  const broken = harness({ computerIdleMs: 10 * MIN, sendResult: "throw" });
  await register(broken, "dev_1", "ios");
  const r = await approval(broken);
  assert.equal(r.outcome, "interrupt");
  assert.equal(broken.events.at(-1)!.payload.pushed, false);
  assert.equal(broken.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications_push").get()!.n, 1, "a failing send keeps the token");

  const none = harness({ noPort: true });
  await register(none, "dev_1", "ios");
  const n = await approval(none);
  assert.equal(n.outcome, "interrupt");
  assert.equal(none.pushes.length, 0);
});
