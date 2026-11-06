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
import { Pressable, Text } from "react-native";
import { CONVERSATION_SCREEN } from "../conversation/Conversation.tsx";
import { ConversationDataProvider, useScreenQuery } from "../conversation/data.tsx";
import { useReplySwitch } from "./ThreadSwitch.tsx";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { Conversation } from "../conversation/Conversation.tsx";
import { SAMPLE_NOW, createSample } from "../conversation/sample.ts";
import type { Sample } from "../conversation/sample.ts";
import type { ConversationData, LiveTurns } from "../conversation/data.tsx";
import type { Message } from "../conversation/model.ts";
import { replySummaries } from "../conversation/replies.ts";
import * as actions from "../conversation/actions.ts";
import { alsoSentIds } from "./also-sent.ts";
import { footerOf, mmss, parkedTask, repliesOf, SWITCH_TITLE } from "./model.ts";

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

test("when the agent has finished the footer says Done with its one-line outcome, then the reply count", async () => {
  installDom(); widen(1280);
  const s = channel();
  s.replica.put("threads", [threadRow({ replyCount: 3, lastMessageAt: at(9, 40), repliers: [{ kind: "agent", id: "agt_intake" }], preview: "**Decision:** book Thursday 14:00 and go with Harbor, who is ready two weeks sooner than Pine." })]);
  const root = await mount(createRoot, <Conversation data={s.data} />);
  await flush();
  const foot = textOf(find(root, "replies-c2"));
  assert.match(foot, /Done\s+\S\s+Decision: book Thursday 14:00 and go with Harbor/, "Done and the first line, without markdown");
  assert.match(foot, /3 replies/);
  assert.ok(find(find(root, "replies-c2")!, "face-Intake"), "the face of the agent that finished");
  assert.ok(foot.length < 120, "one line, cut to fit");
  // a person had the last word: the quiet reply line, not Done
  s.replica.put("threads", [threadRow({ replyCount: 4, lastMessageAt: at(9, 50), repliers: [{ kind: "person", id: "usr_irfad" }], preview: "Thanks" })]);
  await flush();
  assert.doesNotMatch(textOf(find(root, "replies-c2")), /Done/);
});

test("while helpers work under the thread the footer says so, with how many, instead of Done", async () => {
  installDom(); widen(1280);
  const s = channel();
  s.replica.put("threads", [threadRow({ replyCount: 3, lastMessageAt: at(9, 40), repliers: [{ kind: "agent", id: "agt_intake" }], preview: "Two helpers are on it." })]);
  const call = s.data.call;
  s.data.call = async (cap: string, input: unknown) => (cap === "engine.crew.status" ? { members: [], totals: { working: 2, needsYou: 0 } } : call(cap, input));
  const root = await mount(createRoot, <Conversation data={s.data} />);
  await flush();
  await flush();
  const foot = textOf(find(root, "replies-c2"));
  assert.match(foot, /Working\s+\S\s+2 helpers/);
  assert.doesNotMatch(foot, /Done/);
});

const waitingBlock = [{ type: "turn_status", v: 1, id: "ts1", data: { state: "waiting", turnId: "turn_1", taskId: "tsk_1" } }] as never;
function parked(assignee: string): Sample {
  const s = channel();
  s.replica.put("threads", [threadRow({ replyCount: 1, lastMessageAt: at(9, 40), repliers: [{ kind: "agent", id: "agt_intake" }], preview: "I will tell Noah." })]);
  s.replica.put("messages", [msg("pm1", "t_c2", 1, intake, "I will tell Noah.", { blocks: waitingBlock })]);
  const call = s.data.call;
  s.data.call = async (cap: string, input: unknown) => (cap === "tasks.get" ? { task: { title: "Intake asks: Send a message", assigned: { kind: "person", id: assignee } } } : call(cap, input));
  return s;
}

