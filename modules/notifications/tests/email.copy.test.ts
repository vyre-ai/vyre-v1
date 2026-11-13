// What a notice email says and where its one link goes, and what an admin is told when one cannot go. The subject and the line are fixed copy per kind with only values the server holds
// (the deletion date the fanout read from the event); never a title a caller wrote. The link names a place or a thing, which the host turns into a vyre://open link with the Space's address
// (host/src/seams/notify-mail.ts). An email that was wanted and could not go is said to admins once, in their Inbox (health.degraded, Console): no standing "degraded" state.
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
const AT = Date.UTC(2026, 10, 18, 9, 0, 0);
const admins = (h: Harness, ownerRoleReadable = true): void => {
  h.callee("access.roles.list", () => ({
    roles: [
      { id: "rol_owner", name: "Owner" },
      { id: "rol_admin", name: "Admin" },
    ],
  }));
  h.callee("access.roles.get", (i: { roleId: string }) => {
    if (i.roleId === "rol_owner" && !ownerRoleReadable)
      throw Object.assign(new Error("refused"), { error: { code: "permission.no_grant" } });
    return {
      holders: i.roleId === "rol_owner" ? [{ kind: "person", id: alice.id }] : [{ kind: "person", id: bob.id }],
    };
  });
  h.callee("spaces.get", () => ({ space: { id: "spc_test", name: "Northwind", owner: alice.id } }));
  h.callee("access.principals.get", (i: { principal: { id: string } }) => ({
    principal: { name: i.principal.id === bob.id ? "Bob Lane" : "Alice Owner" },
  }));
};
const lines = (h: Harness, person: string, kind: string): string[] =>
  (
    h.sqlite
      .prepare("SELECT title FROM notifications_items WHERE person = ? AND kind = ? ORDER BY rowid")
      .all(person, kind) as Array<{ title: string }>
  ).map((r) => r.title);
const fan = (h: Harness, id: string, name: string, payload: Record<string, unknown>) =>
  consumers["notifications.fanout"].run(h.ctxFor(null, sender), { id, name, payload } as never);

test("the deletion emails carry fixed copy with the date the server holds, and open Console; the approval reminder opens its own task", async () => {
  const h = harness();
  admins(h);
  await fan(h, "evt_del", "space.deletion_scheduled", { by: alice.id, at: AT });
  await fan(h, "evt_undo", "space.deletion_cancelled", { by: alice.id });
  await h.call(
    "notifications.send",
    {
      to: alice.id,
      kind: "approval.backstop",
      subject: { type: "task", id: "tsk_5" },
      title: "Retainer",
      collapseKey: "approval.backstop:tsk_5",
    },
    sender,
  );
  const forAlice = h.emails.filter((m) => m.to === alice.id);
  assert.deepEqual(forAlice, [
    {
      to: alice.id,
      subject: "Scheduled for deletion on 18 November 2026",
      line: "Everything in this Space is removed on 18 November 2026. An admin can cancel the deletion in Console until then.",
      open: { kind: "place", id: "console" },
    },
    {
      to: alice.id,
      subject: "Deletion cancelled",
      line: "The scheduled deletion of this Space was cancelled. Nothing will be removed.",
      open: { kind: "place", id: "console" },
    },
    {
      to: alice.id,
      subject: "Something is waiting on you",
      line: "An approval or an answer is waiting on you in Vyre.",
      open: { kind: "task", id: "tsk_5" },
    },
  ]);
});

