// Agents reply in threads, from the person's side: the live footer under the asking message (who is writing, how many replies, when the last came), a press on it opening the thread beside the chat on a wide
// screen and as a full-screen sheet on a phone, the thread with its empty and long states, the "Also sent to the chat" mark, and the chat's switch. Click paths on the sample channel, not markup.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { Dimensions } from "react-native";
import { createRoot } from "test-renderer";
import { installDom, mount, press, find, flush, textOf } from "../../../onboarding/test-dom.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { ThreadSide } from "../mounts/ThreadSide.tsx";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { Conversation } from "../conversation/Conversation.tsx";
import { SAMPLE_NOW, createSample } from "../conversation/sample.ts";
import type { Sample } from "../conversation/sample.ts";
import type { ConversationData, LiveTurns } from "../conversation/data.tsx";
import type { Message } from "../conversation/model.ts";
import { replySummaries } from "../conversation/replies.ts";
import * as actions from "../conversation/actions.ts";
import { alsoSentIds } from "./also-sent.ts";
import { footerOf, mmss, repliesOf, SWITCH_TITLE } from "./model.ts";

const widen = (width: number): void => Dimensions.set({ window: { width, height: 844, scale: 1, fontScale: 1 } });
const at = (h: number, min: number): number => Date.UTC(2025, 9, 24, h, min, 0);
/** The thread beside the chat, as the shell draws it: the thread's conversation over the sample's kept copy, a wide screen (a column in the side pane) or a phone (a full-screen sheet). */
const side = (s: Sample, narrow: boolean, threadId = "t_c2", onClose: () => void = () => undefined): ReturnType<typeof ThreadSide> => (
  <ThreadSide rt={{ screens: s.data.screens, call: s.data.call, connection: s.data.connection } as unknown as ShellRuntime} threadId={threadId} data={{ ...s.data, threadId }} narrow={narrow} onClose={onClose} say={(t) => s.data.toast(t)} />
);

/** The sample channel: Maya's question (c1) and your ask (c2), with Intake and Docs listening. The thread under c2 is t_c2. */
const channel = (): Sample => { const s = createSample("channel"); s.replica.put("threads", [{ id: "c1", ...(s.replica.rows("threads")[0] as object), agentRepliesInThreads: true }]); return s; };
const threadRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "t_c2", threadId: "t_c2", kind: "thread", parentThreadId: "c1", parentMessageId: "c2", listed: false, planMode: false, members: [], agents: [], createdAt: at(9, 22), replyCount: 0, ...o,
});
const msg = (id: string, thread: string, seq: number, who: { kind: "person" | "agent"; id: string }, body: string, o: Partial<Message> = {}): Message & { id: string } => ({
  id, messageId: id, threadId: thread, threadSeq: seq, author: who, kind: who.kind === "agent" ? "agent" : "text", body, blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: at(9, 22 + seq), ...o,
});
const intake = { kind: "agent" as const, id: "agt_intake" };
const me = { kind: "person" as const, id: "usr_irfad" };

const liveOf = (turns: { threadId: string; agentId: string; state: "writing" | "ended"; startedAt: number }[]): LiveTurns => {
  const kept = new Map<string, readonly never[]>();   // the same array for the same thread, as the live socket's store gives
  return {
    turnsOf: (id) => { if (!kept.has(id)) kept.set(id, turns.filter((t) => t.threadId === id).map((t, i) => ({ turnId: `turn_${i}`, store: undefined, ...t }) as never)); return kept.get(id)!; },
    subscribe: () => () => undefined, settle: () => undefined, seed: () => undefined, onGap: () => () => undefined,
  };
};
const unused = (turns: unknown): LiveTurns => ({
  turnsOf: () => [],
  subscribe: () => () => undefined, settle: () => undefined, seed: () => undefined, onGap: () => () => undefined,
}); void unused;

