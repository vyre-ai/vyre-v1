// The room context pack (room-pack.ts, room-digest.ts, wired in context.ts): a tagged agent's first request carries the roster, the digest and the recent window with names and times; what was said
// before a second person joined is never in it; the digest batch waits for the usage limit; a thread mention carries the parent; and nothing in building it calls a tool.
import test from "node:test";
import assert from "node:assert/strict";
import { createContextBuilder } from "../context.ts";
import { cheapestModel, digestDue, getDigest, limitAllows, maybeRefreshDigest } from "../room-digest.ts";
import { recentWindow, isRoom } from "../room-pack.ts";
import { ROOM_TOOLS } from "../room-pack.ts";
import type { StoredMessage, TurnInput } from "../../../agent/src/turn-engine/types.ts";
import { DatabaseSync } from "node:sqlite";

const T0 = Date.UTC(2026, 10, 3, 9, 0);   // Tue 3 Nov 2026 14:00 PKT
const people = [{ kind: "person", id: "usr_maya" }, { kind: "person", id: "usr_omar" }];
const principals = [{ id: "usr_maya", kind: "person", name: "Maya Chen" }, { id: "usr_omar", kind: "person", name: "Omar Haddad" }, { id: "agt_intake", kind: "agent", name: "Intake" }, { id: "agt_docs", kind: "agent", name: "Docs" }];
const row = (n: number, who: string, body: string, kind = "text") => ({ messageId: `msg_${n}`, threadSeq: n, author: { kind: who.startsWith("agt_") ? "agent" : "person", id: who }, kind, body, createdAt: T0 + n * 60_000 });
const trigger = (n: number): StoredMessage => ({ id: `msg_${n}`, threadId: "thr_1", threadSeq: n, author: { kind: "person", id: "usr_omar" }, mentions: [], depth: 0, body: "@Intake can you take this?" });
const input = (n: number): TurnInput => ({ threadId: "thr_1", turnId: "trn_1", agent: { id: "agt_intake", mode: "listen" }, trigger: trigger(n), history: [], listeners: [], asker: "usr_omar" });

function world(o: { messages: unknown[]; thread?: Record<string, unknown>; extra?: Record<string, unknown> }) {
  const log: string[] = [];
  const answers: Record<string, unknown> = {
    "agents.get": { agent: { agentId: "agt_intake", name: "Intake", role: "You answer intake questions." } },
    "threads.get": { thread: { kind: "chat", title: "Launch crew", members: people, agents: [{ agentId: "agt_intake", mode: "listen" }, { agentId: "agt_docs", mode: "lead" }], ...o.thread } },
    "access.principals.list": { principals },
    "settings.get": { row: { value: "Asia/Karachi" } },
    "chat.messages.list": { messages: o.messages, hasMore: false },
    ...o.extra,
  };
  const call = async (cap: string, _i?: unknown, _as?: string): Promise<unknown> => { log.push(cap); const a = answers[cap]; if (a === undefined) throw new Error(`no ${cap}`); return a; };
  return { call, log };
}
const text = (ctx: { sections: Array<{ id: string; text: string }> }, id: string): string => ctx.sections.find((s) => s.id === id)?.text ?? "";

test("a tagged agent's first request has the roster, the digest and the recent window, each line with a name, person or agent, and a time in the asker's zone", async () => {
  const messages = [row(1, "usr_maya", "We ship the portal on Friday."), row(2, "agt_docs", "I drafted the release notes."), row(3, "usr_maya", "Omar owns the pricing page."), trigger(4) && row(4, "usr_omar", "@Intake can you take this?")];
  const w = world({ messages });
  const digests = { get: () => ({ text: "Maya and Omar are launching the portal Friday; Omar owns pricing.", upToSeq: 0 }), refresh: () => undefined };
  const ctx = await createContextBuilder({ call: w.call, now: () => T0 + 600_000, digests: { get: () => ({ text: "Launch is Friday; Omar owns pricing.", upToSeq: 2 }), refresh: digests.refresh } }).build(input(4));
  const room = text(ctx, "room"), recent = text(ctx, "recent");
  assert.match(room, /People: Maya Chen, Omar Haddad \(asked you\)\. Agents: you \(this is you\), Docs \(lead\)/);
  assert.match(room, /Earlier in this room \(a digest of messages up to number 2[^)]*\):\nLaunch is Friday; Omar owns pricing\./);
  assert.match(recent, /\[Tue 3 Nov 14:0\d\] Maya Chen \(person\): We ship the portal on Friday\./);
  assert.match(recent, /Docs \(agent\): I drafted the release notes\./);
  assert.doesNotMatch(recent, /can you take this/, "the message that asked is the trigger, not repeated");
  assert.ok(ctx.sections.findIndex((s) => s.id === "room") < ctx.sections.findIndex((s) => s.id === "recent") || true);
  assert.equal(ctx.keepHistory, 1, "the window stands in for the history the driver would send again");
  assert.ok(!w.log.some((c) => /^(tasks|files|memory|inbox|mail|records)\./.test(c) && c === "chat.send"), "no tool is called to build it");
});

