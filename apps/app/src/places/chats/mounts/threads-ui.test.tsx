// The thread pieces as they are pressed (audit Threads 3, 4, 6, 7): the box at the top of a thread goes back to the message; the line under a message says how many replies and opens the
// thread; Replies (in the Inbox) draws the replies I follow from its live read, with what is new, and loads the next page on request.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../onboarding/test-dom.ts";
import { ThreadParent } from "../conversation/ThreadParent.tsx";
import { ReplyLine } from "../conversation/ReplyLine.tsx";
import { RepliesPage, THREADS_SCREEN } from "./RepliesPage.tsx";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";

const NOW = Date.UTC(2026, 10, 3, 15, 0);
const clock = { now: NOW, offsetMin: 0 };

test("the box at the top of a thread is a link back to the message it hangs off", async () => {
  installDom();
  let opened = 0;
  const call = async (): Promise<unknown> => ({ message: { author: { id: "usr_dana" }, body: "Who takes the Rivera intake?" } });
  const root = await mount(createRoot, <ThreadParent threadId="thr_intake" messageId="msg_a" call={call} nameOf={() => "Dana"} onOpen={() => { opened += 1; }} />);
  const box = find(root, "thread-parent");
  assert.ok(box, "the parent message is drawn");
  assert.match(textOf(box), /Who takes the Rivera intake\?/);
  assert.equal(box!.props.role, "link");
  assert.equal(box!.props["aria-label"], "Back to the message");
  await press(box);
  assert.equal(opened, 1, "pressing it goes back to the message");
});

test("the line under a message: faces, how many replies, when the last came; pressing it opens the thread", async () => {
  installDom();
  let opened = 0;
  const s = { threadId: "thr_r", count: 3, lastAt: Date.UTC(2026, 10, 3, 14, 5), people: [{ id: "usr_leo", kind: "person" as const }], unread: 1, muted: false };
  const root = await mount(createRoot, <ReplyLine s={s} clock={clock} nameOf={() => "Leo"} onOpen={() => { opened += 1; }} testID="replies-msg_a" />);
  const line = find(root, "replies-msg_a");
  assert.match(textOf(line), /3 replies/);
  assert.match(textOf(line), /Last reply 14:05/);
  assert.equal(line!.props["aria-label"], "Open the thread: 3 replies, 1 new, Last reply 14:05");
  await press(line);
  assert.equal(opened, 1);
});

