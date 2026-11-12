// The fanout is handed the same event twice: after a stop let it go mid-run (host/src/daemon/consumers.ts close, the 15 s bound) or after a crash, the next start runs it again on the same
// event. Whoever it already reached is not reached again: no second Inbox row, no second email ("your Space will be deleted" must never arrive twice), and a recipient it had not reached yet
// still is. Kept per event and recipient, written before the send.
// @reads /modules/notifications/migrations/0001_notifications_state.sql
// @reads /modules/notifications/migrations/0002_settings_effects.sql
// @reads /modules/notifications/migrations/0004_fanout_sent.sql
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, as, bob, svc } from "../fixtures/seed.ts";
import { consumers } from "../impl.ts";

const sender = as(svc);
const admins = (h: Harness): void => {
  h.callee("access.roles.list", () => ({ roles: [{ id: "rol_owner", name: "Owner" }, { id: "rol_admin", name: "Admin" }] }));
  h.callee("access.roles.get", (i: { roleId: string }) => ({ holders: i.roleId === "rol_owner" ? [{ kind: "person", id: alice.id }] : [{ kind: "person", id: bob.id }] }));
};
const rows = (h: Harness, kind: string): number => (h.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications_items WHERE kind = ?").get(kind) as { n: number }).n;

test("the same space.deletion_scheduled event handed over twice, after the admins saw the first line: one email each, not a second \"your Space will be deleted\"", async () => {
  const h = harness();
  admins(h);
  const fan = consumers["notifications.fanout"];
  const ctx = h.ctxFor(null, sender);
  const ev = { id: "evt_delete_1", name: "space.deletion_scheduled", payload: { by: alice.id, at: Date.UTC(2026, 10, 18, 9, 0, 0) } };
  const first = await fan.run(ctx, ev as never);
  assert.equal(first.length, 2);
  assert.equal(h.emails.length, 2);
  // both admins opened the Inbox before the redelivery (a seen line no longer collapses a repeat into itself)
  h.sqlite.prepare("UPDATE notifications_items SET seen_at = ?").run(h.now());
  const again = await fan.run(ctx, ev as never);
  assert.equal(h.emails.length, 2, `one email each, not a second one: ${JSON.stringify(h.emails.map((m) => m.to))}`);
  assert.equal(rows(h, "space.deletion_scheduled"), 2, "one row each");
  assert.deepEqual([...again].sort(), [...first].sort(), "the second delivery answers with the rows the first one made");
});

test("the same member.joined event handed over twice (a kind with no collapse key): one Inbox row, not two", async () => {
  const h = harness();
  const fan = consumers["notifications.fanout"];
  const ctx = h.ctxFor(null, sender);
  const ev = { id: "evt_joined_1", name: "member.joined", payload: { personId: "usr_new", invitedBy: alice.id } };
  await fan.run(ctx, ev as never);
  await fan.run(ctx, ev as never);
  assert.equal(rows(h, "member.joined"), 1);
  // another person joining is another line
  await fan.run(ctx, { id: "evt_joined_2", name: "member.joined", payload: { personId: "usr_other", invitedBy: alice.id } } as never);
  assert.equal(rows(h, "member.joined"), 2);
});

test("a fanout that stopped after its first recipient: the redelivery reaches only the ones it had not reached", async () => {
  const h = harness();
  admins(h);
  const fan = consumers["notifications.fanout"];
  const base = h.ctxFor(null, sender);
  // the first run files alice's row and email, then fails on bob's row (as a run cut off by a stop or a crash would end there)
  let fail = true;
  const db = { all: (sql: string, ...a: unknown[]) => base.db.all(sql, ...a), run: (sql: string, ...a: unknown[]) => { if (fail && sql.includes("INSERT INTO notifications_items") && a[1] === bob.id) throw new Error("cut off"); return base.db.run(sql, ...a); } };
  const ctx = { ...base, db } as typeof base;
  const ev = { id: "evt_delete_3", name: "space.deletion_cancelled", payload: { by: bob.id } };
  await assert.rejects(() => fan.run(ctx, ev as never), /cut off/);
  assert.deepEqual(h.emails.map((m) => m.to), [alice.id]);
  h.sqlite.prepare("UPDATE notifications_items SET seen_at = ?").run(h.now());   // alice saw her line before the redelivery
  fail = false;
  await fan.run(ctx, ev as never);
  assert.deepEqual(h.emails.map((m) => m.to).sort(), [alice.id, bob.id].sort(), "alice once, bob once");
  assert.equal(rows(h, "space.deletion_cancelled"), 2);
});

test("an event with no id (a direct call, a test) is not remembered: every call files its line", async () => {
  const h = harness();
  const fan = consumers["notifications.fanout"];
  const ctx = h.ctxFor(null, sender);
  await fan.run(ctx, { name: "member.joined", payload: { personId: "usr_new", invitedBy: alice.id } } as never);
  await fan.run(ctx, { name: "member.joined", payload: { personId: "usr_new", invitedBy: alice.id } } as never);
  assert.equal(rows(h, "member.joined"), 2);
});

test("a delivery cut off after a recipient's mark and before their send answered: the redelivery tells that recipient, once; the one it had reached is not told again", async () => {
  const h = harness();
  admins(h);
  const fan = consumers["notifications.fanout"];
  const ctx = h.ctxFor(null, sender);
  const ev = { id: "evt_delete_cut", name: "space.deletion_scheduled", payload: { by: alice.id, at: Date.UTC(2026, 10, 18, 9, 0, 0) } };
  h.emailHang((m) => m.to === bob.id);
  void fan.run(ctx, ev as never);   // the stop lets this delivery go while bob's email is on its way
  for (let i = 0; i < 100 && rows(h, "space.deletion_scheduled") < 2; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(h.emails.map((m) => m.to), [alice.id]);
  h.emailHang(null);
  await fan.run(ctx, ev as never);   // the next start hands the same event over again
  assert.deepEqual(h.emails.map((m) => m.to).sort(), [alice.id, bob.id].sort(), "bob is told (his send never finished), alice is not told twice");
  assert.equal(rows(h, "space.deletion_scheduled"), 2);
});

test("an email that is the point of its kind (the Space deletion notices) and fails once is tried again a moment later and goes out in the same delivery", async () => {
  const h = harness();
  admins(h);
  const fan = consumers["notifications.fanout"];
  const ctx = h.ctxFor(null, sender);
  let failed = 0;
  h.emailFail((m) => m.to === bob.id && failed++ === 0);
  await fan.run(ctx, { id: "evt_delete_blip", name: "space.deletion_cancelled", payload: { by: bob.id } } as never);
  assert.deepEqual(h.emails.map((m) => m.to).sort(), [alice.id, bob.id].sort());
});

test("an email that is the point of its kind and fails all its tries: the recipient is not marked reached, and the next delivery of the event sends that email alone", async () => {
  const h = harness();
  admins(h);
  const fan = consumers["notifications.fanout"];
  const ctx = h.ctxFor(null, sender);
  const ev = { id: "evt_delete_fail", name: "space.deletion_cancelled", payload: { by: bob.id } };
  h.emailFail((m) => m.to === bob.id);
  await fan.run(ctx, ev as never);
  assert.deepEqual(h.emails.map((m) => m.to), [alice.id]);
  h.emailFail(null);
  await fan.run(ctx, ev as never);   // the next delivery (a restart or a crash hands it over again)
  assert.deepEqual(h.emails.map((m) => m.to).sort(), [alice.id, bob.id].sort(), "bob's email goes out; alice gets one");
  assert.equal(rows(h, "space.deletion_cancelled"), 2, "no second Inbox line");
  await fan.run(ctx, ev as never);
  assert.equal(h.emails.length, 2, "once both are told, a further delivery sends nothing");
});

test("the approval reminder email: a failure is tried again a moment later; after all its tries fail, the next reminder for that approval sends it, once", async () => {
  const h = harness();
  const input = { to: alice.id, kind: "approval.backstop", subject: { type: "task", id: "tsk_9" }, title: "Retainer", collapseKey: "approval.backstop:tsk_9" };
  let failed = 0;
  h.emailFail(() => failed++ === 0);
  await h.call("notifications.send", input, sender);
  assert.deepEqual(h.emails.map((m) => m.subject), ["Something is waiting on you"], "the second try went out");
  const g = harness();
  g.emailFail(() => true);
  await g.call("notifications.send", input, sender);
  assert.equal(g.emails.length, 0);
  g.emailFail(null);
  await g.call("notifications.send", input, sender);   // the Gate's own reminder lands on the same key
  await g.call("notifications.send", input, sender);
  assert.deepEqual(g.emails.map((m) => m.subject), ["Something is waiting on you"], "not \"once\" meaning never: it goes out once");
});
