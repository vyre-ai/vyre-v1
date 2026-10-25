// The notifications capabilities around send: lists and paging, counts for the rail, seen, kinds, settings, mutes, away and I'm Back, delegates, the digest collector, and that every
// capability in the contract has a real handler.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { HOUR, MIN, NOW, alice, as, bob, cara, sendInput, svc } from "../fixtures/seed.ts";
import { handlers } from "../impl.ts";
import { registry } from "../../../generated/registry.ts";

const me = as(alice);
const sender = as(svc);
const send = (h: Harness, over: Record<string, unknown> = {}): Promise<any> => h.call("notifications.send", sendInput(over), sender);   // eslint-disable-line @typescript-eslint/no-explicit-any
async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); return true; });
}

test("every capability in the contract has a real handler", () => {
  const want = registry.capabilities.filter((c) => c.module === "notifications").map((c) => c.name).sort();
  assert.equal(want.length, 20);
  assert.deepEqual(Object.keys(handlers).sort(), want);
});

// ---- list, counts, seen ----

test("the list is mine only, newest first, filtered by place, level and unseen, and pages with a cursor", async () => {
  const h = harness();
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) { ids.push((await send(h, { kind: "reply.followed", data: { where: `T${i}` }, collapseKey: `k${i}` })).notificationId); h.advance(MIN); }
  await send(h, { to: bob.id, kind: "reply.followed", collapseKey: "bobs" });
  await send(h, { kind: "dm" });
  const all = await h.call("notifications.list", {}, me);
  assert.equal(all.total, 6);
  assert.equal(all.notifications[0].kind, "dm", "newest first");
  assert.ok(all.notifications.every((n: { spaceId: string }) => n.spaceId === "spc_test"));
  assert.deepEqual((await h.call("notifications.list", { place: "inbox" }, me)).notifications.map((n: { title: string }) => n.title), ["New reply on T4", "New reply on T3", "New reply on T2", "New reply on T1", "New reply on T0"]);
  assert.equal((await h.call("notifications.list", { level: "interrupt" }, me)).notifications.length, 1);
  await h.call("notifications.mark_seen", { notificationIds: [ids[0]!] }, me);
  assert.equal((await h.call("notifications.list", { unseenOnly: true }, me)).notifications.length, 5);

  const p1 = await h.call("notifications.list", { place: "inbox", limit: 2 }, me);
  assert.equal(p1.notifications.length, 2);
  assert.ok(p1.next);
  const p2 = await h.call("notifications.list", { place: "inbox", limit: 2, cursor: p1.next }, me);
  const p3 = await h.call("notifications.list", { place: "inbox", limit: 2, cursor: p2.next }, me);
  assert.deepEqual([...p1.notifications, ...p2.notifications, ...p3.notifications].map((n: { id: string }) => n.id), [...ids].reverse());
  assert.equal(p3.next, undefined);
  assert.equal(p1.total, 5);
  await refused(h.call("notifications.list", { cursor: "garbage" }, me), "validation.bad_input");
  assert.deepEqual((await h.call("notifications.list", {}, as(cara))).notifications, []);
});

test("counts: the rail shows Needs you and direct conversations only; other places get a dot; digest never counts", async () => {
  const h = harness();
  await send(h, { kind: "approval.requested", title: "a", collapseKey: "1" });
  await send(h, { kind: "approval.requested", title: "b", collapseKey: "2" });
  await send(h, { kind: "dm" });
  await send(h, { kind: "mention", data: { from: "x", where: "y" } });
  await send(h, { kind: "reply.followed", collapseKey: "r" });
  await send(h, { kind: "reply.followed", collapseKey: "r" });
  await send(h, { kind: "run.failed", data: { name: "n", message: "m" } });
  await send(h, { kind: "member.joined", data: { name: "n", space: "s" } });
  await send(h, { kind: "digest.away" });
  await send(h, { to: bob.id, kind: "dm" });
  const c = await h.call("notifications.counts", {}, me);
  assert.deepEqual(c.rail, { needsYou: 2, directConversations: 2 });
  assert.deepEqual(c.dots, { inbox: 2, automations: 1 }, "a repeat counts as its repeats");
  assert.deepEqual(c.otherSpaces, []);
  await h.call("notifications.mark_seen", { place: "chats" }, me);
  assert.deepEqual((await h.call("notifications.counts", {}, me)).rail, { needsYou: 0, directConversations: 0 });
});