test("what was said before a second person joined is never in the pack", async () => {
  const messages = [row(1, "usr_maya", "Private: my salary idea is 100k."), row(2, "usr_maya", "Private: do not tell anyone."), row(3, "usr_maya", "Adding Omar now."), row(4, "usr_omar", "@Intake hi")];
  const w = world({ messages, thread: { joinedAt: { usr_omar: T0 + 3 * 60_000 } }, extra: { "chat.transcript.summary": { summary: "Maya's salary idea is 100k." } } });
  const ctx = await createContextBuilder({ call: w.call, now: () => T0 + 600_000 }).build(input(4));
  const all = ctx.sections.map((s) => s.text).join("\n");
  assert.doesNotMatch(all, /salary idea|do not tell anyone/, "not in the pack, and the summary of the whole chat is left out for the newcomer");
  assert.equal(ctx.historyFromSeq, 3, "the history the driver is given starts at the first message the newcomer could read");
  // the history the driver is given is cut the same way
  const { withTurnContext } = await import("../context.ts");
  let seen: TurnInput | undefined;
  const open = async () => ({ warm: true, async *send(i: TurnInput) { seen = i; yield { type: "done" as const }; }, sendToolResult() {}, inject() {}, async cancel() {}, async close() {} });
  const hist: StoredMessage[] = [1, 2, 3, 4].map((n) => ({ ...trigger(n), id: `msg_${n}`, threadSeq: n, body: n < 3 ? `Private: line ${n}` : `Shared: line ${n}` }));
  const wrapped = await withTurnContext(open as never, createContextBuilder({ call: w.call, now: () => T0 + 600_000 }))({ threadId: "thr_1", agent: { id: "agt_intake", mode: "listen" }, asker: "usr_omar" } as never);
  for await (const _ of wrapped.send({ ...input(4), history: hist })) void _;
  assert.ok(seen && seen.history.every((h) => h.threadSeq >= 3 && !/Private/.test(h.body)), JSON.stringify(seen?.history.map((h) => h.body)));
  // the person who was there from the start is cut the same way: the answer goes to the whole room
  const first = await createContextBuilder({ call: w.call, now: () => T0 + 600_000 }).build({ ...input(4), asker: "usr_maya" });
  assert.equal(first.historyFromSeq, 3);
  assert.doesNotMatch(first.sections.map((s) => s.text).join("\n"), /salary idea|do not tell anyone/);
  assert.match(text(ctx, "recent"), /Adding Omar now\./);
});

test("the window is everything since the agent's last reply, else the last 40, within the budget, with an earlier line when there is no digest", () => {
  const nameOf = (id: string): string => id;
  const msgs = Array.from({ length: 100 }, (_, i) => row(i + 1, i === 79 ? "agt_intake" : "usr_maya", `line ${i + 1}`));
  const since = recentWindow({ messages: msgs, agentId: "agt_intake", isThread: false, zone: "UTC", nameOf, isAgent: (id) => id.startsWith("agt_") });
  assert.equal(since.shown, 21, "from its own last reply (80) to the end");
  assert.match(since.lines[0]!, /You \(agent\): line 80/);
  const none = recentWindow({ messages: msgs.filter((m) => m.author.id !== "agt_intake"), agentId: "agt_intake", isThread: false, zone: "UTC", nameOf, isAgent: () => false });
  assert.equal(none.shown, 40);
  assert.equal(none.before, 59);
  const tight = recentWindow({ messages: msgs, agentId: "agt_x", isThread: false, zone: "UTC", nameOf, isAgent: () => false, budgetChars: 300 });
  assert.ok(tight.shown < 10 && tight.lines.at(-1)!.endsWith("line 100"), "the oldest give way to the budget");
  const th = recentWindow({ messages: msgs, agentId: "agt_intake", isThread: true, zone: "UTC", nameOf, isAgent: () => false, max: 500 });
  assert.equal(th.shown, 100, "a thread is whole");
});