test("Replies (in the Inbox) draws the replies I follow from its live read, with what is new, and loads the next page", async () => {
  installDom();
  const row = (id: string, over: Record<string, unknown> = {}) => ({ threadId: id, kind: "thread", listed: false, planMode: false, members: [], agents: [], createdAt: NOW - 3_600_000, ...over });
  const asked: { cap: string; input: Record<string, unknown> }[] = [];
  const first = { threads: [row("thr_1", { parentThreadId: "thr_chat", parentMessageId: "msg_9", parentTitle: "#intake", preview: "Rivera is with me", repliers: [{ kind: "person", id: "usr_leo" }], unread: 2, following: true, lastMessageAt: Date.UTC(2026, 10, 3, 14, 5) })], total: 2, next: "thr_1" };
  const snap = { status: "ready", data: first };
  const screens = {
    query(screenId: string, name: string, state: Record<string, unknown>) {
      assert.equal(screenId, THREADS_SCREEN);
      assert.equal(name, "threads");
      assert.deepEqual(state, { kind: ["thread"], mine: true, order: "latest", exceptScope: ["task"], limit: 50 }, "the threads I am in, newest reply first, without task threads");
      return { subscribe: () => () => undefined, getSnapshot: () => snap };
    },
  };
  const rt = {
    screens, clock: () => clock,
    call: async (cap: string, input: Record<string, unknown>) => { asked.push({ cap, input }); return { threads: [row("thr_2", { parentTitle: "Lee file", replyCount: 1, following: true })], total: 2 }; },
  } as unknown as ShellRuntime;
  const opened: string[] = [];
  const root = await mount(createRoot, <RepliesPage rt={rt} nameOf={(id) => (id === "usr_leo" ? "Leo" : id)} openChat={(t, how) => opened.push(`${how}:${t.parentThreadId ?? t.threadId}:${t.threadId}:${t.parentMessageId ?? ""}`)} />);
  const one = find(root, "row-thread-thr_1");
  assert.ok(one, "the first thread is drawn");
  assert.match(textOf(one), /#intake/);
  assert.match(textOf(one), /Leo/);
  assert.match(textOf(one), /Rivera is with me/);
  assert.equal(textOf(find(root, "thread-unread-thr_1")).trim(), "2", "how many are new");
  assert.equal(typeof one!.props.onContextMenu, "function", "right-click opens the row's menu");
  await press(find(root, "replies-more"));
  await flush();
  // the next page is read from where the first ended; Ask history is not here any more (the chat list's Asks filter)
  assert.deepEqual(asked.map((a) => [a.cap, a.input["kind"], a.input["cursor"]]), [["threads.list", ["thread"], "thr_1"]], "the next page from where the first ended");
  assert.match(textOf(find(root, "row-thread-thr_2")), /Lee file/);
  await press(find(root, "row-thread-thr_2"));
  assert.deepEqual(opened, ["reply:thr_2:thr_2:"]);
});

test("a reply row opens its chat with the thread beside the message and marks it read; the chat name opens the chat itself; Enter does what a click does", async () => {
  installDom();
  const row = (id: string, over: Record<string, unknown>) => ({ threadId: id, kind: "thread", listed: false, planMode: false, members: [], agents: [], createdAt: NOW - 3_600_000, ...over });
  const snap = { status: "ready", data: { threads: [row("thr_1", { parentThreadId: "thr_chat", parentMessageId: "msg_9", parentTitle: "#intake", preview: "Rivera is with me", repliers: [{ kind: "person", id: "usr_leo" }], unread: 2, following: true, lastMessageAt: NOW - 600_000 })], total: 1 } };
  const calls: string[] = [];
  const rt = { screens: { query: () => ({ subscribe: () => () => undefined, getSnapshot: () => snap }) }, clock: () => clock, call: async (cap: string, input: Record<string, unknown>) => { calls.push(`${cap}:${String(input["threadId"])}`); return {}; } } as unknown as ShellRuntime;
  const opened: string[] = [];
  const root = await mount(createRoot, <RepliesPage rt={rt} nameOf={() => "Leo"} openChat={(t, how) => opened.push(`${how}:${t.parentThreadId}:${t.threadId}:${t.parentMessageId}`)} />);
  await press(find(root, "reply-chat-thr_1"));
  assert.deepEqual(opened, ["chat:thr_chat:thr_1:msg_9"], "the chat name opens the chat");
  assert.deepEqual(calls, [], "opening the chat leaves the replies unread");
  await press(find(root, "row-thread-thr_1"));
  await flush();
  assert.deepEqual(opened.at(-1), "reply:thr_chat:thr_1:msg_9", "the reply opens the chat with its thread beside the message");
  assert.deepEqual(calls, ["threads.mark_read:thr_1"], "the row marks itself read");
});

test("a burst of replies is one notice in the top bar: the count once, in its title, with Open", async () => {
  const { syncNotifications } = await import("../../../shell/noticeslot/bridge.ts");
  const { createNoticeStore } = await import("../../../shell/noticeslot/model.ts");
  const store = createNoticeStore();
  const opened: string[] = [];
  const row = { id: "ntf_1", kind: "reply.thread", level: "interrupt", place: "chats", title: "3 new replies in #intake", body: "Calling at 3", count: 3, at: NOW, actions: [{ label: "Reply", cap: "chat.post" }], spaceId: "spc_1" } as never;
  syncNotifications(store, new Set(), [row], (n) => opened.push(String((n as { id: string }).id)));
  const live = store.getSnapshot().live;
  assert.equal(live.length, 1);
  assert.equal(live[0]!.text, "3 new replies in #intake", "the title already says how many: not said twice");
  assert.equal(live[0]!.action?.label, "Open");
  live[0]!.action!.run();
  assert.deepEqual(opened, ["ntf_1"]);
});