test("the footer under the ask: nothing for an empty thread, then the reply count and when the last reply came", async () => {
  installDom(); widen(1280);
  const s = channel();
  s.replica.put("threads", [threadRow()]);
  const root = await mount(createRoot, <Conversation data={s.data} />);
  assert.equal(find(root, "replies-c2"), null, "a thread nobody has written in draws no footer");
  await act(async () => { s.replica.put("threads", [threadRow({ replyCount: 1, lastMessageAt: at(9, 40) })]); });
  await flush();
  const one = textOf(find(root, "replies-c2"));
  assert.match(one, /1 reply/);
  assert.match(one, /Last reply 9:40/);
  await act(async () => { s.replica.put("threads", [threadRow({ replyCount: 3, lastMessageAt: at(9, 55) })]); });
  await flush();
  assert.match(textOf(find(root, "replies-c2")), /3 replies.*Last reply 9:55/s, "the line follows the thread live");
});

test("while an agent writes in the thread the footer shows its face and Working with a running timer", async () => {
  installDom(); widen(1280);
  const s = channel();
  s.replica.put("threads", [threadRow({ replyCount: 1, lastMessageAt: at(9, 40) })]);
  const turns = [{ threadId: "t_c2", agentId: "agt_intake", state: "writing" as const, startedAt: Date.now() - 23_000 }];
  const root = await mount(createRoot, <Conversation data={{ ...s.data, live: liveOf(turns) }} />);
  const foot = find(root, "replies-c2")!;
  assert.ok(foot, "the footer is there");
  assert.match(textOf(foot), /Working . 0:2\d/, "Working with minutes and seconds");
  assert.match(textOf(foot), /1 reply/);
  assert.ok(find(foot, "face-Intake"), "the face of the agent that is writing");
  // the same thread with nobody writing is the quiet line again
  const quiet = await mount(createRoot, <Conversation data={s.data} />);
  assert.doesNotMatch(textOf(find(quiet, "replies-c2")), /Working/);
});

test("a thread with nothing in it yet but an agent writing already shows the footer", async () => {
  installDom(); widen(1280);
  const s = channel();
  s.replica.put("threads", [threadRow()]);
  const turns = [{ threadId: "t_c2", agentId: "agt_docs", state: "writing" as const, startedAt: Date.now() - 4_000 }];
  const root = await mount(createRoot, <Conversation data={{ ...s.data, live: liveOf(turns) }} />);
  const foot = textOf(find(root, "replies-c2"));
  assert.match(foot, /Working . 0:0\d/);
  assert.doesNotMatch(foot, /0 replies/, "no zero count while it writes the first reply");
});

test("pressing the footer opens the thread under the message through chat.thread; the shell draws it beside the chat or as a sheet", async () => {
  installDom(); widen(1280);
  const s = channel();
  s.replica.put("threads", [threadRow({ replyCount: 2, lastMessageAt: at(9, 40) })]);
  const root = await mount(createRoot, <Conversation data={s.data} />);
  await press(find(root, "replies-c2"));
  await flush();
  assert.ok(s.calls.some((c) => c.cap === "chat.thread" && (c.input as { messageId: string }).messageId === "c2"), "through chat.thread, for the message that was asked");
  assert.deepEqual(s.opened.filter((o) => o.startsWith("thread:")), ["thread:t_c2"], "the shell is asked for that thread");
});

const withThread = (): Sample => {
  const s = channel();
  s.replica.put("threads", [threadRow({ replyCount: 2, lastMessageAt: at(9, 40) })]);
  s.replica.put("messages", [msg("tm1", "t_c2", 1, intake, "Tuesday has two openings."), msg("tm2", "t_c2", 2, intake, "Decision: book Tuesday at 2:00.")]);
  return s;
};

test("on a wide screen the thread is a column in the shared side pane, with the thread's own tab", async () => {
  installDom(); widen(1280);
  const root = await mount(createRoot, side(withThread(), false));
  await flush();
  assert.ok(find(root, "thread-side"), "the thread is open beside the chat");
  assert.equal(find(root, "thread-sheet"), null, "not a sheet");
  assert.match(textOf(root), /\bThread\b/, "a tab titled Thread");
  assert.match(textOf(find(root, "thread-side")), /Tuesday has two openings/, "with its replies");
});

