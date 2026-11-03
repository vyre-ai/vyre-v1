// Lessons (owner approval 3 Nov 2026): a correction makes one lesson, a fact of kind lesson in the person's own layer, kept by the agent; it is recalled on later turns of that agent, shows in the Learned feed and
// can be undone; it stays the person's own, never rides into a chat other people read, and is not kept at all when the switch is off. Sharing goes through memory.promote.
import test from "node:test";
import assert from "node:assert/strict";
import { capture, factsList, pointer, promote } from "../handlers/facts.ts";
import { recordCorrection } from "../handlers/corrections.ts";
import { learned, undo } from "../handlers/lifecycle.ts";
import { correctionOf, groundedIn, lessonText } from "../lessons.ts";
import { assertEventsConform, contractErrors, harness, NOW } from "../fixtures/harness.ts";
import type { Responder } from "../fixtures/harness.ts";

const THREAD = "thr_notes";
const DANA = "usr_dana";
const OMAR = "usr_omar";
const AGENT = "agt_mira";
const ACCOUNT = { ref: "#Dana_OpenRouter", driver: "openrouter", kind: "api_key", payer: DANA };
const person = (id: string) => ({ kind: "person", id });
const agent = { kind: "agent", id: AGENT };
const say = (seq: number, body: string, who: { kind: string; id: string } = person(DANA)) => ({ messageId: `msg_${seq}`, threadSeq: seq, author: who, body });
const models = [{ provider: "openrouter", model: "google/gemini-flash-lite", allowed: true, pricing: { prompt: "0.0000001", completion: "0.0000004" } }];

interface Script { messages: ReturnType<typeof say>[]; members?: string[]; kind?: string; mode?: string; answer?: (prompt: string) => string }
const seenPrompts: string[] = [];
function chat(s: Script): Record<string, Responder> {
  return {
    "threads.get": () => ({ thread: { kind: s.kind ?? "chat", starter: DANA, agents: [{ agentId: AGENT, mode: "lead" }], members: (s.members ?? [DANA]).map(person) } }),
    "agents.get": () => ({ agent: { folderId: "fld_mira", ownerId: "usr_boss", captureMode: s.mode ?? "auto" } }),
    "chat.messages.list": (i) => ({ messages: s.messages.filter((m) => i["after"] === undefined || m.threadSeq > Number(i["after"])), hasMore: false }),
    "engine.models.list": () => ({ models }),
    "engine.complete": (i) => { seenPrompts.push(String(i["prompt"])); return { text: s.answer?.(String(i["prompt"])) ?? "{\"ops\":[]}", tokensIn: 900, tokensOut: 40 }; },
  };
}
const turn = (account: Record<string, unknown> | null = ACCOUNT) => ({ threadId: THREAD, reason: "turn" as const, agentId: AGENT, ...(account ? { account: account as never } : {}) });
const lessons = (h: ReturnType<typeof harness>) => h.rows("SELECT id, layer, owner_ref, agent_id, kind, status, source_link FROM memory_facts WHERE kind = 'lesson'");

const DRAFT = "Hi Sara, I hope your week is going well. I wanted to share how October closed. Revenue came to $48,200 and expenses were $31,400.";

test("the rules: a line that says no, undoes or asks for it another way is a correction; thanks and questions are not", () => {
  assert.deepEqual(correctionOf("No, keep notes to Sara to three lines."), { how: "refuse", text: "Keep notes to Sara to three lines." });
  assert.equal(correctionOf("Undo that, please.")?.how, "reverse");
  assert.equal(correctionOf("Rewrite it with the number first.")?.how, "rewrite");
  assert.deepEqual(correctionOf("Good. But don't send it yet. Show me first."), { how: "refuse", text: "Don't send it yet. Show me first." });
  assert.equal(correctionOf("No."), null, "a bare no says nothing to keep");
  assert.equal(correctionOf("Thanks, that works."), null);
  assert.equal(correctionOf("Can you send it today?"), null);
});

