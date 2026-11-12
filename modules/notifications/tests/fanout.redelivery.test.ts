// The fanout is handed the same event twice: after a stop let it go mid-run (host/src/daemon/consumers.ts close, the 15 s bound) or after a crash, the next start runs it again on the same
// event. Whoever it already reached is not reached again: no second Inbox row, no second email ("your Space will be deleted" must never arrive twice), and a recipient it had not reached yet
// still is. Kept per event and recipient, written before the send.
// @reads /modules/notifications/migrations/0001_notifications_state.sql
// @reads /modules/notifications/migrations/0002_settings_effects.sql
// @reads /modules/notifications/migrations/0004_fanout_sent.sql
// @reads /modules/notifications/migrations/0005_fanout_email.sql
// @reads /modules/notifications/migrations/0006_email_record.sql
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, as, bob, svc } from "../fixtures/seed.ts";
import { EMAIL_RETRY_TRIES, consumers, retryPendingEmails } from "../impl.ts";
import { emailTiming } from "../handlers/rules.ts";

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

test("a data folder whose fanout table was made by the first 0004 (no email_pending column): the fanout works", async () => {
  const h = harness();
  admins(h);
  h.sqlite.exec(`DROP TABLE notifications_fanout_sent; CREATE TABLE "notifications_fanout_sent" ("event_id" TEXT NOT NULL, "target" TEXT NOT NULL, "notification_id" TEXT, "at" INTEGER NOT NULL, PRIMARY KEY ("event_id", "target"));`);
  const fan = consumers["notifications.fanout"];
  const ctx = h.ctxFor(null, sender);
  h.emailFail((m) => m.to === bob.id);
  await fan.run(ctx, { id: "evt_old_table", name: "space.deletion_cancelled", payload: { by: bob.id } } as never);
  h.emailFail(null);
  await fan.run(ctx, { id: "evt_old_table", name: "space.deletion_cancelled", payload: { by: bob.id } } as never);
  assert.deepEqual(h.emails.map((m) => m.to).sort(), [alice.id, bob.id].sort());
});

test("a dead mail server does not hold the fanout: after one recipient's email fails all its tries, the rest are marked pending at once", async () => {
  const h = harness();
  admins(h);
  const fan = consumers["notifications.fanout"];
  const ctx = h.ctxFor(null, sender);
  const ev = { id: "evt_mail_down", name: "space.deletion_scheduled", payload: { by: alice.id, at: Date.UTC(2026, 10, 18, 9, 0, 0) } };
  h.emailFail(() => true);
  const t0 = Date.now();
  await fan.run(ctx, ev as never);
  const took = Date.now() - t0;
  assert.ok(took < 2_000, `one recipient's tries, not every recipient's: ${took} ms`);
  h.emailFail(null);
  await fan.run(ctx, ev as never);
  assert.deepEqual(h.emails.map((m) => m.to).sort(), [alice.id, bob.id].sort(), "both were left pending and are sent on the next delivery");
});

test("an email try that never answers counts as failed after its time, so a hung mail server cannot hold the fanout", async () => {
  const h = harness();
  admins(h);
  const fan = consumers["notifications.fanout"];
  const ctx = h.ctxFor(null, sender);
  const was = { ...emailTiming };
  emailTiming.tryMs = 50;
  try {
    h.emailHang((m) => m.to === bob.id);
    await fan.run(ctx, { id: "evt_mail_hang", name: "space.deletion_cancelled", payload: { by: bob.id } } as never);   // answers: bob's tries timed out
    h.emailHang(null);
    await fan.run(ctx, { id: "evt_mail_hang", name: "space.deletion_cancelled", payload: { by: bob.id } } as never);
    assert.deepEqual(h.emails.map((m) => m.to).sort(), [alice.id, bob.id].sort());
  } finally { Object.assign(emailTiming, was); }
});

test("an approval reminder whose email failed all its tries is scheduled once more, and only once", async () => {
  const h = harness();
  const input = { to: alice.id, kind: "approval.backstop", subject: { type: "task", id: "tsk_7" }, title: "Retainer", collapseKey: "approval.backstop:tsk_7" };
  h.emailFail(() => true);
  await h.call("notifications.send", input, sender);
  const again = h.schedules.filter((s) => s.cap === "notifications.send");
  assert.equal(again.length, 1, "rescheduled once");
  await h.call("notifications.send", again[0]!.input, sender);   // the rescheduled one fails too
  assert.equal(h.schedules.filter((s) => s.cap === "notifications.send").length, 1, "not again: a reminder is rescheduled once");
});

const outcomes = (h: Harness): string[] => (h.sqlite.prepare("SELECT person || ':' || outcome AS o FROM notifications_email_log ORDER BY rowid").all() as Array<{ o: string }>).map((r) => r.o);