test("on a phone the thread is a full-screen sheet with a back arrow, and back closes it", async () => {
  installDom(); widen(390);
  let closed = 0;
  const root = await mount(createRoot, side(withThread(), true, "t_c2", () => { closed += 1; }));
  await flush();
  assert.ok(find(root, "thread-sheet"), "the sheet is open");
  assert.ok(find(root, "thread-side"), "with the thread in it");
  assert.match(textOf(find(root, "thread-sheet")), /Thread/);
  assert.match(textOf(find(root, "thread-sheet-title")), /intake/, "under the title of the chat it hangs in");
  await press(find(root, "thread-sheet-back"));
  assert.equal(closed, 1, "back closes it");
  widen(1280);
});

test("an empty thread says so; a long thread opens on its last reply", async () => {
  installDom(); widen(1280);
  const empty = channel();
  empty.replica.put("threads", [threadRow()]);
  const a = await mount(createRoot, side(empty, false));
  await flush();
  assert.match(textOf(find(a, "thread-empty")), /No replies yet/);

  const long = channel();
  long.replica.put("threads", [threadRow({ replyCount: 60, lastMessageAt: at(11, 0) })]);
  long.replica.put("messages", Array.from({ length: 60 }, (_, i) => msg(`tl${i + 1}`, "t_c2", i + 1, i % 2 === 0 ? me : intake, `Reply number ${i + 1}`, { createdAt: at(9, 22) + i * 1000 })));
  const b = await mount(createRoot, side(long, false));
  await flush();
  assert.equal(find(b, "thread-empty"), null);
  assert.ok(find(b, "msg-tl60"), "the newest reply is on the page");
  assert.ok(find(b, "composer-input") ?? find(b, "composer"), "with the composer under it");
});

test("while the agent writes its first reply the thread does not say it is empty", async () => {
  installDom(); widen(1280);
  const s = channel();
  s.replica.put("threads", [threadRow()]);
  const turns = [{ threadId: "t_c2", agentId: "agt_intake", state: "writing" as const, startedAt: Date.now() - 3_000 }];
  const root = await mount(createRoot, <ThreadSide rt={{ screens: s.data.screens, call: s.data.call, connection: s.data.connection } as unknown as ShellRuntime} threadId="t_c2" data={{ ...s.data, threadId: "t_c2", live: liveOf(turns) }} narrow={false} onClose={() => undefined} say={() => undefined} />);
  await flush();
  assert.equal(find(root, "thread-empty"), null, "it is writing, not empty");
});

test("a reply that was also sent to the chat carries the mark in the thread; one that was not does not", async () => {
  installDom(); widen(1280);
  const s = withThread();
  s.replica.put("messages", [msg("c3", "c1", 3, intake, "Decision: book Tuesday at 2:00.", { blocks: [{ type: "from_thread", v: 1, id: "b1", data: { threadId: "t_c2", messageId: "tm2" } }] as never })]);
  const root = await mount(createRoot, side(s, false));
  await flush();
  assert.ok(find(root, "also-sent-tm2"), "tm2 was also sent");
  assert.match(textOf(find(root, "also-sent-tm2")), /Also sent to the chat/);
  assert.equal(find(root, "also-sent-tm1"), null, "tm1 stayed in the thread");
  // the chat's own copy says where it came from
  const chat = await mount(createRoot, <Conversation data={s.data} />);
  await flush();
  assert.ok(find(chat, "from-thread-c3"), "the copy in the chat names its thread");
});

test("the thread's composer carries Also post to the chat, and a send from the thread with it ticked asks chat.post to also post to the chat", async () => {
  installDom(); widen(1280);
  const s = withThread();
  const root = await mount(createRoot, side(s, false));
  await flush();
  const tick = find(root, "also-to-chat");
  assert.ok(tick, "the tick is under the composer");
  assert.match(textOf(tick), /Also post to the chat/);
  await press(tick);
  await actions.sendMessage({ ...s.data, threadId: "t_c2" }, { text: "Decision: Tuesday 2:00.", mentions: [], key: "k1", kind: "queue", working: false, alsoToChat: true });
  const post = s.calls.filter((c) => c.cap === "chat.post").map((c) => c.input as { threadId: string; alsoToChat?: boolean });
  assert.deepEqual(post.map((p) => [p.threadId, p.alsoToChat]), [["t_c2", true]]);
});