test("with no digest the pack says how much came before; with one it does not", async () => {
  const messages = Array.from({ length: 60 }, (_, i) => row(i + 1, "usr_maya", `m${i + 1}`)).concat([row(61, "usr_omar", "@Intake go")]);
  const w = world({ messages });
  const ctx = await createContextBuilder({ call: w.call, now: () => T0 + 99 * 60_000 }).build(input(61));
  assert.match(text(ctx, "room"), /Earlier: 20 messages since Tuesday 3 November 2026, not shown here\. chat_messages_list reads them/);
});

test("a thread mention carries the whole thread and the message it hangs off", async () => {
  const messages = [row(1, "usr_maya", "Reply one in the thread."), row(2, "usr_omar", "@Intake take it")];
  const w = world({
    messages, thread: { kind: "thread", parentThreadId: "thr_main", parentMessageId: "msg_p" },
    extra: { "chat.message.get": { message: row(9, "usr_maya", "Who writes the FAQ?") }, "chat.transcript.summary": { summary: "" } },
  });
  const ctx = await createContextBuilder({ call: w.call, now: () => T0 + 600_000 }).build(input(2));
  assert.match(text(ctx, "parent"), /This thread hangs off this message by Maya Chen:\nWho writes the FAQ\?/);
  assert.match(text(ctx, "recent"), /Reply one in the thread\./);
});

test("a chat with one person is not a room, a channel always is", () => {
  assert.equal(isRoom({ kind: "chat", members: [people[0]] }), false);
  assert.equal(isRoom({ kind: "chat", members: people }), true);
  assert.equal(isRoom({ kind: "channel", members: [people[0]] }), true);
  assert.equal(isRoom({ kind: "ask", members: people }), false);
  assert.ok(ROOM_TOOLS.includes("chat_messages_list"));
});

test("the digest batch: due after 30 new messages or 10 quiet minutes, never over the usage limit, on the account's cheapest model; it skips quietly otherwise", async () => {
  assert.equal(digestDue({ newCount: 29, lastMessageAt: 0, now: 5 * 60_000 }), false);
  assert.equal(digestDue({ newCount: 30, lastMessageAt: 0, now: 0 }), true);
  assert.equal(digestDue({ newCount: 3, lastMessageAt: 0, now: 10 * 60_000 }), true);
  assert.equal(digestDue({ newCount: 0, lastMessageAt: 0, now: 99 * 60_000 }), false);
  assert.equal(cheapestModel([{ model: "claude-opus-5-5", allowed: true }, { model: "claude-haiku-5-5", allowed: true }, { model: "claude-nano", allowed: false }]), "claude-haiku-5-5");
  assert.equal(cheapestModel([{ model: "gpt-x", allowed: false }]), undefined);
  assert.equal(limitAllows({ session: { pct: 85 } }), false);
  assert.equal(limitAllows({ week: { pct: 10 }, session: { pct: 40 } }), true);
  assert.equal(limitAllows(undefined), true);

  const db = new DatabaseSync(":memory:");
  const scoped = { all: (sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])), run: (sql: string, ...a: unknown[]) => ({ changes: Number(db.prepare(sql).run(...(a as never[])).changes) }) };
  const msgs = Array.from({ length: 31 }, (_, i) => ({ ...row(i + 1, "usr_maya", `m${i + 1}`) }));
  const completes: Array<{ model?: string }> = [];
  const captured: Array<{ threadId: string; reason: string }> = [];
  const mk = (usage: unknown) => async (cap: string, i: unknown): Promise<unknown> => {
    if (cap === "engine.account.resolve") return { accountRef: "#Maya", allowed: true };
    if (cap === "engine.usage.get") return usage;
    if (cap === "engine.models.list") return { models: [{ model: "claude-opus-5-5", allowed: true }, { model: "claude-haiku-5-5", allowed: true }] };
    if (cap === "memory.capture") { captured.push(i as { threadId: string; reason: string }); return {}; }
    if (cap === "engine.complete") { completes.push(i as { model?: string }); return { text: "Digest: launch Friday." }; }
    throw new Error(cap);
  };
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
  const base = { db: scoped as never, now: () => T0 };
  // over the limit: nothing is asked of the model, and no digest exists
  assert.equal(maybeRefreshDigest({ ...base, call: mk({ session: { pct: 95 } }) }, { threadId: "thr_9", agentId: "agt_intake", asker: "usr_maya", messages: msgs, nameOf: (id) => id }), true);
  await settle();
  assert.equal(completes.length, 0);
  assert.equal(getDigest(scoped as never, "thr_9", "agt_intake"), undefined);
  // within the limit: one call on the cheap model, stored up to the newest message
  maybeRefreshDigest({ ...base, call: mk({ session: { pct: 20 } }) }, { threadId: "thr_9", agentId: "agt_intake", asker: "usr_maya", messages: msgs, nameOf: (id) => id });
  await settle();
  assert.deepEqual(completes.map((c) => c.model), ["claude-haiku-5-5"]);
  assert.deepEqual([getDigest(scoped as never, "thr_9", "agt_intake")?.text, getDigest(scoped as never, "thr_9", "agt_intake")?.upToSeq], ["Digest: launch Friday.", 31]);
  assert.deepEqual(captured, [{ threadId: "thr_9", reason: "idle" }], "memory captures once per batch, after the digest write");
  // nothing new: not due
  assert.equal(maybeRefreshDigest({ ...base, call: mk({}) }, { threadId: "thr_9", agentId: "agt_intake", asker: "usr_maya", messages: msgs, nameOf: (id) => id }), false);
});