test("lessonText: the person's own note first; with none, the draft's words, but never from a chat other people read", () => {
  assert.equal(lessonText({ how: "refuse", was: "Send the invoice to Dana", note: "ask me first" }, false), "Ask me first");
  assert.equal(lessonText({ how: "edit", now: "Revenue $51,900, up 8%." }, false), "Write drafts the way I edited this one: \"Revenue $51,900, up 8%.\"");
  assert.equal(lessonText({ how: "refuse", was: "Send the invoice to Dana" }, false), "Ask me before you do this again: Send the invoice to Dana");
  assert.equal(lessonText({ how: "edit", now: "Revenue $51,900, up 8%." }, true), null, "a shared chat with no note of their own keeps nothing");
  assert.equal(lessonText({ how: "refuse", was: "Send it", note: "never to clients without me" }, true), "Never to clients without me");
});

test("groundedIn: every longer word must already be on the screen", () => {
  assert.equal(groundedIn("Keep notes to Sara short", ["No, keep the notes to Sara short."]), true);
  assert.equal(groundedIn("Sara's salary is private", ["No, keep the notes to Sara short."]), false);
});

test("a correction said in chat makes one lesson, by the rules, in the person's own layer, kept by the agent, with its line", async () => {
  const s: Script = { messages: [say(1, "Draft the October note for Sara."), say(2, DRAFT, agent), say(3, "No, keep notes to Sara to three lines, the number first.")] };
  const h = harness({ respond: chat(s) });
  const out = await capture(h.ctx, turn(null));
  assert.equal(out.via, "rules");
  const rows = lessons(h);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0]!["layer"], rows[0]!["owner_ref"], rows[0]!["agent_id"], rows[0]!["status"]], ["person", DANA, AGENT, "current"]);
  assert.equal(rows[0]!["source_link"], `/chats/${THREAD}#msg_3`);
  // it reads back as a lesson, with how it was caught, and shows in the Learned feed with Undo
  const list = await factsList(h.ctx, { agentId: AGENT, kind: "lesson" });
  assert.deepEqual(contractErrors("memory.facts.list", "out", list), []);
  assert.equal(list.facts.length, 1);
  assert.equal(list.facts[0]!.text, "Keep notes to Sara to three lines, the number first.");
  assert.deepEqual(list.facts[0]!.lesson, { how: "refuse", used: 0, scope: "you" });
  const feed = await learned(h.ctx, { threadId: THREAD });
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0]!.fact.kind, "lesson");
  // the same turn again learns nothing new
  assert.equal((await capture(h.ctx, turn(null))).skipped, "nothing_new");
  assert.equal(lessons(h).length, 1);
  assert.deepEqual(assertEventsConform(h), []);
});

test("a line that does not follow the agent's work, a thank you and a question teach nothing", async () => {
  const s: Script = { messages: [say(1, "No, wait. Is the ledger closed for October yet? I need to know."), say(2, DRAFT, agent), say(3, "Thanks, that works well for the note to Sara."), say(4, "Can you send it to her today, around noon?")] };
  const h = harness({ respond: chat(s) });
  await capture(h.ctx, turn(null));
  assert.equal(lessons(h).length, 0);
});

test("with a model: its lesson op makes the lesson, once, and the rules do not add a second for the same line", async () => {
  const s: Script = {
    messages: [say(1, "Draft the October note for Sara."), say(2, DRAFT, agent), say(3, "No, three lines, number first.")],
    answer: () => JSON.stringify({ ops: [{ op: "lesson", line: 3, text: "Notes to Sara: three lines, the number first", how: "edit" }] }),
  };
  const h = harness({ respond: chat(s) });
  const out = await capture(h.ctx, turn());
  assert.equal(out.via, "model");
  const rows = lessons(h);
  assert.equal(rows.length, 1);
  const f = (await factsList(h.ctx, { kind: "lesson" })).facts[0]!;
  assert.equal(f.text, "Notes to Sara: three lines, the number first");
  assert.equal(f.lesson?.how, "edit");
  assert.ok(seenPrompts.at(-1)!.length > 0);
});

