// P-L9_16 notifications UI: which notifications need the person now, collapse by key, place marks, the offline queue line. (The notices themselves live in the top bar's slot: shell/noticeslot.)
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueueIndicator } from "./QueueIndicator.tsx";
import { collapseKey, placeMarks, queueLine, wantsBanner } from "./model.ts";
import type { Notification } from "./model.ts";

const n = (id: string, over: Partial<Notification> = {}): Notification => ({
  id, kind: "approval.requested", level: "interrupt", place: "chats", title: `Approval needed: ${id}`, count: 1, at: 1, actions: [{ label: "Approve", cap: "tasks.act" }, { label: "Send back", cap: "tasks.act" }], spaceId: "spc_1", ...over,
});

test("only an unseen Interrupt notification gets a banner", () => {
  assert.ok(wantsBanner(n("a")));
  assert.ok(!wantsBanner(n("b", { level: "badge" })));
  assert.ok(!wantsBanner(n("c", { level: "digest" })));
  assert.ok(!wantsBanner(n("d", { seenAt: 5 })));
});

test("the same key collapses: a thread by its subject, anything else by its title", () => {
  const subject = { type: "thread" as const, id: "thr_1" };
  assert.equal(collapseKey(n("a", { kind: "mention", subject, title: "Maya mentioned you in Intake" })), collapseKey(n("c", { kind: "mention", subject, title: "Maya mentioned you again" })));
  assert.equal(collapseKey(n("x", { title: "t" })), "approval.requested|t");
});

test("places: a dot for anything unseen, a rail count only for Needs you and direct conversations", () => {
  const marks = placeMarks([
    n("a"), n("b", { kind: "dm", place: "chats" }), n("c", { kind: "task.assigned", level: "badge", place: "home" }),
    n("d", { kind: "run.failed", level: "badge", place: "automations", count: 2 }), n("e", { kind: "digest.away", level: "digest", place: "home" }), n("f", { seenAt: 9, place: "inbox" }),
  ]);
  assert.deepEqual(marks.chats, { dot: true, count: 2, sidebar: 2 });
  assert.deepEqual(marks.home, { dot: true, count: 0, sidebar: 1 });
  assert.deepEqual(marks.automations, { dot: true, count: 0, sidebar: 2 });
  assert.equal(marks.inbox, undefined, "seen items and digest items leave no mark");
});

test("the title bar says what waits offline", () => {
  assert.equal(queueLine(true, 0), null);
  assert.deepEqual(queueLine(false, 3), { text: "Offline, 3 changes waiting", tone: "attention" });
  assert.deepEqual(queueLine(false, 1), { text: "Offline, 1 change waiting", tone: "attention" });
  assert.deepEqual(queueLine(false, 0), { text: "Offline", tone: "attention" });
  assert.deepEqual(queueLine(true, 2), { text: "Sending 2 changes", tone: "quiet" });
  assert.equal(queueLine(true, 2, 1)?.text, "1 conflict to look at");
  assert.match(renderToStaticMarkup(<QueueIndicator online={false} waiting={3} onOpen={() => {}} />), /Offline, 3 changes waiting/);
  assert.equal(renderToStaticMarkup(<QueueIndicator online waiting={0} onOpen={() => {}} />), "");
});
