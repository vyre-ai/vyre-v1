// A thread opens beside its message (audit Threads 2, 5, 7, 8, 10): the place's route keeps the chat and adds the thread beside it, Escape closes it, the same message asked for again is
// marked again, a task's thread opens on its task, and the follow control says and offers what fits. The Threads page rows, paging and J/K (audit Threads 4, 6).
import test from "node:test";
import assert from "node:assert/strict";
import { START, fromHash, step } from "./route.ts";
import { threadDoor } from "./route.ts";
import { closesSide, followLabel, followMenu, modeOf } from "./thread-side.ts";
import { mergeThreadPages, moveSelection, threadView, threadsNote, typing } from "./threads-model.ts";
import { entryFor, placeOf } from "../../../shell/session/mobile-map.ts";

test("a reply thread opens beside its chat, which stays put; another chat closes it, and Escape does too", () => {
  const open = step(START, { t: "chat", threadId: "thr_intake", focus: "msg_a", side: "thr_reply" });
  assert.deepEqual([open.route, open.side], [{ view: "chat", threadId: "thr_intake", focus: "msg_a" }, "thr_reply"]);
  const again = step(open, { t: "chat", threadId: "thr_intake", focus: "msg_a" });
  assert.equal(again.side, "thr_reply", "back to the message in the same chat keeps the thread open");
  assert.deepEqual(again.route, { view: "chat", threadId: "thr_intake", focus: "msg_a", focusN: 1 }, "the same message asked for again is marked again");
  assert.equal(step(again, { t: "chat", threadId: "thr_intake", focus: "msg_a" }).route.view === "chat" && (step(again, { t: "chat", threadId: "thr_intake", focus: "msg_a" }).route as { focusN?: number }).focusN, 2);
  assert.equal(step(open, { t: "chat", threadId: "thr_other" }).side, null, "another chat: the thread goes");
  assert.equal(step(open, { t: "side-close" }).side, null);
  assert.equal(step(open, { t: "side-close" }).route.view, "chat", "closing it leaves the chat");
  assert.equal(closesSide({ key: "Escape" }), true);
  assert.equal(closesSide({ key: "Escape", defaultPrevented: true }), false, "a menu or list on top took Escape first");
  assert.equal(closesSide({ key: "k" }), false);
});

test("where a thread opens: beside its message, a task's on its task, a helper as the helper, anything else as a chat", () => {
  assert.deepEqual(threadDoor({ kind: "thread", parentThreadId: "thr_intake", parentMessageId: "msg_a" }), { t: "side", parent: "thr_intake", messageId: "msg_a" });
  assert.deepEqual(threadDoor({ kind: "thread", scopeType: "task", scopeId: "tsk_1" }), { t: "task", taskId: "tsk_1" });
  assert.deepEqual(threadDoor({ kind: "helper", parentThreadId: "thr_a" }), { t: "helper" });
  assert.deepEqual(threadDoor({ kind: "chat" }), { t: "chat" });
  assert.deepEqual(fromHash("#subject=thread:thr_reply").route, { view: "chat", threadId: "thr_reply" }, "a link names the thread; the place moves it beside its message once it reads it");
});

test("Follow, Mute and Leave: the control says what I am and the menu offers the rest", () => {
  assert.equal(modeOf({ following: true }), "follow");
  assert.equal(modeOf({ following: false, muted: true }), "mute");
  assert.equal(modeOf(undefined), "none");
  assert.deepEqual(["follow", "mute", "none"].map((m) => followLabel(m as "follow")), ["Following", "Muted", "Follow"]);
  const picked: string[] = [];
  const menu = followMenu("follow", (m) => picked.push(m));
  assert.deepEqual(menu.map((e) => ("label" in e ? `${e.label}${e.checked ? " *" : ""}` : "-")), ["Follow *", "Mute", "-", "Leave Thread"]);
  for (const e of menu) if ("onSelect" in e && e.onSelect) e.onSelect();
  assert.deepEqual(picked, ["follow", "mute", "leave"]);
  assert.deepEqual(followMenu("none", () => undefined).map((e) => ("label" in e ? e.label : "-")), ["Follow", "Mute"], "nothing to leave when I am not in it");
});

test("a Threads row: where it hangs, who wrote the newest line, when, and how many are new; a muted one has nothing new", () => {
  const c = { now: Date.UTC(2026, 10, 3, 15, 0), offsetMin: 0 };
  const names: Record<string, string> = { usr_leo: "Leo" };
  const v = threadView({ threadId: "thr_1", parentTitle: "#intake", preview: "Rivera is with me", repliers: [{ kind: "person", id: "usr_leo" }], lastMessageAt: Date.UTC(2026, 10, 3, 14, 5), createdAt: 0, unread: 2 }, (id) => names[id] ?? id, c);
  assert.deepEqual([v.title, v.note, v.when, v.unread, v.bold], ["#intake", "Leo: Rivera is with me", "14:05", 2, true]);
  const quiet = threadView({ threadId: "thr_2", createdAt: Date.UTC(2026, 10, 2, 9, 0), unread: 3, muted: true, replyCount: 1 }, (id) => id, c);
  assert.deepEqual([quiet.title, quiet.note, quiet.when, quiet.unread, quiet.bold, quiet.muted], ["Thread", "1 reply", "Yesterday", 0, false, true]);
  assert.equal(threadsNote(0), "Nothing new");
  assert.equal(threadsNote(3), "3 new replies");
});

test("pages join the live first page without twins; J and K move and stop at the ends; a key typed in a field is the field's", () => {
  assert.deepEqual(mergeThreadPages([{ threadId: "a" }, { threadId: "b" }], [{ threadId: "b" }, { threadId: "c" }]).map((t) => t.threadId), ["a", "b", "c"]);
  const ids = ["a", "b", "c"];
  assert.equal(moveSelection(ids, null, "j"), "a");
  assert.equal(moveSelection(ids, "a", "j"), "b");
  assert.equal(moveSelection(ids, "c", "J"), "c");
  assert.equal(moveSelection(ids, "b", "k"), "a");
  assert.equal(moveSelection(ids, "a", "k"), "a");
  assert.equal(moveSelection(ids, "a", "x"), null);
  assert.equal(moveSelection([], null, "j"), null);
  assert.equal(typing({ tagName: "TEXTAREA" }), true);
  assert.equal(typing({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(typing({ tagName: "DIV" }), false);
});

test("on the phone the Threads page sits on the Chats tab's history and draws as itself", () => {
  const e = entryFor("chats", "screen=chats.threads");
  assert.deepEqual(e, { tab: "chats", screen: "threads:list", title: "Threads" });
  assert.deepEqual(placeOf(e!), { place: "chats", hash: "screen=chats.threads" });
});

test("the message a thread goes back to is marked with room around it: the wash and the ring sit outside its text and face", async () => {
  const { MARK, MARK_GAP } = await import("../conversation/marks.ts");
  assert.ok(MARK_GAP >= 6, "room between the message and the mark's edge");
  assert.equal(MARK.foundActive.boxShadow, `0 0 0 ${MARK_GAP}px var(--accent-wash), 0 0 0 ${MARK_GAP + 1}px var(--accent)`, "the ring is drawn outside the message");
  assert.doesNotMatch(MARK.foundActive.boxShadow, /inset/, "never on the message's own edge");
  assert.equal(MARK.found.backgroundColor, MARK.foundActive.backgroundColor);
});
