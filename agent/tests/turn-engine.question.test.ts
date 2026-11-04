// ask_question parks the turn (owner bug, 4 Nov 2026: Andrey's Assistant asked "test" mid-loop and carried on). The question's card and task are in the chat and in Needs you, so the turn stops there:
// turn.waiting on its block, no result and no further model call, until the answer (a message that wakes the agent) or a withdrawal. A turn that ends without waiting takes its question back.
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider, toolRunnerFrom } from "../src/turn-engine/index.ts";
import type { DriverEvent, EngineAgent, OpenThread } from "../src/turn-engine/index.ts";

const person = { kind: "person" as const, id: "dana" };
const agents = (): EngineAgent[] => [{ id: "intake", mode: "lead" }];
const thread = (): OpenThread => ({ id: "T", kind: "chat", starter: "dana", agents: agents() });
const ask: DriverEvent = { type: "tool_call", id: "call_q", name: "ask_question", input: { prompt: "Which firm should I file this for?", mode: "free" } };
const asked = toolRunnerFrom(async () => ({ kind: "result", result: { ok: true, content: { data: { blockId: "blk_1", messageId: "msg_1" } } }, parkOn: { blockId: "blk_1" } }));

test("an API turn that asks a question parks on its block and makes no further model call", async () => {
  const p = scriptedProvider({ script: [{ type: "text", text: "One question." }, ask, { type: "text", text: "and then I carried on" }, { type: "done" }] });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, callTool: asked });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "file it" });
  await engine.idle("T");
  const turn = engine.turns("T")[0];
  assert.equal(turn?.state, "waiting");
  assert.equal(turn?.endedAt, null);
  assert.deepEqual(engine.waiting("T").map((w) => w.taskId), ["blk_1"], "the turn waits on the question's block");
  assert.equal(p.sessions[0]?.toolResults.length, 0, "the model is sent no result, so it makes no further call");
  assert.ok(!engine.messages("T").some((m) => m.body.includes("carried on")), "nothing is said after the question");
  // the answer (or a withdrawal) ends the wait; the answer itself is a message that wakes the agent
  assert.equal(engine.release("blk_1"), true);
  assert.equal(engine.release("blk_1"), false, "once");
  assert.deepEqual(engine.waiting("T"), []);
});


test("a turn stopped after it asked takes the question back; a turn that parked does not", async () => {
  const left: Array<{ turnId: string; blocks: readonly string[] }> = [];
  const p = scriptedProvider({ script: [ask, { type: "done" }] });
  let engine!: ReturnType<typeof createTurnEngine>;
  const runner = toolRunnerFrom(async () => { void engine.stop("T"); await new Promise((r) => setTimeout(r, 20)); return { kind: "result", result: { ok: true, content: {} }, parkOn: { blockId: "blk_2" } }; });
  engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, callTool: runner, onQuestionsLeft: (turn, blocks) => { left.push({ turnId: turn.id, blocks }); } });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "file it" });
  await engine.idle("T");
  assert.equal(engine.turns("T")[0]?.state, "cancelled");
  assert.deepEqual(left.map((l) => l.blocks), [["blk_2"]]);
  // a turn that parked on its question leaves it in place
  const kept: string[] = [];
  const p2 = scriptedProvider({ script: [ask, { type: "done" }] });
  const e2 = createTurnEngine({ holder: "host:s", openSession: p2.openSession, callTool: asked, onQuestionsLeft: (_t, b) => { kept.push(...b); } });
  e2.openThread(thread());
  e2.receive({ threadId: "T", author: person, body: "file it" });
  await e2.idle("T");
  assert.deepEqual(kept, []);
});

test("a turn that parks on a hold records the usage it had before the hold, and is not left running once the wake starts", async () => {
  const metered: Array<{ id: string; state: string; tokens: number }> = [];
  const hold: DriverEvent = { type: "tool_call", id: "call_h", name: "mail_send", input: {} };
  const p = scriptedProvider({ script: (input) => (input.resumed ? [{ type: "text", text: "Understood, not sending." }, { type: "usage", inputTokens: 5, outputTokens: 2 }, { type: "done" }] : [{ type: "text", text: "Sending." }, { type: "usage", inputTokens: 120, outputTokens: 30 }, hold, { type: "done" }]) });
  const runner = toolRunnerFrom(async () => ({ kind: "held", result: { ok: false, content: {} }, taskId: "tsk_h" }));
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, callTool: runner, onTurnEnd: (turn) => { metered.push({ id: turn.id, state: turn.state, tokens: turn.tokensIn + turn.tokensOut }); } });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "send it" });
  await engine.idle("T");
  assert.deepEqual(metered.map((m) => [m.state, m.tokens]), [["waiting", 150]], "metered at the hold, with the tokens from before it");
  assert.equal(engine.turns("T")[0]?.state, "waiting");
  // denied: the wake is a turn of its own with its own usage; the parked one is over, not running
  engine.resume("tsk_h", { approved: false });
  await engine.idle("T");
  assert.deepEqual(engine.turns("T").map((t) => t.state), ["completed", "completed"]);
  assert.notEqual(engine.turns("T")[0]?.endedAt, null);
  assert.equal(engine.turns("T").filter((t) => t.state === "running" || t.state === "waiting").length, 0, "no turn is left running or waiting");
  assert.deepEqual(metered.map((m) => m.tokens), [150, 7], "the wake adds its own usage under its own turn");
  assert.notEqual(metered[0]!.id, metered[1]!.id);
});

test("text that comes after a tool step is a new paragraph: A, a tool, B reads A then a blank line then B", async () => {
  const p = scriptedProvider({ script: (input) => (input.resumed ? [] : [{ type: "text", text: "A." }, { type: "tool_call", id: "c1", name: "records_get", input: {} }, { type: "text", text: "B." }, { type: "done" }]) });
  const runner = toolRunnerFrom(async () => ({ kind: "result", result: { ok: true, content: {} } }));
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, callTool: runner });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "go" });
  await engine.idle("T");
  assert.equal(engine.messages("T").filter((m) => m.author.kind === "agent").at(-1)?.body, "A.\n\nB.");
  // text that already ends or begins with whitespace is left as it is
  const p2 = scriptedProvider({ script: [{ type: "text", text: "A.\n" }, { type: "tool_call", id: "c2", name: "records_get", input: {} }, { type: "text", text: "B." }, { type: "done" }] });
  const e2 = createTurnEngine({ holder: "host:s", openSession: p2.openSession, callTool: runner });
  e2.openThread(thread());
  e2.receive({ threadId: "T", author: person, body: "go" });
  await e2.idle("T");
  assert.equal(e2.messages("T").filter((m) => m.author.kind === "agent").at(-1)?.body, "A.\nB.");
});

test("the tool runner is told what the people said since the agent last spoke, and nothing from before its last message", async () => {
  const seen: string[] = [];
  const p = scriptedProvider({ script: [{ type: "tool_call", id: "c1", name: "records_get", input: {} }, { type: "text", text: "Done." }, { type: "done" }] });
  const runner = toolRunnerFrom(async (_c) => ({ kind: "result", result: { ok: true, content: {} } }));
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, callTool: async (c, ctx) => { seen.push(ctx.said ?? ""); return runner(c, ctx); } });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "make a lead called test" });
  await engine.idle("T");
  assert.equal(seen[0], "make a lead called test");
  engine.receive({ threadId: "T", author: person, body: "and another one called demo" });
  await engine.idle("T");
  assert.equal(seen.at(-1), "and another one called demo", "words from before the agent's last message are not counted");
});
