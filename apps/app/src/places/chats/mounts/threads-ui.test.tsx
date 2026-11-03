// The thread pieces as they are pressed (audit Threads 3, 4, 6, 7): the box at the top of a thread goes back to the message; the line under a message says how many replies and opens the
// thread; the Threads page draws the threads I am in from its live read, with what is new, and loads the next page on request.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../onboarding/test-dom.ts";
import { ThreadParent } from "../conversation/ThreadParent.tsx";
import { ReplyLine } from "../conversation/ReplyLine.tsx";
import { ThreadsPage, THREADS_SCREEN } from "./ThreadsPage.tsx";
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

test("the Threads page draws the threads I am in from its live read, with what is new, and loads the next page", async () => {
  installDom();
  const row = (id: string, over: Record<string, unknown> = {}) => ({ threadId: id, kind: "thread", listed: false, planMode: false, members: [], agents: [], createdAt: NOW - 3_600_000, ...over });
  const asked: { cap: string; input: Record<string, unknown> }[] = [];
  const first = { threads: [row("thr_1", { parentTitle: "#intake", preview: "Rivera is with me", repliers: [{ kind: "person", id: "usr_leo" }], unread: 2, following: true, lastMessageAt: Date.UTC(2026, 10, 3, 14, 5) })], total: 2, next: "thr_1" };
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
  const root = await mount(createRoot, <ThreadsPage rt={rt} nameOf={(id) => (id === "usr_leo" ? "Leo" : id)} openChat={(id) => opened.push(id)} />);
  const one = find(root, "row-thread-thr_1");
  assert.ok(one, "the first thread is drawn");
  assert.match(textOf(one), /#intake/);
  assert.match(textOf(one), /Leo: Rivera is with me/);
  assert.equal(textOf(find(root, "thread-unread-thr_1")).trim(), "2", "how many are new");
  assert.equal(typeof one!.props.onContextMenu, "function", "right-click opens the row's menu");
  await press(find(root, "threads-more"));
  await flush();
  // the Ask history under the threads is its own read (kind ask); then the next page, from where the first ended
  assert.deepEqual(asked.map((a) => [a.cap, a.input["kind"], a.input["cursor"]]), [["threads.list", ["ask"], undefined], ["threads.list", ["thread"], "thr_1"]], "Ask history, then the next page from where the first ended");
  assert.match(textOf(find(root, "row-thread-thr_2")), /Lee file/);
  await press(find(root, "row-thread-thr_2"));
  assert.deepEqual(opened, ["thr_2"]);
});

test("a banner for a burst of replies says the count once, in its title, with Reply", async () => {
  installDom();
  const { NotificationBanners } = await import("../../../shell/notifications/Banners.tsx");
  const { BannerStack } = await import("../../../shell/notifications/model.ts");
  const stack = new BannerStack(() => NOW);
  stack.push({ id: "ntf_1", kind: "reply.thread", level: "interrupt", place: "chats", title: "3 new replies in #intake", body: "Calling at 3", count: 3, at: NOW, actions: [{ label: "Reply", cap: "chat.post" }], spaceId: "spc_1", subject: { type: "thread", id: "thr_1" } } as never);
  const opened: string[] = [];
  const r = createRoot();
  await act(async () => { r.render(<NotificationBanners stack={stack} onAction={(n, a) => opened.push(`${a.label}:${n.id}`)} onOpen={() => undefined} />); });
  await flush();
  const root = r.container as unknown as Parameters<typeof find>[0];
  const card = find(root, "banner-ntf_1");
  assert.match(textOf(card), /3 new replies in #intake/);
  assert.equal(find(root, "banner-count-ntf_1"), null, "the title already says how many");
  await press(find(root, "banner-action-Reply"));
  assert.deepEqual(opened, ["Reply:ntf_1"]);
  await act(async () => { r.unmount(); });   // the banners' expiry clock stops with them
});