test("mark_seen: by ids, by place, or all; only mine; emits once with the ids; nothing to mark is no event", async () => {
  const h = harness();
  const a = await send(h, { kind: "reply.followed", collapseKey: "a" });
  const b = await send(h, { kind: "reply.followed", collapseKey: "b" });
  const c = await send(h, { kind: "dm" });
  const other = await send(h, { to: bob.id, kind: "dm" });
  assert.deepEqual(await h.call("notifications.mark_seen", { notificationIds: [a.notificationId, other.notificationId] }, me), { marked: 1 }, "someone else's id is ignored");
  assert.deepEqual(h.events.map((e) => [e.name, e.payload.notificationIds]), [["notification.seen", [a.notificationId]]]);
  assert.deepEqual(await h.call("notifications.mark_seen", { notificationIds: [a.notificationId] }, me), { marked: 0 });
  assert.deepEqual(h.events, []);
  assert.deepEqual(await h.call("notifications.mark_seen", { notificationIds: [] }, me), { marked: 0 });
  assert.deepEqual(await h.call("notifications.mark_seen", { place: "chats" }, me), { marked: 1 });
  assert.deepEqual(await h.call("notifications.mark_seen", {}, me), { marked: 1 }, "all that is left");
  const seen = h.sqlite.prepare("SELECT id FROM notifications_items WHERE seen_at IS NOT NULL ORDER BY id").all().map((r: any) => r.id);   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(seen, [a.notificationId, b.notificationId, c.notificationId].sort());
  assert.equal(h.sqlite.prepare("SELECT seen_at FROM notifications_items WHERE id = ?").get(other.notificationId)!.seen_at, null);
});

test("kinds.list names every kind the contract can send with its level, place and whether it respects hours", async () => {
  const h = harness();
  const { kinds } = await h.call("notifications.kinds.list", {}, me);
  assert.equal(kinds.length, 22);
  assert.deepEqual(kinds.find((k: { key: string }) => k.key === "call.incoming"), { key: "call.incoming", level: "interrupt", place: "inbox", title: "Incoming call from {{from}}", respectHours: false });
  assert.equal(kinds.filter((k: { level: string }) => k.level === "interrupt").length, 7);
});

// ---- settings ----

