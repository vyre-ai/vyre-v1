// A reply in a chat thread you follow (reply.thread, audit Threads 1): it interrupts with a Reply action, in Chats; a burst in one thread is one row that says how many ("3 new replies in
// #intake") and pushes once; a muted thread or sender stays quiet; quiet hours hold it like any other message.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { MIN, alice, as, sendInput, svc } from "../fixtures/seed.ts";
import { consumers, kindOf } from "../impl.ts";

const sender = as(svc);
const me = as(alice);
const rows = (h: Harness): any[] => h.sqlite.prepare("SELECT * FROM notifications_items ORDER BY rowid").all() as any[];   // eslint-disable-line @typescript-eslint/no-explicit-any
const reply = (from: string, over: Record<string, unknown> = {}): Record<string, unknown> =>
  sendInput({ kind: "reply.thread", subject: { type: "thread", id: "thr_rivera" }, data: { from, fromId: "usr_maya", where: "#intake", threadId: "thr_rivera" }, collapseKey: "reply.thread:thr_rivera", body: `${from} says hi`, ...over });

test("reply.thread interrupts in Chats with a Reply action", () => {
  const k = kindOf("reply.thread")!;
  assert.deepEqual([k.level, k.place, k.title, k.actions], ["interrupt", "chats", "{{from}} replied in {{where}}", [{ label: "Reply", cap: "chat.post" }]]);
  assert.equal(k.respectHours, true, "outside working hours it waits as a dot");
});

test("three replies in a minute are one row that says 3 new replies, and it interrupts once", async () => {
  const h = harness();
  const a = await h.call("notifications.send", reply("Maya Chen"), sender);
  assert.equal(a.outcome, "interrupt");
  assert.equal(rows(h)[0].title, "Maya Chen replied in #intake");
  h.advance(20_000);
  await h.call("notifications.send", reply("Leo Park"), sender);
  h.advance(20_000);
  const c = await h.call("notifications.send", reply("Maya Chen"), sender);
  assert.equal(c.notificationId, a.notificationId);
  const r = rows(h);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].count, r[0].title, r[0].body], [3, "3 new replies in #intake", "Maya Chen says hi"], "the newest line under the count");
  assert.deepEqual(h.events.map((e) => e.payload.collapsed), [false, true, true]);
  // seen, the next reply is news again
  await h.call("notifications.mark_seen", { notificationIds: [a.notificationId] }, me);
  h.advance(MIN);
  const d = await h.call("notifications.send", reply("Leo Park"), sender);
  assert.notEqual(d.notificationId, a.notificationId);
  assert.equal(rows(h)[1].title, "Leo Park replied in #intake");
});

test("a muted thread or a muted sender stays quiet; quiet hours hold the reply", async () => {
  const h = harness();
  await h.call("notifications.mute.set", { target: { kind: "thread", id: "thr_rivera" }, minutes: 60 }, me);
  assert.equal((await h.call("notifications.send", reply("Maya Chen"), sender)).outcome, "dropped_muted");
  const g = harness();
  await g.call("notifications.mute.set", { target: { kind: "person", id: "usr_maya" } }, me);
  assert.equal((await g.call("notifications.send", reply("Maya Chen"), sender)).outcome, "dropped_muted");
  const q = harness();
  await consumers["notifications.settings_sync"].run(q.ctxFor("notifications.send", sender), { name: "settings.changed", payload: { key: "notifications.quiet_hours", scope: "person", person: alice.id, before: null, after: { on: true, from: "09:00", to: "11:30", needs: true }, by: alice.id } });
  assert.equal((await q.call("notifications.send", reply("Maya Chen"), sender)).outcome, "digest", "held until quiet hours end");
});
