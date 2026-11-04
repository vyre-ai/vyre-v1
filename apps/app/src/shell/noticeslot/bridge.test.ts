// Everything that needs the person is one place (owner, 4 Nov): replies, mentions and messages (Open), held approvals (Review), alerts about the Space (Open), an update (Restart). Each is a persisting
// notice with exactly one action; none is dismissed, each goes when the thing is seen or settled.
import test from "node:test";
import assert from "node:assert/strict";
import { noticeKindOf, noticeText, syncNotifications, updateNoticeFrom } from "./bridge.ts";
import { createNoticeStore } from "./model.ts";
import type { UpdateSource } from "./bridge.ts";
import type { Notification } from "../notifications/model.ts";

const n = (id: string, over: Partial<Notification> = {}): Notification => ({
  id, kind: "reply.thread", level: "interrupt", place: "chats", title: `Dana Whitfield replied`, count: 1, at: 1, actions: [{ label: "Reply", cap: "chat.post" }], spaceId: "spc_1", ...over,
}) as Notification;

test("replies, mentions and messages say Open; approvals say Review; alerts about the Space say Open", () => {
  assert.deepEqual(noticeKindOf({ kind: "reply.thread" }), { kind: "reply", label: "Open" });
  assert.deepEqual(noticeKindOf({ kind: "mention" }), { kind: "reply", label: "Open" });
  assert.deepEqual(noticeKindOf({ kind: "dm" }), { kind: "reply", label: "Open" });
  assert.deepEqual(noticeKindOf({ kind: "approval.requested" }), { kind: "approval", label: "Review" });
  assert.deepEqual(noticeKindOf({ kind: "approval.backstop" }), { kind: "approval", label: "Review" });
  assert.deepEqual(noticeKindOf({ kind: "task.turn" }), { kind: "approval", label: "Review" }, "work handed in for the person's turn");
  assert.deepEqual(noticeKindOf({ kind: "health.degraded" }), { kind: "machine", label: "Open" });
  assert.deepEqual(noticeKindOf({ kind: "incident.owned" }), { kind: "machine", label: "Open" });
  assert.equal(noticeText({ title: "Maya replied in #intake", count: 3 }), "Maya replied in #intake · 3 new");
  assert.equal(noticeText({ title: "3 new replies in #intake", count: 3 }), "3 new replies in #intake", "a title that says how many is not said twice");
});

test("every unseen interrupt notification is a persisting notice with one action; one that is seen elsewhere goes; a repeat in a thread is one notice", () => {
  const store = createNoticeStore();
  const acted: string[] = [];
  const subject = { type: "thread" as const, id: "thr_1" };
  let seen = syncNotifications(store, new Set(), [
    n("a", { subject }), n("b", { kind: "approval.requested", title: "Send 12 invoices", actions: [{ label: "Approve", cap: "tasks.act" }, { label: "Send back", cap: "tasks.act" }] }),
    n("c", { subject, title: "Dana Whitfield replied again" }), n("d", { level: "badge" }), n("e", { seenAt: 5 }),
  ], (x) => acted.push(x.id));
  const live = store.getSnapshot().live;
  assert.equal(live.length, 2, "a and c are one thread; a badge and a seen row are not here");
  assert.deepEqual(live.map((x) => x.kind), ["approval", "reply"], "the approval is more important");
  assert.ok(live.every((x) => x.persist && x.action !== undefined), "each stays until settled and has one action");
  assert.deepEqual(live.map((x) => x.action!.label), ["Review", "Open"]);
  live[0]!.action!.run();
  assert.deepEqual(acted, ["b"]);
  // the approval was settled somewhere else: the next read no longer has it
  seen = syncNotifications(store, seen, [n("a", { subject })], (x) => acted.push(x.id));
  assert.deepEqual(store.getSnapshot().live.map((x) => x.kind), ["reply"]);
  assert.equal(store.getSnapshot().recent[0]!.text, "Send 12 invoices", "it shows under recent");
  syncNotifications(store, seen, [], () => undefined);
  assert.equal(store.getSnapshot().live.length, 0);
});

test("an update that is ready is a persisting notice with Restart; installing says so; none waiting clears it", () => {
  const store = createNoticeStore();
  let state: ReturnType<UpdateSource["state"]> = { check: { phase: "available", version: "1.0.0-rc.22" }, installing: false };
  const restarted: string[] = [];
  const src: UpdateSource = { state: () => state, subscribe: () => () => undefined, install: () => { restarted.push("go"); } };
  updateNoticeFrom(src, store);
  const top = store.getSnapshot().live[0]!;
  assert.deepEqual([top.kind, top.text, top.action?.label, top.persist], ["update", "Vyre 1.0.0-rc.22 is ready", "Restart", true]);
  top.action!.run();
  assert.deepEqual(restarted, ["go"]);
  state = { check: { phase: "available", version: "1.0.0-rc.22" }, installing: true };
  updateNoticeFrom(src, store);
  assert.deepEqual([store.getSnapshot().live[0]!.text, store.getSnapshot().live[0]!.action], ["Updating to 1.0.0-rc.22", undefined]);
  state = { check: { phase: "uptodate", version: null }, installing: false };
  updateNoticeFrom(src, store);
  assert.equal(store.getSnapshot().live.length, 0);
  // a browser has nothing to restart: no notice
  updateNoticeFrom({ state: () => ({ check: { phase: "available", version: "9" }, installing: false }), subscribe: () => () => undefined }, store);
  assert.equal(store.getSnapshot().live.length, 0);
});