test("a Space with no sending mailbox: the transport says so, nothing counts as sent, nothing is left pending to retry, and the reason is recorded", async () => {
  const h = harness();
  admins(h);
  h.emailAnswer("no_mailbox");
  const fan = consumers["notifications.fanout"];
  await fan.run(h.ctxFor(null, sender), { id: "evt_no_box", name: "space.deletion_scheduled", payload: { by: alice.id, at: Date.UTC(2026, 10, 18, 9, 0, 0) } } as never);
  assert.equal(h.emails.length, 0);
  assert.deepEqual(outcomes(h).sort(), [`${alice.id}:no_mailbox`, `${bob.id}:no_mailbox`].sort());
  assert.equal((h.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications_fanout_email").get() as { n: number }).n, 0, "not a failure: no retry loop");
});

test("a person who turned email off for a kind is not emailed it; the reason is recorded", async () => {
  const h = harness();
  admins(h);
  h.sqlite.prepare("INSERT INTO notifications_kind_levels (person, kind, level, channels) VALUES (?, ?, ?, ?)").run(bob.id, "space.deletion_scheduled", "interrupt", JSON.stringify(["desktop"]));
  const fan = consumers["notifications.fanout"];
  await fan.run(h.ctxFor(null, sender), { id: "evt_off", name: "space.deletion_scheduled", payload: { by: alice.id, at: Date.UTC(2026, 10, 18, 9, 0, 0) } } as never);
  assert.deepEqual(h.emails.map((m) => m.to), [alice.id]);
  assert.ok(outcomes(h).includes(`${bob.id}:off`));
});

test("the periodic pass: a deletion email that failed its delivery is sent by the next pass, once; one that keeps failing is given up after its tries and the host is told once", async () => {
  const h = harness();
  admins(h);
  const fan = consumers["notifications.fanout"];
  const ctx = h.ctxFor(null, sender);
  h.emailFail((m) => m.to === bob.id);
  await fan.run(ctx, { id: "evt_pass", name: "space.deletion_scheduled", payload: { by: alice.id, at: Date.UTC(2026, 10, 18, 9, 0, 0) } } as never);
  assert.deepEqual(h.emails.map((m) => m.to), [alice.id]);
  h.emailFail(null);
  assert.deepEqual(await retryPendingEmails(ctx), { sent: 1, failed: 0, gaveUp: 0 });
  assert.deepEqual(h.emails.map((m) => m.to).sort(), [alice.id, bob.id].sort());
  assert.deepEqual(await retryPendingEmails(ctx), { sent: 0, failed: 0, gaveUp: 0 }, "nothing left");

  const g = harness();
  admins(g);
  const gctx = g.ctxFor(null, sender);
  const was = { ...emailTiming };
  emailTiming.retryMs = [];
  try {
    g.emailFail((m) => m.to === bob.id);
    await consumers["notifications.fanout"].run(gctx, { id: "evt_dead", name: "space.deletion_cancelled", payload: { by: alice.id } } as never);
    for (let i = 0; i < EMAIL_RETRY_TRIES; i++) assert.equal((await retryPendingEmails(gctx)).failed, 1);
    assert.deepEqual(await retryPendingEmails(gctx), { sent: 0, failed: 0, gaveUp: 1 });
    assert.deepEqual(g.gaveUp, [{ to: bob.id, kind: "space.deletion_cancelled" }]);
    assert.deepEqual(await retryPendingEmails(gctx), { sent: 0, failed: 0, gaveUp: 0 }, "told once");
  } finally { Object.assign(emailTiming, was); }
});

test("with a sending mailbox the deletion notice is emailed once per admin, and the approval reminder once", async () => {
  const h = harness();
  admins(h);
  await consumers["notifications.fanout"].run(h.ctxFor(null, sender), { id: "evt_ok", name: "space.deletion_scheduled", payload: { by: alice.id, at: Date.UTC(2026, 10, 18, 9, 0, 0) } } as never);
  assert.deepEqual(h.emails.map((m) => m.to).sort(), [alice.id, bob.id].sort());
  const input = { to: alice.id, kind: "approval.backstop", subject: { type: "task", id: "tsk_ok" }, title: "Retainer", collapseKey: "approval.backstop:tsk_ok" };
  await h.call("notifications.send", input, sender);
  await h.call("notifications.send", input, sender);
  assert.equal(h.emails.filter((m) => m.subject === "Something is waiting on you").length, 1);
  assert.ok(outcomes(h).every((o) => o.endsWith(":sent")));
});

test("one role the reader refuses does not empty the admins: the others still hear of the Space's deletion", async () => {
  const h = harness();
  h.callee("access.roles.list", () => ({ roles: [{ id: "owner", name: "Owner" }, { id: "rol_admin", name: "Admin" }] }));
  h.callee("access.roles.get", (i: { roleId: string }) => { if (i.roleId === "owner") throw new Error("validation.bad_input"); return { holders: [{ kind: "person", id: bob.id }] }; });
  const made = await consumers["notifications.fanout"].run(h.ctxFor(null, sender), { id: "evt_roles", name: "space.deletion_scheduled", payload: { by: alice.id, at: Date.UTC(2026, 10, 18, 9, 0, 0) } } as never);
  assert.equal(made.length, 1, "bob, the admin, is told");
});
