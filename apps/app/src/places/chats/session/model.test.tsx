// The pieces of a long session (owner, 6 Nov 2026): when a chat counts as long, the hour marks, jump points, the away row and what stays out of it, and the Overview's lists.
import test from "node:test";
import assert from "node:assert/strict";
import { timeline } from "../conversation/model.ts";
import type { Clock, Message } from "../conversation/model.ts";
import { awayWords, contextWords, hourLabel, isLong, isQuiet, jumpOf, needsPerson, questionsOf, ranWords, sessionItems, sessionTabs, summaryOf } from "./model.ts";

const H = 3_600_000, MIN = 60_000;
const T0 = Date.UTC(2026, 10, 5, 20, 0, 0);   // 5 Nov, 8 PM in the zone below
const clock: Clock = { now: T0 + 6 * H, offsetMin: 0 };
let seq = 0;
const msg = (o: Partial<Message> & { at: number; id?: string }): Message => {
  seq += 1;
  return { messageId: o.id ?? `m${seq}`, threadId: "thr", threadSeq: o.threadSeq ?? seq, body: "", kind: "text", createdAt: o.at, blocks: [], reactions: [], author: { kind: "agent", id: "agt_a" }, ...o } as unknown as Message;
};
const me = (at: number, body = "Go"): Message => msg({ at, body, author: { kind: "person", id: "usr_me" } });
/** Plain filler so a short fixture counts as a session (eight messages or more). */
const pad = (n: number, at: number): Message[] => Array.from({ length: n }, (_, i) => msg({ at: at + i * MIN, body: `ok ${i}` }));
const nameOf = (id: string): string => (id === "agt_a" ? "Assistant" : id === "usr_me" ? "You" : id);
const ctx = { meId: "usr_me", nameOf, kindOf: (id: string) => (id.startsWith("agt") ? "agent" as const : "person" as const), clock };

test("a chat is long at three hours with a handful of messages, or forty over an hour; a short one keeps the plain timeline", () => {
  const spread = (n: number, span: number) => Array.from({ length: n }, (_, i) => ({ createdAt: T0 + Math.round((i * span) / (n - 1)) }));
  assert.equal(isLong([{ createdAt: T0 }, { createdAt: T0 + 3 * H }]), false, "two messages are not a session");
  assert.equal(isLong(spread(8, 2 * H)), false);
  assert.equal(isLong(spread(8, 3 * H)), true);
  assert.equal(isLong(spread(60, 10 * MIN)), false, "a burst is not a session");
  assert.equal(isLong(spread(40, H)), true);
  assert.equal(isLong(spread(39, 2 * H)), false);
  const short = [me(T0), msg({ at: T0 + MIN, body: "ok" })];
  const items = timeline(short, ctx);
  assert.deepEqual(sessionItems(items, short, { meId: "usr_me", clock, nameOf, since: 0, openedAt: T0 + H }), items);
});

test("the pane of a long session: the chat's four tabs first, Threads and Pinned named, the rest after", () => {
  const out = sessionTabs([{ key: "overview", title: "Overview" }, { key: "about", title: "About" }, { key: "computer", title: "Computer" }, { key: "threads", title: "Chats" }, { key: "files", title: "Files" }, { key: "memory", title: "Knows" }, { key: "routines", title: "Routines" }]);
  assert.deepEqual(out.map((t) => t.title), ["Overview", "Threads", "Files", "Pinned", "About", "Computer", "Routines"]);
});

test("hours read as 8 PM and 12 AM", () => {
  assert.equal(hourLabel(T0, clock), "8 PM");
  assert.equal(hourLabel(T0 + 4 * H, clock), "12 AM");
  assert.equal(hourLabel(T0 + 15 * H, clock), "11 AM");
});

test("jump points: a release, a merged PR, a finished task and a decision; nothing else", () => {
  const card = (lead: string, title: string, target: string, body = "") => msg({ at: T0, kind: "system", blocks: [{ id: "b", type: "link_card", v: 1, state: "done", data: { icon: "x", lead, title, body, target: { type: target, id: "x" } } } as never] });
  assert.equal(jumpOf(msg({ at: T0, kind: "system", body: "Release v1.0.0-rc.22.1 tagged" }))?.kind, "release");
  assert.equal(jumpOf(msg({ at: T0, kind: "system", body: "Release v1.0.0-rc.22.1 tagged" }))?.sub, "v1.0.0-rc.22.1", "the detail is the part the label does not say");
  assert.equal(jumpOf(msg({ at: T0, kind: "system", body: "Merged #893 into main" }))?.kind, "merged");
  assert.equal(jumpOf(msg({ at: T0, kind: "system", body: "Merged #893 into main" }))?.sub, "#893 into main");
  assert.equal(jumpOf(card("Task", "Fix the sandbox", "task", "done"))?.kind, "task");
  const rc = (title: string, body = "") => msg({ at: T0, kind: "system", blocks: [{ id: "r", type: "result_card", v: 1, state: "done", data: { title, body } } as never] });
  assert.equal(jumpOf(rc("Merged #893 into main", "470 tests passed"))?.kind, "merged", "a result card is a jump point too");
  assert.equal(jumpOf(rc("Merged #893 into main"))?.sub, "#893 into main");
  assert.equal(jumpOf(card("Decision", "Corners are 12 px", "fact"))?.kind, "decision");
  assert.equal(jumpOf(msg({ at: T0, body: "Pinned thought", pinned: true } as never))?.kind, "decision");
  assert.equal(jumpOf(msg({ at: T0, body: "Looking at the release notes." })), null);
  assert.equal(jumpOf(card("Task", "Fix the sandbox", "task")), null, "a task made is not a task done");
});