test("rules: defaults, partial changes, hours off and back, validation, and one event naming only what changed", async () => {
  const h = harness();
  const first = (await h.call("notifications.rules.get", {}, me)).rules;
  assert.deepEqual(first, { workingHours: { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00", tz: "UTC" }, emailBackstop: true, mutedAgents: [], mutedChannels: [], mutedRecords: [] });
  const hours = { days: [3, 1, 2], from: "08:00", to: "16:30", tz: "Asia/Karachi" };
  const set = (await h.call("notifications.rules.set", { workingHours: hours, mutedAgents: ["agt_x", "agt_x"] }, me)).rules;
  assert.deepEqual(set.workingHours, { ...hours, days: [1, 2, 3] });
  assert.deepEqual(set.mutedAgents, ["agt_x"]);
  assert.deepEqual(h.events.map((e) => [e.name, e.payload.fields]), [["notification.rules_changed", ["workingHours", "mutedAgents"]]]);
  await h.call("notifications.rules.set", { emailBackstop: false }, me);
  assert.deepEqual(h.events[0]!.payload.fields, ["emailBackstop"]);
  const kept = (await h.call("notifications.rules.get", {}, me)).rules;
  assert.deepEqual([kept.emailBackstop, kept.mutedAgents, kept.workingHours.tz], [false, ["agt_x"], "Asia/Karachi"], "fields not sent are kept");
  await h.call("notifications.rules.set", { emailBackstop: false }, me);
  assert.deepEqual(h.events, [], "no change, no event");
  assert.equal((await h.call("notifications.rules.set", { workingHours: null }, me)).rules.workingHours, undefined);
  assert.equal((await h.call("notifications.rules.get", {}, me)).rules.workingHours, undefined);
  await refused(h.call("notifications.rules.set", { workingHours: { days: [1, 1], from: "09:00", to: "10:00", tz: "UTC" } }, me), "validation.bad_input");
  await refused(h.call("notifications.rules.set", { workingHours: { days: [1], from: "09:00", to: "10:00", tz: "Mars/Olympus" } }, me), "validation.bad_input");
  assert.deepEqual((await h.call("notifications.rules.get", {}, as(bob))).rules.mutedAgents, [], "settings are per person");
});

test("an agent acting for a person changes that person's settings, not its own", async () => {
  const h = harness();
  await h.call("notifications.rules.set", { emailBackstop: false }, { id: "agt_bot", kind: "agent", actingFor: alice.id });
  assert.equal((await h.call("notifications.rules.get", {}, me)).rules.emailBackstop, false);
});

test("mutes: default one hour, minutes, list ordered, clear, and a mute that ended is gone", async () => {
  const h = harness();
  const a = await h.call("notifications.mute.set", { target: { kind: "person", id: "usr_bob" } }, me);
  assert.equal(a.until, NOW + HOUR);
  assert.deepEqual(h.events.map((e) => e.name), ["notification.muted"]);
  const b = await h.call("notifications.mute.set", { target: { kind: "channel", id: "chn_x" }, minutes: 10 }, me);
  assert.equal(b.until, NOW + 10 * MIN);
  const again = await h.call("notifications.mute.set", { target: { kind: "person", id: "usr_bob" }, minutes: 120 }, me);
  assert.equal(again.until, NOW + 2 * HOUR, "muting again moves the end");
  assert.deepEqual((await h.call("notifications.mute.list", {}, me)).mutes, [
    { target: { kind: "channel", id: "chn_x" }, until: NOW + 10 * MIN }, { target: { kind: "person", id: "usr_bob" }, until: NOW + 2 * HOUR },
  ]);
  assert.deepEqual((await h.call("notifications.mute.list", {}, as(bob))).mutes, []);
  h.advance(11 * MIN);
  assert.equal((await h.call("notifications.mute.list", {}, me)).mutes.length, 1);
  assert.deepEqual(await h.call("notifications.mute.clear", { target: { kind: "person", id: "usr_bob" } }, me), { cleared: true });
  assert.deepEqual(h.events.map((e) => e.name), ["notification.unmuted"]);
  assert.deepEqual(await h.call("notifications.mute.clear", { target: { kind: "person", id: "usr_bob" } }, me), { cleared: false });
  assert.deepEqual(h.events, []);
});

// ---- away and delegates ----

test("away: set, get, replace, validation, and I'm Back returns what waited and ends it", async () => {
  const h = harness();
  assert.deepEqual(await h.call("notifications.away.get", {}, me), { away: false });
  await refused(h.call("notifications.away.set", { until: NOW - 1, delegate: { kind: "none" } }, me), "validation.bad_input");
  await refused(h.call("notifications.away.set", { until: NOW + HOUR, delegate: { kind: "person" } }, me), "validation.bad_input");
  await refused(h.call("notifications.away.set", { until: NOW + HOUR, delegate: { kind: "person", id: alice.id } }, me), "validation.precondition_failed");
  assert.deepEqual(await h.call("notifications.away.set", { until: NOW + 8 * HOUR, delegate: { kind: "person", id: bob.id } }, me), { until: NOW + 8 * HOUR });
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["away.set", { person: alice.id, until: NOW + 8 * HOUR, delegate: { kind: "person", id: bob.id } }]]);
  assert.deepEqual(await h.call("notifications.away.get", {}, me), { away: true, until: NOW + 8 * HOUR, delegate: { kind: "person", id: bob.id } });
  assert.deepEqual(await h.call("notifications.away.get", {}, as(bob)), { away: false }, "away is per person");
  h.advance(MIN);
  await send(h, { kind: "approval.requested", title: "a", collapseKey: "1" });
  await send(h, { kind: "approval.requested", title: "b", collapseKey: "2" });
  await send(h, { kind: "member.joined", data: { name: "n", space: "s" } });
  await send(h, { kind: "digest.away" });
  await send(h, { kind: "dm" });
  const back = await h.call("notifications.away.clear", {}, me);
  assert.deepEqual(back, { waitedApprovals: 2, waitedDigest: 5 });
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["away.cleared", { person: alice.id, waitedApprovals: 2, waitedDigest: 5 }]]);
  assert.deepEqual(await h.call("notifications.away.get", {}, me), { away: false });
  assert.deepEqual(await h.call("notifications.away.clear", {}, me), { waitedApprovals: 0, waitedDigest: 0 }, "I'm Back when not away is a no-op");
  assert.deepEqual(h.events, []);
});