test("the pass is told about lessons only while the switch is on; off, nothing is kept and other learning goes on", async () => {
  const s: Script = { messages: [say(1, "I prefer short answers."), say(2, DRAFT, agent), say(3, "No, keep notes to Sara to three lines.")] };
  const off = harness({ respond: chat(s), settings: { "memory.lessons": false } });
  const out = await capture(off.ctx, turn(null));
  assert.equal(lessons(off).length, 0);
  assert.equal(out.proposed >= 1, true, "the preference is still learned");
  assert.equal((await recordCorrection(off.ctx, { agentId: AGENT, how: "edit", was: "a", now: "Revenue is up eight percent." })).why, "off");
  assert.equal(lessons(off).length, 0);
  const on = harness({ respond: chat(s) });
  await capture(on.ctx, turn(null));
  assert.equal(lessons(on).length, 1);
});

test("the next turn: the lesson comes first in the agent's block whatever the question, once per chat; Undo takes it out", async () => {
  const s: Script = { messages: [say(1, "Draft the October note for Sara."), say(2, DRAFT, agent), say(3, "No, keep notes to Sara to three lines, the number first.")] };
  const h = harness({ respond: chat(s) });
  await capture(h.ctx, turn(null));
  const id = lessons(h)[0]!["id"] as string;
  const block = await pointer(h.ctx, { threadId: "thr_next", agentId: AGENT, text: "Write up the November close for the board." });
  assert.equal(block.lines.length, 1);
  assert.deepEqual([block.lines[0]!.title, block.lines[0]!.fact, block.lines[0]!.ref], ["Lesson", "Keep notes to Sara to three lines, the number first.", id]);
  // another agent does not get it
  assert.equal((await pointer(h.ctx, { threadId: "thr_other", agentId: "agt_other", text: "Write up the November close for the board." })).lines.length, 0);
  // Undo: gone from later blocks, in Trash with the reason undone
  await undo(h.ctx, { factId: id });
  assert.equal((await pointer(h.ctx, { threadId: "thr_after", agentId: AGENT, text: "Write up the November close for the board." })).lines.length, 0);
  assert.equal(h.rows("SELECT trash_reason FROM memory_facts WHERE id = ?", id)[0]!["trash_reason"], "undone");
});

test("private: a lesson never reaches a chat other people read, and another person never sees it", async () => {
  const s: Script = { messages: [say(1, "Draft the October note for Sara."), say(2, DRAFT, agent), say(3, "No, keep notes to Sara to three lines.")] };
  const h = harness({ respond: chat(s) });
  await capture(h.ctx, turn(null));
  const shared: Record<string, Responder> = { "threads.get": () => ({ thread: { kind: "channel", agents: [{ agentId: AGENT, mode: "lead" }], members: [person(DANA), person(OMAR)] } }) };
  const inShared = harness({ raw: h.raw, clock: h.clock, respond: shared });
  assert.equal((await pointer(inShared.ctx, { threadId: "thr_chan", agentId: AGENT, text: "Write notes to Sara for the board." })).lines.length, 0);
  const omar = harness({ raw: h.raw, clock: h.clock, principal: person(OMAR) });
  assert.equal((await factsList(omar.ctx, { kind: "lesson" })).facts.length, 0);
  assert.equal((await pointer(omar.ctx, { threadId: "thr_omar", agentId: AGENT, text: "Write notes to Sara for the board." })).lines.length, 0);
});