test("a turn parked on an approval says Waiting for your OK with the approval's line, never Done; when someone else must say yes it names them; it turns to Done when the turn ends", async () => {
  installDom(); widen(1280);
  // yours to approve
  const mine = parked("usr_irfad");
  const root = await mount(createRoot, <Conversation data={mine.data} />);
  await flush(); await flush();
  const foot = textOf(find(root, "replies-c2"));
  assert.match(foot, /Waiting for your OK/);
  assert.match(foot, /Send a message/, "the approval's one line");
  assert.match(foot, /1 reply/);
  assert.doesNotMatch(foot, /Done/, "not Done while it waits");
  // someone else's to approve
  const theirs = parked("usr_maya");
  const r2 = await mount(createRoot, <Conversation data={theirs.data} />);
  await flush(); await flush();
  assert.match(textOf(find(r2, "replies-c2")), /Waiting for Maya's OK/);
  // the turn ends: a later message from the agent, and the footer says Done with its line
  mine.replica.put("messages", [msg("pm2", "t_c2", 2, intake, "Sent. Noah has the time.")]);
  mine.replica.put("threads", [threadRow({ replyCount: 2, lastMessageAt: at(9, 50), repliers: [{ kind: "agent", id: "agt_intake" }], preview: "Sent. Noah has the time." })]);
  await flush(); await flush();
  const done = textOf(find(root, "replies-c2"));
  assert.match(done, /Done\s+\S\s+Sent\. Noah has the time\./);
  assert.doesNotMatch(done, /Waiting/);
  assert.equal(parkedTask([{ blocks: waitingBlock as never }, { kind: "agent", blocks: [] }]), null, "a later message ends the wait");
  assert.equal(parkedTask([{ blocks: waitingBlock as never }]), "tsk_1");
});

test("the quiet approval line in the chat is one button that opens the thread, with a hover state and keyboard focus", async () => {
  installDom(); widen(1280);
  const s = channel();
  s.replica.put("messages", [msg("ap1", "c1", 3, intake, "", { blocks: [{ type: "turn_status", v: 1, id: "n1", data: { state: "note", text: "needs your OK" } }, { type: "from_thread", v: 1, id: "f1", data: { threadId: "t_c2", messageId: "" } }] as never })]);
  const root = await mount(createRoot, <Conversation data={s.data} />);
  await flush();
  const line = find(root, "approval-line-ap1");
  assert.ok(line, "the line is a button");
  assert.equal(line!.props.role, "button");
  assert.equal(line!.props.tabIndex, 0, "reachable by keyboard");
  assert.match(textOf(line), /Intake needs your OK in a thread\.\s+Open the thread/, "one line, the link on the last part");
  assert.equal(find(root, "from-thread-ap1"), null, "no second link beside it");
  await press(line);
  assert.deepEqual(s.opened.filter((o) => o.startsWith("thread:")), ["thread:t_c2"], "pressing it opens the thread");
});

test("the no-agent hint agrees with the routing: no line under an ask an agent answers in a thread; with nobody answering it is a quiet line, not underlined", async () => {
  installDom(); widen(1280);
  const quiet = channel();
  const a = await mount(createRoot, <Conversation data={quiet.data} />);
  await flush();
  const line = find(a, "no-agent-line");
  assert.ok(line, "nobody was named in a channel where agents listen, so the line says so");
  assert.equal(JSON.stringify(line).includes("underline"), false, "a quiet line, not a link look");
  const answered = channel();
  answered.replica.put("threads", [threadRow({ replyCount: 1, lastMessageAt: at(9, 40) })]);
  const b = await mount(createRoot, <Conversation data={answered.data} />);
  await flush();
  assert.equal(find(b, "no-agent-line"), null, "an agent answers under the message: the footer says so, the hint does not contradict it");
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

const withRoot = (s: Sample): Sample => {
  const call = s.data.call;
  s.data.call = async (cap: string, input: unknown) => (cap === "chat.message.get" ? { message: { author: { id: "usr_irfad" }, body: "Find a time for the vendor call next week.", createdAt: at(9, 21) } } : call(cap, input));
  return s;
};

test("an empty thread shows its root message first, then No replies yet, and no Say something to start; a long thread opens on its last reply", async () => {
  installDom(); widen(1280);
  const empty = withRoot(channel());
  empty.replica.put("threads", [threadRow()]);
  const a = await mount(createRoot, side(empty, false));
  await flush(); await flush();
  assert.match(textOf(find(a, "thread-parent")), /You\s+9:21/);
  assert.match(textOf(find(a, "thread-parent")), /Find a time for the vendor call/);
  assert.match(textOf(find(a, "thread-replies-divider")), /No replies yet/);
  assert.doesNotMatch(textOf(a), /Say something to start/);

  const long = withRoot(channel());
  long.replica.put("threads", [threadRow({ replyCount: 60, lastMessageAt: at(11, 0) })]);
  long.replica.put("messages", Array.from({ length: 60 }, (_, i) => msg(`tl${i + 1}`, "t_c2", i + 1, i % 2 === 0 ? me : intake, `Reply number ${i + 1}`, { createdAt: at(9, 22) + i * 1000 })));
  const b = await mount(createRoot, side(long, false));
  await flush();
  assert.ok(find(b, "msg-tl60"), "the newest reply is on the page");
  assert.match(textOf(find(b, "thread-replies-divider")), /60 replies/);
});

test("while the agent writes its first reply the divider says who is writing, not No replies yet", async () => {
  installDom(); widen(1280);
  const s = withRoot(channel());
  s.replica.put("threads", [threadRow()]);
  const turns = [{ threadId: "t_c2", agentId: "agt_intake", state: "writing" as const, startedAt: Date.now() - 3_000 }];
  const root = await mount(createRoot, <ThreadSide rt={{ screens: s.data.screens, call: s.data.call, connection: s.data.connection } as unknown as ShellRuntime} threadId="t_c2" data={{ ...s.data, threadId: "t_c2", live: liveOf(turns) }} narrow={false} onClose={() => undefined} say={() => undefined} />);
  await flush(); await flush();
  const divider = textOf(find(root, "thread-replies-divider"));
  assert.match(divider, /Intake is writing/);
  assert.doesNotMatch(divider, /No replies yet/);
});

test("a finished thread has the same footer under the ask whether its pane is open or closed", async () => {
  installDom(); widen(1280);
  const row = threadRow({ replyCount: 3, lastMessageAt: at(9, 40), repliers: [{ kind: "agent", id: "agt_intake" }], preview: "Decision: book Thursday 14:00 and go with Harbor." });
  const closed = channel();
  closed.replica.put("threads", [row]);
  const a = await mount(createRoot, <Conversation data={closed.data} />);
  await flush();
  const open = withThread();
  open.replica.put("threads", [row]);
  const b = await mount(createRoot, (
    <>
      <Conversation data={open.data} />
      {side(open, false)}
    </>
  ));
  await flush();
  const one = textOf(find(a, "replies-c2")), two = textOf(find(b, "replies-c2"));
  assert.match(one, /Done\s+\S\s+Decision: book Thursday/);
  assert.equal(two, one, "one footer, one state, pane open or not");
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
  // a person's own copy says so too, and does not make the no-agent hint appear
  s.replica.put("messages", [msg("c4", "c1", 4, me, "Decision: Tuesday 2:00.", { blocks: [{ type: "from_thread", v: 1, id: "b2", data: { threadId: "t_c2", messageId: "tm3" } }] as never })]);
  await flush();
  assert.match(textOf(find(chat, "from-thread-c4")), /Also sent to the chat from a thread/);
  assert.equal(find(chat, "no-agent-line"), null, "a copy from a thread wakes no agent and is not waiting on one");
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

/** The switch as the chat's More menu uses it: the hook over the chat's own row. */
function SwitchProbe({ s }: { s: Sample }): ReturnType<typeof Conversation> {
  const row = useScreenQuery<{ thread: Parameters<typeof repliesOf>[0] }>(CONVERSATION_SCREEN, "thread", { threadId: "c1" });
  const sw = useReplySwitch(s.data, "c1", row.status === "ready" ? repliesOf(row.data.thread) : undefined);
  return <Pressable testID="probe-switch" aria-checked={sw.on ?? undefined} onPress={() => sw.set(!sw.on)}><Text>{String(sw.on)}</Text></Pressable>;
}
const probe = (s: Sample): ReturnType<typeof Conversation> => <ConversationDataProvider value={s.data}><SwitchProbe s={s} /></ConversationDataProvider>;

test("the chat's switch (in its More menu): on shows on, a press calls threads.set_agent_replies and the row follows; a direct chat starts off", async () => {
  installDom(); widen(1280);
  const s = withThread();
  const root = await mount(createRoot, probe(s));
  await flush();
  const sw = (): Node => find(root, "probe-switch")!;
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
  const dm = createSample("idle");
  const r2 = await mount(createRoot, probe(dm));
  await flush();
  assert.equal(find(r2, "probe-switch")!.props["aria-checked"], false, "a direct chat starts off");
});

test("a write that fails puts the switch back and says so", async () => {
  installDom(); widen(1280);
  const s = withThread();
  const root = await mount(createRoot, probe(s));
  await flush();
  s.failNext("threads.set_agent_replies");
  await press(find(root, "probe-switch"));
  await flush();
  assert.equal(find(root, "probe-switch")!.props["aria-checked"], true, "back to on");
  assert.ok(s.toasts.includes("Could not change that."));
});

test("the thread beside the chat has no permanent switch bar, on a wide screen or a phone", async () => {
  installDom();
  for (const [w, narrow] of [[1280, false], [390, true]] as const) {
    widen(w);
    const root = await mount(createRoot, side(withThread(), narrow));
    await flush();
    assert.equal(find(root, "thread-switch-row"), null, `${w}: no bar at the foot`);
    assert.equal(find(root, "thread-switch"), null);
  }
  widen(1280);
});

test("the thread's root is a plain message row with its face, name and time, then an N replies divider, and no boxed card, started-by line or Today divider", async () => {
  installDom(); widen(1280);
  const s = withThread();
  s.replica.put("messages", [msg("c2", "c1", 2, me, "Find a time for the vendor call next week, and compare the two quotes.")]);
  s.data.call = ((call) => async (cap: string, input: unknown) => (cap === "chat.message.get" ? { message: { author: { id: "usr_irfad" }, body: "Find a time for the vendor call next week, and compare the two quotes.", createdAt: at(9, 21) } } : call(cap, input)))(s.data.call);
  const root = await mount(createRoot, side(s, false));
  await flush(); await flush();
  const parent = textOf(find(root, "thread-parent"));
  assert.match(parent, /You\s+9:21/, "name and time");
  assert.match(parent, /Find a time for the vendor call/);
  assert.match(textOf(find(root, "thread-replies-divider")), /2 replies/);
  const all = textOf(root);
  assert.doesNotMatch(all, /Thread started by/);
  assert.equal(find(root, "day-" + "x"), null);
  assert.doesNotMatch(all, /\bToday\b/, "no day divider in a thread");
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
  assert.equal(repliesOf({ kind: "chat", recordId: "rec_1" }), false, "a chat about a record stays inline");
  assert.equal(repliesOf({ kind: "thread" }), undefined, "a thread has no such choice");
  assert.deepEqual([...alsoSentIds([{ blocks: [{ type: "from_thread", data: { threadId: "t1", messageId: "a" } }, { type: "from_thread", data: { threadId: "t9", messageId: "b" } }, { type: "from_thread", data: { threadId: "t1", messageId: "" } }] }, {}], "t1")], ["a"]);
});

void (null as unknown as ConversationData);

test("the Thread pane opens at about 40% of the room beside the sidebar, between 360 and 560 px", async () => {
  const { threadSideWidth } = await import("../mounts/ThreadSide.tsx");
  assert.equal(threadSideWidth(1280), 406, "the channel (874 - 406 = 610) stays the wider pane");
  assert.equal(threadSideWidth(1440), 470);
  assert.equal(threadSideWidth(2000), 560);
  assert.equal(threadSideWidth(800), 360);
  assert.equal(threadSideWidth(0), 400);
});