test("delegate chain: set, get, no self, no duplicates, event", async () => {
  const h = harness();
  assert.deepEqual(await h.call("notifications.delegate.get", {}, me), { chain: [] });
  const chain = [{ kind: "person", id: bob.id }, { kind: "person", id: cara.id }, { kind: "role", id: "rol_admin" }];
  assert.deepEqual(await h.call("notifications.delegate.set", { chain }, me), { chain });
  assert.deepEqual(h.events.map((e) => e.name), ["notification.delegate_changed"]);
  assert.deepEqual(await h.call("notifications.delegate.get", {}, me), { chain });
  await refused(h.call("notifications.delegate.set", { chain: [{ kind: "person", id: alice.id }] }, me), "validation.precondition_failed");
  await refused(h.call("notifications.delegate.set", { chain: [{ kind: "person", id: bob.id }, { kind: "person", id: bob.id }] }, me), "validation.bad_input");
  await refused(h.call("notifications.delegate.set", { chain: [{ kind: "role" }] }, me), "validation.bad_input");
  assert.deepEqual(await h.call("notifications.delegate.set", { chain: [] }, me), { chain: [] });
});

test("delegate.resolve: the first holder who can act, each person checked for access; a role is returned as is; none stops the walk; the away delegate comes first", async () => {
  const h = harness();
  const item = { type: "task", id: "tsk_1" };
  await h.call("notifications.delegate.set", { chain: [{ kind: "person", id: bob.id }, { kind: "person", id: cara.id }, { kind: "role", id: "rol_admin" }] }, me);
  assert.deepEqual(await h.call("notifications.delegate.resolve", { person: alice.id, resource: item }, sender), { delegate: { kind: "role", id: "rol_admin" }, walked: 3 }, "nobody can act: the role");
  h.callee("access.check", (i: { principal: { id: string } }) => ({ decision: { effect: i.principal.id === cara.id ? "allow" : "deny" } }));
  assert.deepEqual(await h.call("notifications.delegate.resolve", { person: alice.id, resource: item }, sender), { delegate: { kind: "person", id: cara.id }, walked: 2 }, "bob cannot see it, cara can");
  assert.deepEqual(h.callsTo("access.check").map((c) => c.input.principal.id).slice(-2), [bob.id, cara.id]);
  assert.deepEqual(h.callsTo("access.check").at(-1)!.input, { principal: { kind: "person", id: cara.id }, action: { level: "use" }, resource: item });
  h.callee("access.check", () => ({ decision: { effect: "allow" } }));
  await h.call("notifications.away.set", { until: NOW + HOUR, delegate: { kind: "person", id: "usr_dana" } }, me);
  assert.equal((await h.call("notifications.delegate.resolve", { person: alice.id, resource: item }, sender)).delegate.id, "usr_dana", "while away the away delegate is first");
  h.callee("access.check", () => { throw new Error("down"); });
  assert.deepEqual((await h.call("notifications.delegate.resolve", { person: alice.id, resource: item }, sender)).delegate, { kind: "role", id: "rol_admin" }, "a delegate that cannot be checked never gains access");
  await h.call("notifications.delegate.set", { chain: [{ kind: "none" }, { kind: "person", id: cara.id }] }, as(bob));
  assert.deepEqual(await h.call("notifications.delegate.resolve", { person: bob.id, resource: item }, sender), { walked: 0 }, "none ends the walk");
  assert.deepEqual(await h.call("notifications.delegate.resolve", { person: cara.id, resource: item }, sender), { walked: 0 }, "no chain, no delegate");
});

// ---- the digest ----

test("digest.collect: digest-level rows of a period for a person, oldest first, with counts; only the person or a service may ask", async () => {
  const h = harness();
  await send(h, { kind: "member.joined", data: { name: "A", space: "S" } });
  h.advance(MIN);
  await send(h, { kind: "digest.away", collapseKey: "d" });
  await send(h, { kind: "digest.away", collapseKey: "d" });
  await send(h, { kind: "dm" });
  await send(h, { to: bob.id, kind: "member.joined", data: { name: "B", space: "S" } });
  const got = await h.call("notifications.digest.collect", { person: alice.id, since: NOW - 1 }, me);
  assert.deepEqual(got.items.map((i: { kind: string; count: number; title: string }) => [i.kind, i.count, i.title]), [["member.joined", 1, "A joined S"], ["digest.away", 2, "While you were away"]]);
  assert.equal((await h.call("notifications.digest.collect", { person: alice.id, since: NOW }, sender)).items.length, 1, "since is exclusive");
  assert.equal((await h.call("notifications.digest.collect", { person: alice.id, since: NOW - 1, until: NOW }, sender)).items.length, 1, "until is inclusive");
  await refused(h.call("notifications.digest.collect", { person: alice.id, since: 0 }, as(bob)), "permission.no_grant");
});
