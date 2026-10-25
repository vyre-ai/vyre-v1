// Notification rules (spec 2.24): each kind lands at its level and place, working hours and away lower an Interrupt, repeats collapse, an agent cannot exceed its interrupt cap,
// a mute silences a sender, the approval reminder is scheduled once, and the fanout consumer files rows for the events that name a kind.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { HOUR, MIN, NOW, alice, as, bob, bot, bot2, sendInput, svc } from "../fixtures/seed.ts";
import { KINDS, consumers, kindOf, withinHours } from "../impl.ts";
import { registry } from "../../../generated/registry.ts";

const me = as(alice);
const sender = as(svc);
const row = (h: Harness, id: string): any => h.sqlite.prepare("SELECT * FROM notifications_items WHERE id = ?").get(id);   // eslint-disable-line @typescript-eslint/no-explicit-any
const rows = (h: Harness): any[] => h.sqlite.prepare("SELECT * FROM notifications_items ORDER BY rowid").all() as any[];   // eslint-disable-line @typescript-eslint/no-explicit-any

// ---- the kinds ----

test("the kind table mirrors the frozen manifest (level, place, title, actions, hours, rate key, push title)", () => {
  const fromRegistry = registry.notificationKinds.filter((k) => k.module === "notifications");
  assert.deepEqual(KINDS.map((k) => k.key).sort(), fromRegistry.map((k) => k.key).sort());
  for (const k of fromRegistry) {
    const mine = kindOf(k.key)!;
    assert.equal(mine.level, k.level, k.key);
    assert.equal(mine.place, k.place, k.key);
    assert.equal(mine.title, k.title, k.key);
    assert.equal(k.collapseKey, `${k.key}:{{subject}}`, "the default collapse key is the kind and the subject id");
    if (k.level !== "interrupt") assert.equal(mine.respectHours, k.respectHours, k.key);
    assert.deepEqual(mine.actions, k.actions ?? [], k.key);
    assert.equal(mine.pushTitle, (k as unknown as { pushTitle?: string }).pushTitle, k.key);
    assert.equal(mine.agentRateKey, (k as unknown as { agentRateKey?: string }).agentRateKey, k.key);
    assert.equal(mine.backstopEmailAfterHours, (k as unknown as { backstopEmailAfterHours?: number }).backstopEmailAfterHours, k.key);
  }
});

// DECISION: the manifest helper notif() sets respectHours=false on every Interrupt kind by default, so the registry cannot tell "exempt from working hours" from "default". Spec 2.24 says outside
// working hours only calls, urgent approvals and incidents interrupt, so the module exempts exactly the three kinds the manifest overrides on purpose (reminders, calls, incidents).
test("only calls, incidents and approval reminders are exempt from working hours", () => {
  assert.deepEqual(KINDS.filter((k) => k.level === "interrupt" && !k.respectHours).map((k) => k.key).sort(), ["approval.backstop", "call.incoming", "incident.owned"]);
  assert.ok(KINDS.filter((k) => k.level !== "interrupt").every((k) => k.respectHours));
});

