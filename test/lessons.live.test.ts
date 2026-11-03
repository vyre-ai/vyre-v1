// Learn from every correction, on a booted daemon (owner approval 3 Nov 2026): a person corrects an agent in chat and the post-turn learning pass keeps one lesson; the agent's next chat opens with it in
// its memory block and memory.used names it; Undo takes it away; a lesson learned in a private chat never reaches a channel other people read; and with the person's switch off nothing is kept.
// Nothing is faked inside the daemon: chat, agents, engine, memory and the hook runner are live. The model vendor stand-in is the memory live kit's, which answers a chat turn with the prompt the engine
// sent (so the reply shows the memory block) and the learning pass with something the pass cannot parse, so it is the free rules that read the correction.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, close as closeChat, connect, hostLog, newAgent, say, seededDir, waitFor } from "./memory-live-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const LESSON = "Keep notes to Sara to three lines, the number first.";
type Msg = { messageId: string; author?: { kind?: string }; body?: string };

/** Post to a chat the agent is in and wait for the agent's nth non-empty reply. */
async function post(d: Daemon, threadId: string, agentId: string, body: string, key: string, nth: number): Promise<{ reply: string; messages: Msg[] }> {
  const posted = await call(d, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `${key}-post` });
  assert.equal(posted.status, 200, JSON.stringify(posted.data));
  return waitFor(async () => {
    await d.hooks?.pump?.();
    const msgs = ((await call(d, "chat.messages.list", { threadId })).data.messages ?? []) as Msg[];
    const replies = msgs.filter((m) => m.author?.kind === "agent" && (m.body ?? "") !== "");
    return replies.length >= nth ? { reply: replies[nth - 1]!.body as string, messages: msgs } : null;
  }, 40_000, () => hostLog(d));
}

const lessons = async (d: Daemon, agentId: string, status: string[] = ["current"]): Promise<Array<{ factId: string; text: string; status: string; kind?: string; lesson?: { how?: string; used: number; scope: string } }>> =>
  (await call(d, "memory.facts.list", { agentId, kind: "lesson", status })).data.facts ?? [];
const waitLessons = (d: Daemon, agentId: string, n: number) => waitFor(async () => { await d.hooks?.pump?.(); const l = await lessons(d, agentId); return l.length >= n ? l : null; }, 30_000, () => hostLog(d));

test("lessons live: a correction in chat makes one lesson; the next chat uses it and shows it; Undo removes it; it never reaches a channel; the switch turns it all off", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    const mira = (await newAgent(d, "Mira")).id;

    // the person asks, the agent answers, the person corrects: one lesson, kept by Mira, with the line it came from
    const started = await call(d, "chat.start", { kind: "chat", agentIds: [mira], idempotencyKey: "ls-start" });
    const threadId = started.data.thread.threadId as string;
    await post(d, threadId, mira, "Draft the October note for Sara.", "ls-1", 1);
    const second = await post(d, threadId, mira, "No, keep notes to Sara to three lines, the number first.", "ls-2", 2);
    const made = await waitLessons(d, mira, 1);
    assert.equal(made.length, 1, JSON.stringify(made));
    assert.equal(made[0]!.text, LESSON);
    assert.deepEqual(made[0]!.lesson, { how: "refuse", used: 0, scope: "you" });
    const line = second.messages.find((m) => m.author?.kind === "person" && String(m.body).startsWith("No, keep"))!;
    const feed = await call(d, "memory.learned", { threadId });
    assert.equal(feed.status, 200, JSON.stringify(feed.data));
    const row = (feed.data.items as Array<{ fact: { factId: string; kind?: string; sourceLink?: string }; undone: boolean }>).find((i) => i.fact.factId === made[0]!.factId);
    assert.ok(row, "the Learned feed shows it");
    assert.equal(row.fact.kind, "lesson");
    assert.equal(row.fact.sourceLink, `/chats/${threadId}#${line.messageId}`, "it links to the line");
    // the same turn read again, and another message of thanks, make no second lesson
    await post(d, threadId, mira, "Thanks, that works.", "ls-3", 3);
    assert.equal((await lessons(d, mira)).length, 1);

    // the next chat: the lesson comes first in the memory block whatever the question, and memory.used names it
    const next = await say(d, mira, "Write up the November close for the board.", "ls-next");
    assert.match(next.reply, /From memory/);
    assert.ok(next.reply.includes(LESSON), `the lesson is in front of the agent: ${next.reply}`);
    const nextMsgs = ((await call(d, "chat.messages.list", { threadId: next.threadId })).data.messages ?? []) as Msg[];
    const asked = nextMsgs.find((m) => m.author?.kind === "agent" && (m.body ?? "") !== "")!;
    const used = await waitFor(async () => { const u = await call(d, "memory.used", { threadId: next.threadId, messageId: asked.messageId }); return (u.data.facts ?? []).length > 0 ? u.data : null; }, 20_000, () => hostLog(d));
    assert.deepEqual(used.facts.map((f: { kind?: string; text: string }) => [f.kind, f.text]), [["lesson", LESSON]]);
    assert.equal((await lessons(d, mira))[0]!.lesson?.used, 1, "it counts the answer that used it");

    // a channel other people read never gets it, whatever the question
    const ch = await call(d, "channels.create", { name: "notes", visibility: "public", agentIds: [mira], idempotencyKey: "ls-chan" });
    assert.equal(ch.status, 200, JSON.stringify(ch.data));
    const inChannel = await post(d, ch.data.channel.mainThreadId as string, mira, "Write notes to Sara for the board.", "ls-chan1", 1);
    assert.ok(!inChannel.reply.includes(LESSON), "a private lesson stays out of a shared chat");

    // Undo: the lesson goes to Trash, and the next chat no longer has it
    const undone = await call(d, "memory.undo", { factId: made[0]!.factId });
    assert.equal(undone.status, 200, JSON.stringify(undone.data));
    assert.equal((await lessons(d, mira)).length, 0);
    const after = await say(d, mira, "Write up the December close for the board.", "ls-after");
    assert.ok(!after.reply.includes(LESSON), "an undone lesson is not recalled");

    // the switch off: the same kind of correction keeps nothing
    const off = await call(d, "settings.set", { key: "memory.lessons", value: false });
    assert.equal(off.status, 200, JSON.stringify(off.data));
    const quiet = await call(d, "chat.start", { kind: "chat", agentIds: [mira], idempotencyKey: "ls-q-start" });
    const q = quiet.data.thread.threadId as string;
    await post(d, q, mira, "Draft the November note for Sara.", "ls-q1", 1);
    await post(d, q, mira, "No, never send figures to clients without asking me first.", "ls-q2", 2);
    await d.hooks?.pump?.();
    await new Promise<void>((r) => setTimeout(r, 1_500));
    await d.hooks?.pump?.();
    assert.deepEqual(await lessons(d, mira, ["current", "proposed"]), [], "off means nothing is learned");
    await closeChat(d, q);
  } finally { await d.stop(); }
});
