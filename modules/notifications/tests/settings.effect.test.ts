// The notification settings change delivery (P-CC_22b): alert me on replies, routines also when they succeed, hand Needs you to someone while away, and quiet hours with a summary at the end.
// @reads /modules/notifications/migrations/0001_notifications_state.sql
// @reads /modules/notifications/migrations/0002_settings_effects.sql
// Run on the final commit of this packet, after merging main, so the CI log lists the file as ok.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { HOUR, MIN, NOW, alice, as, bob, sendInput, svc } from "../fixtures/seed.ts";
import { consumers } from "../impl.ts";

const sender = as(svc);
const send = (h: Harness, over: Record<string, unknown> = {}): Promise<any> => h.call("notifications.send", sendInput(over), sender);   // eslint-disable-line @typescript-eslint/no-explicit-any
/** The settings module announces a change; the consumer keeps the copy. */
async function setting(h: Harness, person: string, key: string, after: unknown): Promise<void> {
  const out = await consumers["notifications.settings_sync"].run(h.ctxFor("notifications.send", sender), { name: "settings.changed", payload: { key, scope: "person", person, before: null, after, by: person } });
  assert.deepEqual(out, [key]);
}

test("settings.changed is kept for notification keys of a person only; a reset drops the copy", async () => {
  const h = harness();
  const run = (payload: Record<string, unknown>) => consumers["notifications.settings_sync"].run(h.ctxFor("notifications.send", sender), { name: "settings.changed", payload });
  assert.deepEqual(await run({ key: "appearance.mode", scope: "person", person: alice.id, after: "dark" }), [], "another page's key is not ours");
  assert.deepEqual(await run({ key: "notifications.push_idle_minutes", scope: "space", after: 9 }), [], "a Space-wide key is not a person's");
  await setting(h, alice.id, "notifications.alert_replies", true);
  assert.equal((await send(h, { kind: "reply.followed", collapseKey: "a" })).outcome, "interrupt");
  await run({ key: "notifications.alert_replies", scope: "person", person: alice.id });
  assert.equal((await send(h, { kind: "reply.followed", collapseKey: "b" })).outcome, "badge", "back to the shipped level");
});

test("alert me on replies: a followed reply interrupts only when on, only for that person, and my own kind choice wins", async () => {
  const h = harness();
  assert.equal((await send(h, { kind: "reply.followed", collapseKey: "a" })).outcome, "badge");
  await setting(h, alice.id, "notifications.alert_replies", true);
  assert.equal((await send(h, { kind: "reply.followed", collapseKey: "b" })).outcome, "interrupt");
  assert.equal((await send(h, { to: bob.id, kind: "reply.followed", collapseKey: "c" })).outcome, "badge");
  await h.call("notifications.kind.set_level", { kind: "reply.followed", channels: [] }, as(alice));
  assert.equal((await send(h, { kind: "reply.followed", collapseKey: "d" })).outcome, "badge", "her explicit choice for the kind beats the setting");
});

test("quiet hours hold an interrupt in the digest, let Needs you and calls through, and one summary is scheduled for when they end", async () => {
  const h = harness({ now: Date.UTC(2025, 9, 9, 10, 0, 0) });   // Thursday 10:00 UTC, inside working hours
  await setting(h, alice.id, "notifications.quiet_hours", { on: true, from: "09:00", to: "11:30", needs: true });
  assert.equal((await send(h, { kind: "dm" })).outcome, "digest", "a message is held");
  assert.equal((await send(h, { kind: "mention", data: { from: "x", where: "y" }, collapseKey: "m" })).outcome, "digest");
  assert.equal((await send(h, { kind: "approval.requested", title: "x", collapseKey: "n" })).outcome, "interrupt", "Needs you comes through");
  assert.equal((await send(h, { kind: "call.incoming", data: { from: "Lee" } })).outcome, "interrupt", "a call always does");
  assert.equal((await send(h, { kind: "task.assigned", data: { from: "B", title: "t" } })).outcome, "badge", "a badge was never a push");
  const sums = h.schedules.filter((s) => s.cap === "notifications.send");
  assert.equal(sums.length, 1, "one summary for the window, however many were held");
  assert.equal(sums[0]!.at, Date.UTC(2025, 9, 9, 11, 30, 0), "at the end of quiet hours");
  assert.equal(sums[0]!.input.kind, "digest.away");
  assert.equal(sums[0]!.input.to, alice.id);
  // the end of quiet hours: the summary lands as a digest row, and a message is a normal interrupt again
  h.setNow(Date.UTC(2025, 9, 9, 11, 30, 0));
  assert.equal((await send(h, sums[0]!.input)).outcome, "digest");
  assert.equal((await send(h, { kind: "dm", collapseKey: "after" })).outcome, "interrupt");
  // with Let Needs you through off, Needs you waits as well
  const g = harness({ now: Date.UTC(2025, 9, 9, 10, 0, 0) });
  await setting(g, alice.id, "notifications.quiet_hours", { on: true, from: "09:00", to: "11:30", needs: false });
  assert.equal((await send(g, { kind: "approval.requested", title: "x", collapseKey: "n" })).outcome, "digest");
});