const SAMPLE: Record<string, Record<string, unknown>> = {
  "approval.requested": { title: "Retainer" }, "approval.backstop": { title: "Retainer" }, dm: { from: "Bob" }, mention: { from: "Bob", where: "Sales" }, "call.incoming": { from: "Bob" },
  "agent.blocked": { agent: "Scout", reason: "needs a login" }, "incident.owned": { title: "Mail is down" }, "task.assigned": { from: "Bob", title: "Call Lee" },
  "reply.followed": { where: "Intake" }, "agent.task_finished": { agent: "Scout", title: "Research" }, "campaign.reply": { from: "Lee", campaign: "Spring" }, "digest.away": {},
  "mention.thread": { where: "Intake" }, "run.failed": { name: "Weekly", message: "no mailbox" }, "conflict.needs_you": { title: "Lee" },
  "access.requested": { from: "Bob", level: "edit", title: "Clients" }, "access.decided": { title: "Clients", decision: "approved" }, "sync.attention": { device: "Laptop" },
  "health.degraded": { service: "Mail", state: "slow" }, "problem.report": { from: "Bob" }, "member.joined": { name: "Cara", space: "Northwind" }, "limit.hit": { title: "Scout" },
};
for (const def of KINDS.filter((k) => k.key !== "vault.rotation_due")) {
  test(`kind ${def.key}: lands at ${def.level} in ${def.place} with its actions and a readable line`, async () => {
    const h = harness();
    const r = await h.call("notifications.send", sendInput({ kind: def.key, data: SAMPLE[def.key] }), sender);
    assert.equal(r.outcome, def.level);
    const n = row(h, r.notificationId);
    assert.equal(n.level, def.level);
    assert.equal(n.place, def.place);
    assert.deepEqual(JSON.parse(n.actions), def.actions);
    assert.doesNotMatch(n.title, /\{\{|\}\}/, "no hole is left in the line");
    assert.ok(n.title.length > 3);
    assert.deepEqual(h.events.map((e) => e.name), ["notification.delivered"]);
    assert.equal(h.events[0]!.payload.level, def.level);
    assert.equal(h.events[0]!.payload.collapsed, false);
  });
}

test("a line fills its variables and leaves no dangling colon when one is missing", async () => {
  const h = harness();
  const a = await h.call("notifications.send", sendInput({ kind: "approval.requested", title: "Retainer for Lee" }), sender);
  assert.equal(row(h, a.notificationId).title, "Approval needed: Retainer for Lee");
  const b = await h.call("notifications.send", sendInput({ kind: "approval.requested" }), sender);
  assert.equal(row(h, b.notificationId).title, "Approval needed");
  const c = await h.call("notifications.send", sendInput({ kind: "mention", data: { from: "Bob", where: "Sales" } }), sender);
  assert.equal(row(h, c.notificationId).title, "Bob mentioned you in Sales");
});

test("an unknown kind is refused", async () => {
  const h = harness();
  await assert.rejects(h.call("notifications.send", sendInput({ kind: "vault.rotation_due" }), sender));
});

// ---- hours and away ----

