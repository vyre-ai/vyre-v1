// The speed half of chats-conv.test.tsx (split out so only this file is a perf file, ruling 46); its functional tests stay in the original file and run on every PR.
// Chats conversation (P-L9b_04; mapped from apps/app/tests/chats-conv.test.tsx because lane L9b owns only apps/app/src/places/chats/): the page renders from the kept copy in the order spec 3.2 gives; a send is on the page before chat.post answers; while an agent works a plain send
// queues and Interrupt sends it now; the lead and listening agents show their mode marks; streamed text lands once per frame; the last 50 messages open in under 100 ms.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Conversation, ConversationLoading } from "./Conversation.tsx";
import { HoverBar, MessageView } from "./MessageView.tsx";
import * as act from "./actions.ts";
import {
  WINDOW, beforeCursor, byOrder, dayLabel, faces, lastMessages, leadOf, mentionsIn, mergePages, pendingMessage, queueNote, queuedCount, respondersFor, sendKind, stillPending, stopLabel,
  swapNeeded, timeline, whoLine, workOf, workingAgents, bodyBlocks, findMatches, reportLabel, matchLine, modelLabel, participants, placeholderFor, summarizeOpen, openVerdict, CHAT_OPEN_BUDGET_MS,
} from "./model.ts";
import { changeCount, editedNote, isPlanFile, isProposal, planFileLine, proposalActs, proposalData } from "./proposal.tsx";
import type { Message, Pending, Thread } from "./model.ts";
import { DIRECTORY, SAMPLE_NOW, createSample } from "./sample.ts";
import type { Sample, Variant } from "./sample.ts";
import { createStreamStore } from "../../../../../../ui/src/stream/index.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const html = (s: Sample): string => clean(renderToStaticMarkup(<Conversation data={s.data} />));
const has = (s: string, n: string): boolean => s.includes(n);
const at = (s: string, n: string): number => { const i = s.indexOf(n); assert.ok(i >= 0, `expected ${n}`); return i; };
const inOrder = (s: string, needles: string[]): void => { const idx = needles.map((n) => at(s, n)); assert.deepEqual([...idx].sort((a, b) => a - b), idx, needles.join(" > ")); };
const thread = (s: Sample): Thread => (s.data.screens.query("chats.conversation", "thread", { threadId: s.data.threadId }).getSnapshot() as { data: { thread: Thread } }).data.thread;
const msgs = (s: Sample): Message[] => (s.data.screens.query("chats.conversation", "messages", { threadId: s.data.threadId }).getSnapshot() as { data: { messages: Message[] } }).data.messages;
const ctx = (s: Sample) => ({ meId: "usr_irfad", nameOf: s.data.nameOf, kindOf: s.data.kindOf, clock: s.data.clock() });

const noActions = {
  copy: () => undefined, edit: () => undefined, setPinned: () => undefined, react: () => undefined, openThread: () => undefined, remove: () => undefined, openAgent: () => undefined, openBeside: () => undefined,
  answer: () => undefined, approvePlan: () => undefined, retryTurn: () => undefined, errorNext: () => undefined, retrySend: () => undefined, discardSend: () => undefined, showMenu: () => undefined,
  host: { invoke: () => undefined, open: () => undefined },
};

test("chat open: the last 50 messages are read, windowed and laid out in under 100 ms; the full server draw is reported", () => {
  const s = createSample("long");
  const open = (): number => {
    const t0 = performance.now();
    const snap = s.data.screens.query("chats.conversation", "messages", { threadId: "c1" }).getSnapshot() as { data: { messages: Message[] } };
    const items = timeline(lastMessages(snap.data.messages, WINDOW).rows, ctx(s));
    for (const m of snap.data.messages) bodyBlocks(m.messageId, m.body);
    assert.ok(items.length >= WINDOW);
    return performance.now() - t0;
  };
  open();
  const times = [open(), open(), open(), open(), open()].sort((a, b) => a - b);
  const ms = times[2]!;
  html(s);
  const t0 = performance.now();
  html(s);
  const draw = performance.now() - t0;
  console.log("METRIC " + JSON.stringify({ name: "chat_open", metric: "chat.last_50_ready", ms: Math.round(ms * 100) / 100, budget_ms: 100, ssr_draw_ms: Math.round(draw), note: "ssr_draw_ms is react-dom/server over react-native-web on a CI runner, not a browser paint" }));
  assert.ok(ms < 100, `ready in ${ms} ms`);
  assert.ok(draw < 2000, `server draw took ${draw} ms`);
});
test("a send is a row on the page before chat.post answers, in under 16 ms", async () => {
  const s = createSample("idle");
  s.holdPosts();
  const rows = msgs(s);
  const key = s.data.newKey();
  const t0 = performance.now();
  const p: Pending = { key, body: "Also send her the fee letter", at: SAMPLE_NOW, state: "sending", kind: "queue", mentions: [], working: false };
  const items = timeline([...rows, pendingMessage(p, "usr_irfad", "c1", 99)], ctx(s));
  const last = items[items.length - 1]!;
  const out = clean(renderToStaticMarkup(<MessageView item={last} actions={noActions} meId="usr_irfad" sending="sending" />));
  const ms = performance.now() - t0;
  console.log("METRIC " + JSON.stringify({ name: "send", metric: "msg.send_visible", ms: Math.round(ms * 100) / 100, budget_ms: 16 }));
  assert.ok(ms < 16, `visible in ${ms} ms`);
  assert.ok(has(out, "Also send her the fee letter") && has(out, "Sending"));
  assert.deepEqual(s.calls, [], "nothing has answered yet");
  const sent = act.sendMessage(s.data, { text: p.body, mentions: [], key, kind: "queue", working: false });
  s.releasePosts();
  const r = await sent;
  assert.deepEqual(s.calls.map((c) => c.cap), ["chat.post"]);
  assert.ok(msgs(s).some((m) => m.messageId === r.messageId), "the live list now carries it");
  assert.deepEqual(stillPending([{ ...p, messageId: r.messageId }], msgs(s)), [], "the pending row hides once the real message is there");
  assert.equal((s.calls[0]!.input as { idempotencyKey: string }).idempotencyKey, key);
});