test("what needs the person: an open question, a proposed plan, a card with buttons, an @", () => {
  const q = (answer?: string) => msg({ at: T0, blocks: [{ id: "q", type: "question", v: 1, state: "done", data: { prompt: "12 px or 14 px?", ...(answer ? { answer } : {}) } } as never] });
  assert.equal(needsPerson(q()), true);
  assert.equal(needsPerson(q("12 px")), false);
  assert.equal(needsPerson(msg({ at: T0, blocks: [{ id: "p", type: "plan", v: 1, state: "done", data: { state: "proposed", title: "Ship" } } as never] })), true);
  assert.equal(needsPerson(msg({ at: T0, blocks: [{ id: "c", type: "link_card", v: 1, state: "done", data: { lead: "Held", title: "Land it", actions: [{ key: "a", label: "Allow" }] } } as never] })), true);
  assert.equal(needsPerson(msg({ at: T0, body: "hey @Irfad" }), (m) => m.body.includes("@Irfad")), true);
  assert.equal(needsPerson(msg({ at: T0, body: "fine" })), false);
});

test("quiet: short agent lines and system lines; never your words, a question, a jump point or a long answer", () => {
  assert.equal(isQuiet(msg({ at: T0, body: "Tess merged the server fixes" }), "usr_me"), true);
  assert.equal(isQuiet(msg({ at: T0, kind: "system", body: "Crew started" }), "usr_me"), true);
  assert.equal(isQuiet(me(T0), "usr_me"), false);
  assert.equal(isQuiet(msg({ at: T0, body: "x".repeat(300) }), "usr_me"), false);
  assert.equal(isQuiet(msg({ at: T0, kind: "system", body: "Release v1.0.0 tagged" }), "usr_me"), false);
  assert.equal(isQuiet(msg({ at: T0, author: { kind: "person", id: "usr_aliza" }, body: "agent computers are broken" }), "usr_me"), false);
});

test("while you were away: a run of quiet items folds, the one that needs you stays, and the counts are right", () => {
  seq = 100;
  const seen = me(T0, "Ship it tonight");
  const quiet = (i: number) => msg({ at: T0 + 2 * H + i * MIN, body: `step ${i}`, author: { kind: "agent", id: i % 2 ? "agt_a" : `agt_h${i % 3}` } });
  const ask = msg({ at: T0 + 2 * H + 30 * MIN, id: "m_ask", blocks: [{ id: "q", type: "question", v: 1, state: "done", data: { prompt: "12 px or 14 px?" } } as never] });
  const msgs = [seen, ...[0, 1, 2, 3, 4, 5].map(quiet), ask, quiet(40), me(T0 + 5 * H, "Back")];
  const since = seen.threadSeq;
  const rows = sessionItems(timeline(msgs, ctx), msgs, { meId: "usr_me", clock, nameOf, since, openedAt: T0 + 6 * H });
  const away = rows.filter((r) => r.kind === "away");
  assert.equal(away.length, 1, "the lone quiet line after the question is under the minimum and stays");
  const a = away[0]!;
  assert.equal(a.kind === "away" && a.items.length, 6);
  assert.deepEqual(a.kind === "away" && a.lines.slice(0, 2).map((l) => `${l.who}: ${l.text}`), ["agt_h0: step 0", "Assistant: step 1"], "one line each: who and what");
  assert.equal(a.kind === "away" && a.needs, 1);
  assert.match(awayWords(a as never), /^Assistant and 3 helpers did 6 things, 1 needs you$/);
  assert.ok(rows.some((r) => r.kind === "other" && r.message.messageId === "m_ask"), "the question stays visible");
  assert.ok(rows.some((r) => r.kind === "me" && r.message.body === "Back"));
});