test("working hours: inside them an Interrupt interrupts; outside only calls, incidents, reminders and urgent approvals do", async () => {
  const h = harness();
  assert.equal(withinHours({ days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00", tz: "UTC" }, NOW), true);
  h.setNow(Date.UTC(2025, 9, 9, 22, 0, 0));   // Thursday 22:00 UTC
  const dm = await h.call("notifications.send", sendInput({ kind: "dm" }), sender);
  assert.equal(dm.outcome, "badge", "a message waits as a badge");
  assert.deepEqual([row(h, dm.notificationId).level, h.pushes.length], ["badge", 0]);
  for (const kind of ["call.incoming", "incident.owned", "approval.backstop"]) {
    const r = await h.call("notifications.send", sendInput({ kind, data: { title: "x", from: "Bob" } }), sender);
    assert.equal(r.outcome, "interrupt", kind);
  }
  const urgent = await h.call("notifications.send", sendInput({ kind: "approval.requested", title: "Wire", data: { urgent: true } }), sender);
  assert.equal(urgent.outcome, "interrupt");
  const normal = await h.call("notifications.send", sendInput({ kind: "approval.requested", title: "Retainer" }), sender);
  assert.equal(normal.outcome, "badge");
});

test("working hours handle a zone, a weekend and an overnight shift", () => {
  const karachi = { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00", tz: "Asia/Karachi" };
  assert.equal(withinHours(karachi, Date.UTC(2025, 9, 9, 5, 0, 0)), true, "10:00 in Karachi");
  assert.equal(withinHours(karachi, Date.UTC(2025, 9, 9, 13, 30, 0)), false, "18:30 in Karachi");
  assert.equal(withinHours(karachi, Date.UTC(2025, 9, 11, 5, 0, 0)), false, "Saturday");
  const night = { days: [4], from: "22:00", to: "06:00", tz: "UTC" };
  assert.equal(withinHours(night, Date.UTC(2025, 9, 9, 23, 0, 0)), true, "Thursday 23:00");
  assert.equal(withinHours(night, Date.UTC(2025, 9, 10, 3, 0, 0)), true, "Friday 03:00 belongs to Thursday's shift");
  assert.equal(withinHours(night, Date.UTC(2025, 9, 9, 3, 0, 0)), false, "Thursday 03:00 belongs to Wednesday's");
  assert.equal(withinHours(undefined, NOW), true);
});

test("a person with working hours turned off is interrupted at any hour", async () => {
  const h = harness();
  await h.call("notifications.rules.set", { workingHours: null }, me);
  h.setNow(Date.UTC(2025, 9, 11, 3, 0, 0));
  assert.equal((await h.call("notifications.send", sendInput({ kind: "dm" }), sender)).outcome, "interrupt");
});

test("while away only calls interrupt; the rest wait in the digest", async () => {
  const h = harness();
  await h.call("notifications.away.set", { until: NOW + 8 * HOUR, delegate: { kind: "none" } }, me);
  assert.equal((await h.call("notifications.send", sendInput({ kind: "dm" }), sender)).outcome, "digest");
  assert.equal((await h.call("notifications.send", sendInput({ kind: "approval.requested", title: "x" }), sender)).outcome, "digest");
  assert.equal((await h.call("notifications.send", sendInput({ kind: "call.incoming", data: { from: "Lee" } }), sender)).outcome, "interrupt");
  assert.equal((await h.call("notifications.send", sendInput({ kind: "task.assigned", data: { from: "Bob", title: "x" } }), sender)).outcome, "badge", "badges stay badges");
  h.advance(9 * HOUR);   // the away time passed
  assert.equal((await h.call("notifications.send", sendInput({ kind: "dm" }), sender)).outcome, "badge", "outside hours at 19:00");
});

// ---- collapse ----

test("repeats with the same key collapse into one row with a count", async () => {
  const h = harness();
  const first = await h.call("notifications.send", sendInput({ kind: "reply.followed", data: { where: "Intake" }, collapseKey: "thread:1" }), sender);
  h.advance(MIN);
  const second = await h.call("notifications.send", sendInput({ kind: "reply.followed", data: { where: "Intake" }, collapseKey: "thread:1" }), sender);
  h.advance(MIN);
  const third = await h.call("notifications.send", sendInput({ kind: "reply.followed", data: { where: "Intake" }, collapseKey: "thread:1" }), sender);
  assert.equal(second.notificationId, first.notificationId);
  assert.equal(third.notificationId, first.notificationId);
  assert.equal(rows(h).length, 1);
  assert.equal(rows(h)[0].count, 3);
  assert.equal(rows(h)[0].at, NOW + 2 * MIN, "the row moves to the newest time");
  assert.equal(h.events[0]!.payload.collapsed, true);
});

test("without a key the subject makes one; no subject and no key never collapses", async () => {
  const h = harness();
  const s = { type: "task", id: "tsk_1" };
  const a = await h.call("notifications.send", sendInput({ kind: "task.assigned", subject: s, data: { from: "Bob", title: "x" } }), sender);
  const b = await h.call("notifications.send", sendInput({ kind: "task.assigned", subject: s, data: { from: "Bob", title: "x" } }), sender);
  assert.equal(a.notificationId, b.notificationId);
  const c = await h.call("notifications.send", sendInput({ kind: "dm" }), sender);
  const d = await h.call("notifications.send", sendInput({ kind: "dm" }), sender);
  assert.notEqual(c.notificationId, d.notificationId);
});

test("a seen row is not collapsed into: a new event is a new row", async () => {
  const h = harness();
  const a = await h.call("notifications.send", sendInput({ kind: "reply.followed", collapseKey: "k" }), sender);
  await h.call("notifications.mark_seen", { notificationIds: [a.notificationId] }, me);
  const b = await h.call("notifications.send", sendInput({ kind: "reply.followed", collapseKey: "k" }), sender);
  assert.notEqual(a.notificationId, b.notificationId);
});

test("collapse is per person and a louder repeat raises the row", async () => {
  const h = harness();
  const a = await h.call("notifications.send", sendInput({ kind: "dm", to: alice.id, collapseKey: "c" }), sender);
  const other = await h.call("notifications.send", sendInput({ kind: "dm", to: bob.id, collapseKey: "c" }), sender);
  assert.notEqual(a.notificationId, other.notificationId);
  h.setNow(Date.UTC(2025, 9, 9, 22, 0, 0));
  const quiet = await h.call("notifications.send", sendInput({ kind: "approval.requested", title: "x", collapseKey: "u", subject: { type: "task", id: "tsk_9" } }), sender);
  assert.equal(quiet.outcome, "badge");
  const loud = await h.call("notifications.send", sendInput({ kind: "approval.requested", title: "x", collapseKey: "u", data: { urgent: true } }), sender);
  assert.equal(loud.notificationId, quiet.notificationId);
  assert.equal(loud.outcome, "interrupt");
  assert.equal(row(h, quiet.notificationId).level, "interrupt");
  const again = await h.call("notifications.send", sendInput({ kind: "approval.requested", title: "x", collapseKey: "u", data: { urgent: false } }), sender);
  assert.equal(again.outcome, "interrupt", "a repeat never lowers a row that was louder");
});

// ---- the agent interrupt cap ----

test("agent cap: an agent cannot interrupt a person more than 3 times an hour; the rest go to the digest and the agent is told", async () => {
  const h = harness();
  const agent = as(bot);
  const outcomes: string[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await h.call("notifications.send", sendInput({ kind: "dm", data: { from: "Scout", agentId: bot.id, n: i } }), agent);
    outcomes.push(r.outcome);
  }
  assert.deepEqual(outcomes, ["interrupt", "interrupt", "interrupt", "capped", "capped"]);
  assert.deepEqual(rows(h).map((r) => r.level), ["interrupt", "interrupt", "interrupt", "digest", "digest"], "capped ones are kept as digest rows");
  assert.deepEqual(h.events.map((e) => e.name), ["notification.capped", "notification.delivered"]);
  assert.deepEqual(h.events[0]!.payload, { person: alice.id, agentId: bot.id, kind: "dm", perHour: 3 });
  assert.equal(h.pushes.length, 0, "no device is registered, and a capped one never pushes");
});

test("agent cap: counted per agent and per person, and the hour rolls", async () => {
  const h = harness();
  const send = (agentId: string, to = alice.id) => h.call("notifications.send", sendInput({ to, kind: "agent.blocked", data: { agent: "A", reason: "r", agentId } }), as(bot));
  for (let i = 0; i < 3; i++) assert.equal((await send(bot.id)).outcome, "interrupt");
  assert.equal((await send(bot.id)).outcome, "capped");
  assert.equal((await send(bot2.id)).outcome, "interrupt", "another agent has its own 3");
  assert.equal((await send(bot.id, bob.id)).outcome, "interrupt", "another person has their own 3");
  h.advance(HOUR + 1);
  assert.equal((await send(bot.id)).outcome, "interrupt", "an hour later the agent can interrupt again");
});

test("agent cap: a person's own and a service's notifications are not capped, nor are kinds without an agent rate key, nor a repeat into a row that is already loud", async () => {
  const h = harness();
  for (let i = 0; i < 5; i++) assert.equal((await h.call("notifications.send", sendInput({ kind: "dm", data: { from: "Bob" } }), sender)).outcome, "interrupt");
  for (let i = 0; i < 5; i++) assert.equal((await h.call("notifications.send", sendInput({ kind: "call.incoming", data: { from: "Scout", agentId: bot.id } }), as(bot))).outcome, "interrupt");
  const same = (n: number) => h.call("notifications.send", sendInput({ kind: "dm", data: { from: "Scout", agentId: bot2.id, n }, collapseKey: "one-thread" }), as(bot2));
  for (let i = 0; i < 6; i++) assert.equal((await same(i)).outcome, "interrupt", "six messages in one thread are one banner, not six interrupts");
});

test("agent cap: a demoted one (outside hours) does not use up the 3", async () => {
  const h = harness();
  h.setNow(Date.UTC(2025, 9, 9, 22, 0, 0));
  for (let i = 0; i < 4; i++) assert.equal((await h.call("notifications.send", sendInput({ kind: "dm", data: { agentId: bot.id } }), as(bot))).outcome, "badge");
  h.setNow(Date.UTC(2025, 9, 10, 10, 0, 0));
  assert.equal((await h.call("notifications.send", sendInput({ kind: "dm", data: { agentId: bot.id } }), as(bot))).outcome, "interrupt");
});

// ---- mutes ----

test("a mute silences a sender for an hour, then ends; a person's own approvals clock is not muted", async () => {
  const h = harness();
  await h.call("notifications.mute.set", { target: { kind: "person", id: "usr_bob" } }, me);
  const muted = await h.call("notifications.send", sendInput({ kind: "dm", data: { fromId: "usr_bob", from: "Bob" } }), sender);
  assert.deepEqual(muted, { outcome: "dropped_muted" });
  assert.equal(rows(h).length, 0);
  const other = await h.call("notifications.send", sendInput({ kind: "dm", data: { fromId: "usr_cara", from: "Cara" } }), sender);
  assert.equal(other.outcome, "interrupt");
  const backstop = await h.call("notifications.send", sendInput({ kind: "approval.backstop", title: "x", data: { fromId: "usr_bob" } }), sender);
  assert.equal(backstop.outcome, "interrupt", "a reminder is never muted");
  h.advance(HOUR + 1);
  assert.equal((await h.call("notifications.send", sendInput({ kind: "dm", data: { fromId: "usr_bob", from: "Bob" } }), sender)).outcome, "interrupt");
});

test("muted agents, channels and records from settings silence what they send", async () => {
  const h = harness();
  await h.call("notifications.rules.set", { mutedAgents: [bot.id], mutedChannels: ["chn_sales"], mutedRecords: ["rec_lee"] }, me);
  assert.equal((await h.call("notifications.send", sendInput({ kind: "dm", data: { agentId: bot.id } }), sender)).outcome, "dropped_muted");
  assert.equal((await h.call("notifications.send", sendInput({ kind: "mention", data: { from: "x", where: "y", channelId: "chn_sales" } }), sender)).outcome, "dropped_muted");
  assert.equal((await h.call("notifications.send", sendInput({ kind: "reply.followed", subject: { type: "record", id: "rec_lee" } }), sender)).outcome, "dropped_muted");
  assert.equal((await h.call("notifications.send", sendInput({ kind: "reply.followed", subject: { type: "record", id: "rec_other" } }), sender)).outcome, "badge");
});

// ---- the approval reminder ----

test("an approval schedules one reminder at the backstop hour with the same collapse key; a repeat does not schedule another", async () => {
  const h = harness();
  const s = { type: "task", id: "tsk_77" };
  await h.call("notifications.send", sendInput({ kind: "approval.requested", subject: s, title: "Retainer" }), sender);
  await h.call("notifications.send", sendInput({ kind: "approval.requested", subject: s, title: "Retainer" }), sender);
  assert.equal(h.schedules.length, 1);
  assert.equal(h.schedules[0]!.at, NOW + 4 * HOUR);
  assert.equal(h.schedules[0]!.cap, "notifications.send");
  assert.deepEqual(h.schedules[0]!.input, { to: alice.id, kind: "approval.backstop", subject: s, title: "Retainer", collapseKey: "approval.backstop:tsk_77" });
});

test("no reminder is scheduled when the person turned the backstop off or there is no scheduler", async () => {
  const h = harness();
  await h.call("notifications.rules.set", { emailBackstop: false }, me);
  await h.call("notifications.send", sendInput({ kind: "approval.requested", subject: { type: "task", id: "tsk_1" }, title: "x" }), sender);
  assert.equal(h.schedules.length, 0);
  const g = harness({ noScheduler: true });
  const r = await g.call("notifications.send", sendInput({ kind: "approval.requested", subject: { type: "task", id: "tsk_1" }, title: "x" }), sender);
  assert.equal(r.outcome, "interrupt", "sending still works");
});

test("the reminder emails once per approval, and says nothing when the approval is already done", async () => {
  const h = harness();
  const s = { type: "task", id: "tsk_5" };
  const input = sendInput({ kind: "approval.backstop", subject: s, title: "Retainer", collapseKey: "approval.backstop:tsk_5" });
  await h.call("notifications.send", input, sender);
  await h.call("notifications.send", input, sender);
  assert.deepEqual(h.emails, [{ to: alice.id, subject: "Something is waiting on you", deepLink: "vyre://task/tsk_5" }]);
  const g = harness();
  g.callee("tasks.get", () => ({ task: { state: "done" } }));
  assert.deepEqual(await g.call("notifications.send", input, sender), { outcome: "dropped_muted" });
  assert.equal(g.emails.length, 0);
  const off = harness();
  await off.call("notifications.rules.set", { emailBackstop: false }, me);
  await off.call("notifications.send", input, sender);
  assert.equal(off.emails.length, 0);
});

// ---- the fanout consumer ----

test("the fanout consumer files a row for the events that name a kind and ignores the others", async () => {
  const h = harness();
  const ctx = h.ctxFor(null, sender);
  const fan = consumers["notifications.fanout"];
  assert.deepEqual(fan.on, ["task.requested", "task.assigned", "run.failed", "member.joined"]);
  const a = await fan.run(ctx, { name: "task.requested", payload: { taskId: "tsk_1", kind: "approve", title: "Retainer", assigned: { kind: "person", id: alice.id } } });
  assert.equal(a.length, 1);
  assert.equal(row(h, a[0]!).kind, "approval.requested");
  assert.equal(row(h, a[0]!).title, "Approval needed: Retainer");
  assert.deepEqual(await fan.run(ctx, { name: "task.requested", payload: { taskId: "tsk_2", kind: "approve", title: "x", assigned: { kind: "role", id: "rol_admin" } } }), [], "a role is reached through Needs you");
  const b = await fan.run(ctx, { name: "task.assigned", payload: { taskId: "tsk_3", slot: "assigned", to: { kind: "person", id: bob.id }, from: null } });
  assert.equal(row(h, b[0]!).person, bob.id);
  assert.deepEqual(await fan.run(ctx, { name: "task.assigned", payload: { taskId: "tsk_3", slot: "reviewer", to: { kind: "person", id: bob.id }, from: null } }), []);
  const c = await fan.run(ctx, { name: "run.failed", payload: { runId: "run_1", kind: "Weekly", code: "x", message: "no mailbox", owner: alice.id } });
  assert.equal(row(h, c[0]!).title, "Weekly failed: no mailbox");
  const d = await fan.run(ctx, { name: "member.joined", payload: { personId: "usr_new", inviteId: "inv_1", role: "member", invitedBy: alice.id } });
  assert.equal(row(h, d[0]!).level, "digest");
  assert.deepEqual(await fan.run(ctx, { name: "something.else", payload: {} }), []);
});