test("no sending mailbox when an email was wanted: each admin's Console line says so once, not on every notice, and again only after mail worked and broke again", async () => {
  const h = harness();
  admins(h);
  h.emailAnswer("no_mailbox");
  await fan(h, "evt_1", "space.deletion_scheduled", { by: alice.id, at: AT });
  await fan(h, "evt_2", "space.deletion_cancelled", { by: alice.id });
  const said =
    "Notice email is off: this Space has no sending mailbox, so people see notices in the app only. Set one up in Console, Messaging, Email, Sending domains.";
  assert.deepEqual(lines(h, alice.id, "health.degraded"), [said]);
  assert.deepEqual(lines(h, bob.id, "health.degraded"), [said]);
  const list = (await h.call("notifications.list", { place: "console" }, as(bob))) as {
    notifications: Array<{ kind: string; title: string; place: string }>;
  };
  assert.deepEqual(
    list.notifications.filter((n) => n.kind === "health.degraded").map((n) => [n.place, n.title]),
    [["console", said]],
    "what bob's Console shows",
  );
  // mail set up, then gone again: said once more
  h.emailAnswer(undefined);
  await fan(h, "evt_3", "space.deletion_scheduled", { by: alice.id, at: AT + 1 });
  h.sqlite.prepare("UPDATE notifications_items SET seen_at = ?").run(h.now());
  h.emailAnswer("no_mailbox");
  await fan(h, "evt_4", "space.deletion_cancelled", { by: alice.id });
  assert.equal(lines(h, bob.id, "health.degraded").length, 2);
});

test("an email given up on after its tries: each admin's Console line names the person, once", async () => {
  const h = harness();
  admins(h);
  emailTiming.retryMs = [0, 0];
  try {
    h.emailFail((m) => m.to === bob.id);
    await fan(h, "evt_del", "space.deletion_scheduled", { by: alice.id, at: AT });
    for (let i = 0; i <= EMAIL_RETRY_TRIES; i++) await retryPendingEmails(h.ctxFor(null, sender));
    assert.deepEqual(lines(h, alice.id, "health.degraded"), [
      "Notice email to Bob Lane is failing: a notice about deleting this Space could not be emailed.",
    ]);
  } finally {
    emailTiming.retryMs = [300, 1_000];
  }
});

test("a deletion cancelled while its scheduled email still waits to be tried again: the waiting one is dropped, so nobody hears scheduled after cancelled", async () => {
  const h = harness();
  admins(h);
  emailTiming.retryMs = [0, 0];
  try {
    h.emailFail(() => true);
    await fan(h, "evt_del", "space.deletion_scheduled", { by: alice.id, at: AT });
    h.emailFail(null);
    await fan(h, "evt_undo", "space.deletion_cancelled", { by: alice.id });
    await retryPendingEmails(h.ctxFor(null, sender));
    assert.deepEqual(
      h.emails.map((m) => m.subject),
      ["Deletion cancelled", "Deletion cancelled"],
    );
  } finally {
    emailTiming.retryMs = [300, 1_000];
  }
});

test("an Owner role the notifications reader cannot read: the Space owner still hears of the deletion, and the refusal is logged", async () => {
  const h = harness();
  admins(h, false);
  const warned: unknown[][] = [];
  const ctx = { ...h.ctxFor(null, sender), log: { warn: (...a: unknown[]) => void warned.push(a) } };
  await consumers["notifications.fanout"].run(ctx, {
    id: "evt_del",
    name: "space.deletion_scheduled",
    payload: { by: bob.id, at: AT },
  } as never);
  assert.deepEqual(h.emails.map((m) => m.to).sort(), [alice.id, bob.id].sort());
  assert.ok(
    warned.some((a) => /role not readable/.test(String(a[0]))),
    JSON.stringify(warned),
  );
});

test("the email record keeps ninety days: the periodic pass prunes what is older", async () => {
  const h = harness();
  h.sqlite
    .prepare("INSERT INTO notifications_email_log (person, kind, ref, outcome, at) VALUES (?, ?, ?, ?, ?)")
    .run(alice.id, "space.deletion_scheduled", "ntf_old", "sent", h.now() - 91 * 86_400_000);
  h.sqlite
    .prepare("INSERT INTO notifications_email_log (person, kind, ref, outcome, at) VALUES (?, ?, ?, ?, ?)")
    .run(alice.id, "space.deletion_scheduled", "ntf_new", "sent", h.now() - 89 * 86_400_000);
  await retryPendingEmails(h.ctxFor(null, sender));
  assert.deepEqual(
    (h.sqlite.prepare("SELECT ref FROM notifications_email_log").all() as Array<{ ref: string }>).map((r) => r.ref),
    ["ntf_new"],
  );
});