test("the chat's switch: on shows on, a press calls threads.set_agent_replies and the row follows; a direct chat starts off", async () => {
  installDom(); widen(1280);
  const s = withThread();
  const root = await mount(createRoot, side(s, false));
  await flush();
  const sw = (): Node => find(root, "thread-switch")!;
  assert.ok(sw(), "the switch is at the foot of the thread");
  assert.equal(textOf(find(root, "thread-switch-row")).includes(SWITCH_TITLE), true);
  assert.equal(sw().props["aria-checked"], true, "on by default in a channel");
  await press(sw());
  await flush();
  assert.deepEqual(s.calls.filter((c) => c.cap === "threads.set_agent_replies").map((c) => c.input), [{ threadId: "c1", inThreads: false }]);
  assert.equal(sw().props["aria-checked"], false, "off now");
  assert.ok(s.toasts.includes("Agents reply in the chat"));
  await press(sw());
  await flush();
  assert.equal(sw().props["aria-checked"], true);
  assert.ok(s.toasts.includes("Agents reply in threads"));

  // a direct chat (the sample's idle chat) has the switch off until someone turns it on
  const dm = createSample("idle");
  dm.replica.put("threads", [{ id: "c1", ...(dm.replica.rows("threads")[0] as object) }, threadRow()]);
  const r2 = await mount(createRoot, side(dm, false));
  await flush();
  assert.equal(find(r2, "thread-switch")!.props["aria-checked"], false);
});

test("a write that fails puts the switch back and says so", async () => {
  installDom(); widen(1280);
  const s = withThread();
  const root = await mount(createRoot, side(s, false));
  await flush();
  s.failNext("threads.set_agent_replies");
  await press(find(root, "thread-switch"));
  await flush();
  assert.equal(find(root, "thread-switch")!.props["aria-checked"], true, "back to on");
  assert.ok(s.toasts.includes("Could not change that."));
});

test("pure: the footer words, the timer and the also-sent lookup", () => {
  assert.equal(mmss(23_000), "0:23");
  assert.equal(mmss(125_000), "2:05");
  assert.equal(mmss(-5), "0:00");
  const clock = { now: SAMPLE_NOW, offsetMin: 0 };
  const sums = replySummaries([{ threadId: "t1", kind: "thread", parentMessageId: "m1", replyCount: 2, lastMessageAt: at(9, 40) }, { threadId: "t2", kind: "thread", parentMessageId: "m2" }], { empty: true });
  assert.equal(sums.get("m1")!.count, 2);
  assert.equal(sums.get("m2")!.count, 0, "an empty thread is kept when the footer may show a writer");
  assert.equal(replySummaries([{ threadId: "t2", kind: "thread", parentMessageId: "m2" }]).size, 0, "and left out otherwise");
  const f = footerOf(sums.get("m1"), [], SAMPLE_NOW, clock)!;
  assert.deepEqual([f.writing, f.head, f.count, f.when], [false, null, "2 replies", "Last reply 9:40"]);
  const w = footerOf(sums.get("m2"), [{ turnId: "x", threadId: "t2", agentId: "agt_intake", store: undefined as never, state: "writing", startedAt: SAMPLE_NOW - 65_000 }], SAMPLE_NOW, clock)!;
  assert.deepEqual([w.writing, w.head, w.agentId, w.when], [true, "Working · 1:05", "agt_intake", null]);
  assert.equal(footerOf(undefined, [], SAMPLE_NOW, clock), null);
  // the switch, from a row the server answered and from a copy kept on the device
  assert.equal(repliesOf({ kind: "channel", agentRepliesInThreads: false }), false);
  assert.equal(repliesOf({ kind: "channel" }), true, "a channel defaults on");
  assert.equal(repliesOf({ kind: "chat" }), false, "a direct chat defaults off");
  assert.equal(repliesOf({ kind: "channel", repliesIn: 0 }), false, "the person's own choice wins");
  assert.equal(repliesOf({ kind: "chat", repliesIn: 1 }), true);
  assert.equal(repliesOf({ kind: "thread" }), undefined, "a thread has no such choice");
  assert.deepEqual([...alsoSentIds([{ blocks: [{ type: "from_thread", data: { threadId: "t1", messageId: "a" } }, { type: "from_thread", data: { threadId: "t9", messageId: "b" } }, { type: "from_thread", data: { threadId: "t1", messageId: "" } }] }, {}], "t1")], ["a"]);
});

void (null as unknown as ConversationData);