test("a correction in a chat other people read: only words already on screen, kept for those who heard it, private to the person", async () => {
  const s: Script = {
    kind: "channel", members: [DANA, OMAR], messages: [say(1, "Draft the note for Sara.", person(OMAR)), say(2, DRAFT, agent), say(3, "No, keep notes to Sara to three lines.")],
    answer: () => JSON.stringify({ ops: [{ op: "lesson", line: 2, text: "Sara earns too little and wants a raise, so mention the budget", how: "refuse" }, { op: "lesson", line: 2, text: "Keep notes to Sara to three lines", how: "refuse" }] }),
  };
  const h = harness({ respond: chat(s) });
  const outShared = await capture(h.ctx, turn());
  assert.equal(outShared.via, "model");
  // Omar's line is not in the pass, so the person's line is line 2 here
  const rows = lessons(h);
  assert.equal(rows.length, 1, "the lesson with words from nowhere on screen is dropped");
  assert.equal((await factsList(h.ctx, { kind: "lesson" })).facts[0]!.text, "Keep notes to Sara to three lines");
  assert.deepEqual(h.rows("SELECT ref FROM memory_fact_links WHERE kind = 'heard_in'"), [{ ref: THREAD }]);
  assert.equal(rows[0]!["layer"], "person");
  // Omar's words never entered the pass
  assert.equal(seenPrompts.at(-1)!.includes("Draft the note for Sara."), false);
});

test("a correction outside the chat: an edit of a draft makes one lesson, the same edit twice does not make two, and a chat others read needs the person's own note", async () => {
  const h = harness();
  const input = { agentId: AGENT, how: "edit" as const, was: DRAFT, now: "Revenue $51,900, up 8%. One invoice open.", ref: "eml_1:v1" };
  const out = await recordCorrection(h.ctx, input);
  assert.equal(out.kept, true);
  assert.deepEqual(contractErrors("memory.corrections.record", "out", out), []);
  assert.equal(out.lesson?.kind, "lesson");
  assert.equal(out.lesson?.lesson?.how, "edit");
  assert.equal((await recordCorrection(h.ctx, input)).why, "duplicate");
  assert.equal(lessons(h).length, 1);
  const shared = harness({ raw: h.raw, clock: h.clock, respond: { "threads.get": () => ({ thread: { kind: "channel", agents: [], members: [person(DANA), person(OMAR)] } }) } });
  assert.equal((await recordCorrection(shared.ctx, { agentId: AGENT, how: "edit", was: DRAFT, now: "Revenue $52,000.", threadId: "thr_chan", ref: "x" })).why, "nothing");
  assert.equal((await recordCorrection(shared.ctx, { agentId: AGENT, how: "refuse", was: DRAFT, note: "never send figures to clients", threadId: "thr_chan", ref: "y" })).kept, true);
  // an agent cannot teach itself: the call is as the person who corrected
  const asAgent = harness({ raw: h.raw, clock: h.clock, principal: agent });
  await assert.rejects(() => recordCorrection(asAgent.ctx, input));
  // a chat set not to be remembered teaches nothing
  const quiet = harness({ raw: h.raw, clock: h.clock });
  quiet.db.run("CREATE TABLE IF NOT EXISTS memory_chat_learning (thread_id TEXT PRIMARY KEY, off INTEGER NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL)");
  quiet.db.run("INSERT INTO memory_chat_learning (thread_id, off, by, at) VALUES ('thr_quiet', 1, ?, ?)", DANA, NOW);
  assert.equal((await recordCorrection(quiet.ctx, { agentId: AGENT, how: "refuse", was: "Send it to Dana", threadId: "thr_quiet", ref: "q" })).why, "forgotten");
});

test("sharing a lesson goes through memory.promote: it waits for a person to accept, and says so", async () => {
  const respond: Record<string, Responder> = { "agents.get": () => ({ agent: { folderId: "fld_mira", ownerId: "usr_boss" } }) };
  const h = harness({ respond, readOnly: ["folder:fld_mira"] });
  const made = await recordCorrection(h.ctx, { agentId: AGENT, how: "refuse", was: "Send the invoice to Dana", ref: "gate_1" });
  const id = made.lesson!.factId;
  const out = await promote(h.ctx, { factId: id, toLayer: "agent", agentId: AGENT });
  assert.equal(out.promoted, false);
  assert.equal((await factsList(h.ctx, { kind: "lesson" })).facts.find((f) => f.factId === id)?.lesson?.scope, "proposed");
  assert.equal((await factsList(h.ctx, { layer: "agent" })).facts.length, 0, "nothing is shared until a person accepts");
});