test("quiet hours across midnight and when off", async () => {
  const late = harness({ now: Date.UTC(2025, 9, 9, 23, 0, 0) });
  await late.call("notifications.rules.set", { workingHours: null }, as(alice));   // with working hours on, 23:00 is already a badge before quiet hours are asked
  await setting(late, alice.id, "notifications.quiet_hours", { on: true, from: "22:00", to: "07:00", needs: true });
  await send(late, { kind: "dm" });
  assert.equal(late.schedules.find((s) => s.cap === "notifications.send")!.at, Date.UTC(2025, 9, 10, 7, 0, 0), "ends the next morning");
  const off = harness();
  await setting(off, alice.id, "notifications.quiet_hours", { on: false, from: "09:00", to: "18:00", needs: true });
  assert.equal((await send(off, { kind: "dm" })).outcome, "interrupt");
  assert.equal(off.schedules.length, 0);
});

test("hand Needs you to: while away, a Needs you item goes to that person, with who it was for; other kinds stay", async () => {
  const h = harness();
  await setting(h, alice.id, "notifications.hand_needs_you_to", bob.id);
  await h.call("notifications.away.set", { until: NOW + 8 * HOUR, delegate: { kind: "none" } }, as(alice));
  const r = await send(h, { kind: "approval.requested", title: "Sign", collapseKey: "s" });
  const rows = h.sqlite.prepare("SELECT person, kind FROM notifications_items ORDER BY at").all() as { person: string; kind: string }[];
  assert.deepEqual(rows.map((x) => [x.person, x.kind]), [[bob.id, "approval.requested"]], "Bob holds it");
  assert.equal(r.outcome, "interrupt", "for Bob it is a normal approval");
  await send(h, { kind: "reply.followed", collapseKey: "r" });
  assert.equal((h.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications_items WHERE person = ?").get(alice.id) as { n: number }).n, 1, "a reply stays with her, in the digest");
  // not away: it stays with her; no self-handoff
  await h.call("notifications.away.clear", {}, as(alice));
  await send(h, { kind: "approval.requested", title: "Again", collapseKey: "t" });
  assert.equal((h.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications_items WHERE person = ? AND kind = ?").get(alice.id, "approval.requested") as { n: number }).n, 1);
});

test("routines also when they succeed: a routine success reaches only an owner who asked, failures always do", async () => {
  const h = harness();
  h.callee("runs.get", (i) => ({ run: { id: i.runId, owner: alice.id, name: "Morning digest", kind: "routine" } }));
  const ctx = h.ctxFor("notifications.send", sender);
  const ev = { name: "run.succeeded", payload: { runId: "run_1", kind: "routine", costMicros: 0 } };
  const fan = consumers["notifications.fanout"];
  assert.deepEqual(await fan.run(ctx, ev), [], "off: nothing");
  await setting(h, alice.id, "notifications.routines_all", true);
  const out = await fan.run(h.ctxFor("notifications.send", sender), ev);
  assert.equal(out.length, 1);
  assert.equal((h.sqlite.prepare("SELECT kind, title FROM notifications_items WHERE id = ?").get(out[0]!) as { kind: string; title: string }).kind, "agent.task_finished");
  assert.deepEqual(await fan.run(ctx, { name: "run.succeeded", payload: { runId: "run_2", kind: "automation", costMicros: 0 } }), [], "only routines");
  const failed = await fan.run(ctx, { name: "run.failed", payload: { runId: "run_3", kind: "routine", code: "x", message: "boom", owner: bob.id } });
  assert.equal(failed.length, 1, "a failure is always told, whatever the setting");
  void MIN;
});
