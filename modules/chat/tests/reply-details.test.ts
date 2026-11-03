// chat.reply_details: how one agent reply was made. The turn and what the agent knew are asked as the caller (engine.turn.of_message, memory.used), so their own audience rules apply;
// with no recorded turn the reply's own saved steps are what is left; a person's message has no details; a chat you cannot open does not exist for you.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, MAYA, contractErrors, harness } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = (): string => `rd-${++n}`;

const TURN = {
  turnId: "trn_r1", traceId: "0123456789abcdef0123456789abcdef", agentId: INTAKE, asker: DANA, model: "claude-opus-5-5", engine: "claude_code", state: "completed",
  ranOn: [{ kind: "computer", name: "Dana's MacBook" }], timing: { startedAt: 1, endedAt: 2 }, tokens: { in: 10, out: 2 },
  tools: [], files: { read: [], written: [] }, skills: [], switches: [], private: false, partial: false,
};

async function chatWithReply(calls: Record<string, (input: Record<string, unknown>) => unknown>) {
  const hn = harness({ calls: { "agents.get": () => ({ agent: {} }), ...calls } });
  const thread = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  const asked = (await h["chat.post"]!(hn.ctx, { threadId: thread, body: "Read the brief", idempotencyKey: key() })).message.messageId as string;
  const reply = (await h["chat.post"]!(hn.agent(INTAKE, DANA), {
    threadId: thread, body: "Three teammates on this.", idempotencyKey: key(),
    blocks: [{ type: "tool_call", v: 1, data: { id: "c1", name: "Read" } }, { type: "tool_result", v: 1, data: { id: "c1", name: "Read", ok: true, secs: 2 } }],
  })).message.messageId as string;
  return { hn, thread, asked, reply };
}

test("the reply's details carry its turn and what the agent knew, both asked as the caller", async () => {
  const { hn, thread, reply } = await chatWithReply({
    "engine.turn.of_message": () => ({ turn: TURN }),
    "memory.used": () => ({ messageId: "msg_x", facts: [{ factId: "fct_1", text: "Files live in one folder per client", sourceTitle: "Portal plan", layer: "project" }], quotes: [] }),
  });
  const out = await h["chat.reply_details"]!(hn.ctx, { threadId: thread, messageId: reply });
  assert.deepEqual(contractErrors("chat.reply_details", "out", out), []);
  const { details } = out;
  assert.equal(details.messageId, reply);
  assert.equal(details.agentId, INTAKE);
  assert.equal(details.turn.model, "claude-opus-5-5");
  assert.deepEqual(details.memory, { facts: [{ factId: "fct_1", text: "Files live in one folder per client", sourceTitle: "Portal plan" }], quotes: [] });
  assert.deepEqual(details.steps, [{ name: "Read", ok: true, secs: 2 }]);
  const asked = hn.callLog.filter((c) => c.cap === "engine.turn.of_message" || c.cap === "memory.used").map((c) => [c.cap, c.input["threadId"], c.input["messageId"]]);
  assert.deepEqual(asked, [["engine.turn.of_message", thread, reply], ["memory.used", thread, reply]]);
});

test("with no recorded turn the reply's own steps remain, and nothing is invented", async () => {
  const notFound = () => { throw { error: { code: "validation.not_found" } }; };
  const { hn, thread, reply } = await chatWithReply({ "engine.turn.of_message": notFound, "memory.used": notFound });
  const out = await h["chat.reply_details"]!(hn.ctx, { threadId: thread, messageId: reply });
  assert.deepEqual(contractErrors("chat.reply_details", "out", out), []);
  const { details } = out;
  assert.equal(details.turn, undefined);
  assert.equal(details.memory, undefined);
  assert.deepEqual(details.steps, [{ name: "Read", ok: true, secs: 2 }]);
});

test("a person's message has no details, and a chat the caller cannot open does not exist for them", async () => {
  const { hn, thread, asked, reply } = await chatWithReply({ "engine.turn.of_message": () => ({ turn: TURN }), "memory.used": () => ({ facts: [], quotes: [] }) });
  await assert.rejects(h["chat.reply_details"]!(hn.ctx, { threadId: thread, messageId: asked }), (e: any) => e?.error?.code === "validation.bad_input");
  await assert.rejects(h["chat.reply_details"]!(hn.person(MAYA), { threadId: thread, messageId: reply }), (e: any) => e?.error?.code === "validation.not_found");
});