test("nothing folds without a read cursor, or for what arrived after the chat opened", () => {
  seq = 200;
  const msgs = [me(T0), ...Array.from({ length: 6 }, (_, i) => msg({ at: T0 + 2 * H + i * MIN, body: `q${i}` })), me(T0 + 4 * H)];
  const base = { meId: "usr_me", clock, nameOf, openedAt: T0 + 5 * H };
  assert.equal(sessionItems(timeline(msgs, ctx), msgs, { ...base, since: null }).some((r) => r.kind === "away"), false);
  assert.equal(sessionItems(timeline(msgs, ctx), msgs, { ...base, since: msgs[0]!.threadSeq, openedAt: T0 + 2 * H }).some((r) => r.kind === "away"), false);
});

test("hour marks open each new hour; a jump event becomes its jump row; a card keeps its place and the row follows", () => {
  seq = 300;
  const rel = msg({ at: T0 + 3 * H + 48 * MIN, kind: "system", body: "Release v1.0.0-rc.22.1 tagged" });
  const msgs = [me(T0), msg({ at: T0 + 10 * MIN, body: "On it" }), ...pad(4, T0 + 15 * MIN), msg({ at: T0 + H + 5 * MIN, body: "Done" }), rel, me(T0 + 4 * H)];
  const rows = sessionItems(timeline(msgs, ctx), msgs, { meId: "usr_me", clock, nameOf, since: null, openedAt: T0 });
  const kinds = rows.map((r) => r.kind);
  assert.deepEqual(rows.filter((r) => r.kind === "hour").map((r) => (r as { label: string }).label), ["8 PM", "9 PM", "11 PM", "12 AM"]);
  const jump = rows.find((r) => r.kind === "jump");
  assert.equal(jump && jump.kind === "jump" && jump.label, "Release tagged");
  assert.equal(kinds.filter((k) => k === "event").length, 0, "the system line is replaced by its jump row");
});

test("the Overview: the first ask, jumps, decisions, open questions, and how long it ran", () => {
  seq = 400;
  const msgs = [
    me(T0, "Ship rc.22.1 tonight."),
    msg({ at: T0 + H, kind: "system", blocks: [{ id: "b", type: "link_card", v: 1, state: "done", data: { icon: "fact", lead: "Decision", title: "Release after one green CI run", target: { type: "fact", id: "f" } } } as never] }),
    msg({ at: T0 + 2 * H, blocks: [{ id: "q", type: "question", v: 1, state: "done", data: { prompt: "Which corner radius?" } } as never] }),
    msg({ at: T0 + 4 * H + 41 * MIN, kind: "system", body: "Merged #893 into main" }),
    ...pad(4, T0 + 3 * H),
  ];
  const s = summaryOf(msgs, "usr_me");
  assert.equal(s.long, true);
  assert.equal(s.firstAsk, "Ship rc.22.1 tonight.");
  assert.deepEqual(s.jumps.map((j) => j.kind), ["decision", "merged"]);
  assert.deepEqual(s.decisions.map((j) => j.sub), ["Release after one green CI run"]);
  assert.deepEqual(questionsOf(msgs).map((q) => q.text), ["Which corner radius?"]);
  assert.equal(ranWords(s.from, s.to), "4 h 41 min");
  assert.equal(s.decisions[0]!.by, "agt_a", "a decision knows who said it");
  assert.equal(questionsOf(msgs)[0]!.by, "agt_a");
  assert.equal(contextWords({ used: 380_000, window: 1_000_000 }), "38% of 1M");
  assert.equal(contextWords({ used: 50_000, window: 200_000, approximate: true }), "about 25% of 200k");
  assert.equal(contextWords(null), "");
});

test("a message with a status card is never folded, and its jump row follows the card instead of replacing it", () => {
  seq = 500;
  const card = (id: string, type: string, data: Record<string, unknown>) => msg({ id, at: T0 + 2 * H, kind: "system", blocks: [{ id: `b${id}`, type, v: 1, state: "done", data } as never] });
  const merged = card("cm", "result_card", { title: "Merged #893 into main", body: "470 tests passed" });
  const msgs = [me(T0), ...pad(3, T0 + MIN), card("cp", "progress_card", { title: "Release rc.22.1", state: "running", steps: [] }), card("cs", "status_card", { title: "The MLA update could not start", tone: "warn" }), merged, ...pad(4, T0 + 3 * H), me(T0 + 4 * H)];
  const rows = sessionItems(timeline(msgs, ctx), msgs, { meId: "usr_me", clock, nameOf, since: msgs[0]!.threadSeq, openedAt: T0 + 6 * H });
  assert.ok(["cp", "cs", "cm"].every((id) => rows.some((r) => r.kind === "event" && r.message.messageId === id)), "all three cards stay in the timeline");
  assert.ok(rows.some((r) => r.kind === "jump" && r.label === "PR merged"), "the merge is also a jump point, after its card");
  const at = (id: string): number => rows.findIndex((r) => r.kind === "event" && r.message.messageId === id);
  assert.ok(rows.findIndex((r) => r.kind === "jump") > at("cm"));
});