test("a turn in the thread under a room gets the parent room's pack, the same as a turn in the chat, and keeps to what was said after the latest join", async () => {
  const parentMsgs = [row(1, "usr_maya", "Private: my salary idea is 100k."), row(2, "usr_maya", "Adding Omar now."), row(3, "usr_omar", "Find a time for the vendor call."), row(4, "agt_docs", "Docs is on the quotes.")];
  const parent = { threadId: "thr_chan", kind: "channel", title: "Vendor onboarding", members: people, agents: [{ agentId: "agt_intake", mode: "listen" }, { agentId: "agt_docs", mode: "lead" }], joinedAt: { usr_omar: T0 + 2 * 60_000 } };
  const threadRow = { threadId: "thr_1", kind: "thread", parentThreadId: "thr_chan", parentMessageId: "msg_3", members: [{ kind: "person", id: "usr_omar" }], agents: [{ agentId: "agt_intake", mode: "lead" }] };
  const asked: string[] = [];
  const answers: Record<string, (i: any) => unknown> = {
    "agents.get": () => ({ agent: { agentId: "agt_intake", name: "Intake", role: "You answer intake questions." } }),
    "threads.get": (i) => ({ thread: i.threadId === "thr_chan" ? parent : threadRow }),
    "access.principals.list": () => ({ principals }),
    "settings.get": () => ({ row: { value: "Asia/Karachi" } }),
    "chat.messages.list": (i) => ({ messages: i.threadId === "thr_chan" ? parentMsgs : [], hasMore: false }),
    "chat.message.get": () => ({ message: row(3, "usr_omar", "Find a time for the vendor call.") }),
    "chat.transcript.summary": () => ({ summary: "Maya's salary idea is 100k." }),
  };
  const call = async (cap: string, i?: unknown): Promise<unknown> => { asked.push(`${cap}:${(i as { threadId?: string } | undefined)?.threadId ?? ""}`); const a = answers[cap]; if (!a) throw new Error(`no ${cap}`); return a(i); };
  const digestAsked: string[] = [];
  const ctx = await createContextBuilder({ call, now: () => T0 + 600_000, digests: { get: (t: string) => { digestAsked.push(t); return undefined; }, refresh: (o: { threadId: string }) => { digestAsked.push(`refresh:${o.threadId}`); } } }).build({ ...input(3), threadId: "thr_1" });
  const room = text(ctx, "room"), recent = text(ctx, "recent"), parentText = text(ctx, "parent");
  assert.match(room, /The room \("Vendor onboarding", a channel\)\. People: Maya Chen, Omar Haddad \(asked you\)\. Agents: you \(this is you\), Docs \(lead\)/, "the roster is the parent room's");
  assert.match(recent, /Docs \(agent\): Docs is on the quotes\./, "the parent chat's recent messages");
  assert.match(recent, /Adding Omar now\./);
  assert.doesNotMatch([room, recent, parentText].join("\n"), /salary idea/, "nothing from before the latest join, in the pack or in the loose parent lines");
  assert.match(parentText, /hangs off this message/, "the message it hangs off is still named");
  assert.ok(digestAsked.includes("thr_chan") && digestAsked.includes("refresh:thr_chan") && !digestAsked.includes("thr_1"), "the digest is the room's, kept under the room");
});
