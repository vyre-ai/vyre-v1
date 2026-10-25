// The API drivers' own tool loop (ARCH 6.2, 6.6): the model asks, the engine runs the tool and calls sendToolResult, the model is called again with the result in the provider's format.
// Steering, parallel calls, a call held at the Gate, cancel while waiting, the step limit, a resumed turn.
import test from "node:test";
import assert from "node:assert/strict";
import { ADAPTERS, createApiDriver } from "../src/drivers/api/index.ts";
import type { ProviderId } from "../src/drivers/api/index.ts";
import { MODELS, WIRE, authorize, chunked, ctx, fakeClock, fakeFetch, fixture, gate, msg, spec, turnInput } from "../src/drivers/api/testing.ts";
import type { DriverEvent, ToolResult } from "../src/turn-engine/types.ts";

const PROVIDERS: ProviderId[] = ["anthropic", "openai", "openrouter", "google", "xai"];
const sse = (name: string, provider: ProviderId): string => fixture(name, { crlf: provider === "google" });

function open(provider: ProviderId, handler: Parameters<typeof fakeFetch>[0], extra: { maxSteps?: number } = {}) {
  const f = fakeFetch(handler);
  const driver = createApiDriver(ADAPTERS[provider], { authorize, context: () => ctx(), fetch: f.fetch, clock: fakeClock(), ...extra });
  return { f, session: driver.open(spec(MODELS[provider])) };
}

/** Drive a send like the engine does: run each tool call through `answer` and hand the result back. */
async function drive(
  it: AsyncIterator<DriverEvent>,
  answer: (ev: Extract<DriverEvent, { type: "tool_call" }>) => ToolResult,
  give: (id: string, r: ToolResult) => void,
  onEvent: (ev: DriverEvent) => void = () => {},
): Promise<DriverEvent[]> {
  const out: DriverEvent[] = [];
  for (;;) {
    const r = await it.next();
    if (r.done) return out;
    out.push(r.value);
    onEvent(r.value);
    if (r.value.type === "tool_call") give(r.value.id, answer(r.value));
  }
}

const LEADS: ToolResult = { ok: true, content: [{ id: "l1" }, { id: "l2" }, { id: "l3" }] };

for (const provider of PROVIDERS) {
  test(`${provider}: tool call, result, second call, answer`, async () => {
    const w = WIRE[provider];
    const { f, session: opened } = open(provider, (_r, n) => ({ chunks: chunked(sse(n === 0 ? `${w}-tool` : `${w}-tool-answer`, provider), 23) }));
    const session = await opened;
    const events = await drive(session.send(turnInput(MODELS[provider]))[Symbol.asyncIterator](), () => LEADS, (id, r) => session.sendToolResult(id, r));

    const call = events.find((e) => e.type === "tool_call");
    assert.ok(call && call.type === "tool_call");
    assert.equal(call.name, "records_list");
    assert.deepEqual(call.input, { type: "lead", limit: 3 });
    assert.equal(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join(""), "Let me look.Found 3 leads.");
    assert.deepEqual(events.filter((e) => e.type === "usage"), [
      { type: "usage", inputTokens: 900, outputTokens: 40 },
      { type: "usage", inputTokens: 1050, outputTokens: 6 },
    ], "usage is reported once per provider call, input counted with cached tokens");
    assert.equal(events[events.length - 1]?.type, "done");
    assert.equal(events.filter((e) => e.type === "done").length, 1);
    assert.equal(f.requests.length, 2);

    // The second request carries the assistant's call and the tool's result in this provider's format.
    const body = f.requests[1]?.body as any;
    if (w === "anthropic") {
      const msgs = body.messages as any[];
      const asst = msgs[msgs.length - 2];
      assert.equal(asst.role, "assistant");
      assert.deepEqual(asst.content.find((b: any) => b.type === "tool_use"), { type: "tool_use", id: "toolu_01A", name: "records_list", input: { type: "lead", limit: 3 } });
      const res = msgs[msgs.length - 1];
      assert.equal(res.role, "user");
      assert.equal(res.content[0].type, "tool_result");
      assert.equal(res.content[0].tool_use_id, "toolu_01A");
      assert.equal(res.content[0].content, JSON.stringify(LEADS.content));
    } else if (w === "openai") {
      const msgs = body.messages as any[];
      const asst = msgs[msgs.length - 2];
      assert.equal(asst.role, "assistant");
      assert.deepEqual(asst.tool_calls, [{ id: "call_abc", type: "function", function: { name: "records_list", arguments: JSON.stringify({ type: "lead", limit: 3 }) } }]);
      assert.deepEqual(msgs[msgs.length - 1], { role: "tool", tool_call_id: "call_abc", content: JSON.stringify(LEADS.content) });
    } else {
      const contents = body.contents as any[];
      const asst = contents[contents.length - 2];
      assert.equal(asst.role, "model");
      assert.deepEqual(asst.parts.find((p: any) => p.functionCall), { functionCall: { name: "records_list", args: { type: "lead", limit: 3 } } });
      const res = contents[contents.length - 1];
      assert.equal(res.role, "user");
      assert.deepEqual(res.parts[0], { functionResponse: { name: "records_list", response: { result: JSON.stringify(LEADS.content) } } });
    }
  });
}

test("anthropic: thinking streams as thinking events and is not sent back as text", async () => {
  const { f, session: opened } = open("anthropic", (_r, n) => ({ chunks: chunked(fixture(n === 0 ? "anthropic-tool" : "anthropic-tool-answer"), 31) }));
  const session = await opened;
  const events = await drive(session.send(turnInput(MODELS.anthropic))[Symbol.asyncIterator](), () => LEADS, (id, r) => session.sendToolResult(id, r));
  assert.deepEqual(events.filter((e) => e.type === "thinking"), [{ type: "thinking", text: "I should list the leads." }]);
  const asst = (f.requests[1]?.body as any).messages.at(-2);
  assert.equal(asst.content.some((b: any) => b.type === "thinking"), false);
});

test("a failed tool result goes back as an error the model can read", async () => {
  const { f, session: opened } = open("anthropic", (_r, n) => ({ chunks: chunked(fixture(n === 0 ? "anthropic-tool" : "anthropic-tool-answer"), 64) }));
  const session = await opened;
  await drive(session.send(turnInput(MODELS.anthropic))[Symbol.asyncIterator](), () => ({ ok: false, content: "no access to leads" }), (id, r) => session.sendToolResult(id, r));
  const res = (f.requests[1]?.body as any).messages.at(-1).content[0];
  assert.equal(res.is_error, true);
  assert.equal(res.content, "no access to leads");
});

test("parallel calls: both are yielded, both results go back together, in call order", async () => {
  const two = [
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"records_list","arguments":""}},{"index":1,"id":"c2","type":"function","function":{"name":"chat_post","arguments":""}}]}}]}',
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"function":{"arguments":"{\\"text\\":\\"hi\\"}"}}]}}]}',
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"type\\":\\"lead\\"}"}}]}}]}',
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
    "data: [DONE]",
  ].join("\n\n") + "\n\n";
  const { f, session: opened } = open("openai", (_r, n) => ({ chunks: chunked(n === 0 ? two : fixture("openai-tool-answer"), 50) }));
  const session = await opened;
  const events = await drive(session.send(turnInput(MODELS.openai))[Symbol.asyncIterator](), (e) => ({ ok: true, content: `done ${e.name}` }), (id, r) => session.sendToolResult(id, r));
  const calls = events.filter((e) => e.type === "tool_call");
  assert.deepEqual(calls.map((c) => (c as { name: string }).name), ["records_list", "chat_post"]);
  const msgs = (f.requests[1]?.body as any).messages as any[];
  assert.deepEqual(msgs.slice(-3).map((m) => m.role), ["assistant", "tool", "tool"]);
  assert.deepEqual(msgs.slice(-2).map((m) => m.tool_call_id), ["c1", "c2"]);
  assert.equal(msgs.at(-3).tool_calls.length, 2);
});

test("anthropic: two tool results travel in one user message", async () => {
  // Two tool_use blocks in one assistant message, built by hand from the fixture's pieces.
  const twoBlocks = fixture("anthropic-tool").replace(
    'event: message_delta',
    'event: content_block_start\ndata: {"type":"content_block_start","index":3,"content_block":{"type":"tool_use","id":"toolu_01B","name":"chat_post","input":{}}}\n\n'
    + 'event: content_block_delta\ndata: {"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"{\\"text\\":\\"hi\\"}"}}\n\n'
    + 'event: content_block_stop\ndata: {"type":"content_block_stop","index":3}\n\nevent: message_delta',
  );
  const { f, session: opened } = open("anthropic", (_r, n) => ({ chunks: chunked(n === 0 ? twoBlocks : fixture("anthropic-tool-answer"), 40) }));
  const session = await opened;
  const events = await drive(session.send(turnInput(MODELS.anthropic))[Symbol.asyncIterator](), (e) => ({ ok: true, content: `done ${e.name}` }), (id, r) => session.sendToolResult(id, r));
  assert.equal(events.filter((e) => e.type === "tool_call").length, 2);
  const last = (f.requests[1]?.body as any).messages.at(-1);
  assert.equal(last.role, "user");
  assert.deepEqual(last.content.map((b: any) => b.tool_use_id), ["toolu_01A", "toolu_01B"]);
});

test("steering: a message injected while a tool runs joins the next call", async () => {
  const { f, session: opened } = open("openai", (_r, n) => ({ chunks: chunked(fixture(n === 0 ? "openai-tool" : "openai-tool-answer"), 64) }));
  const session = await opened;
  const events = await drive(
    session.send(turnInput(MODELS.openai))[Symbol.asyncIterator](),
    () => LEADS,
    (id, r) => { session.inject(msg(2, "dana", "Only hot leads please")); session.sendToolResult(id, r); },
  );
  assert.equal(events.at(-1)?.type, "done");
  const msgs = (f.requests[1]?.body as any).messages as any[];
  assert.deepEqual(msgs.at(-1), { role: "user", content: "Only hot leads please" });
  assert.equal(msgs.at(-2).role, "tool", "the steering message comes after the results of the step it interrupted");
});

test("steering: a message injected during the last reply earns another reply, not a dropped message", async () => {
  const { f, session: opened } = open("openai", (_r, n) => ({ chunks: chunked(fixture(n === 0 ? "openai-text" : "openai-tool-answer"), 64) }));
  const session = await opened;
  let injected = false;
  const events = await drive(session.send(turnInput(MODELS.openai))[Symbol.asyncIterator](), () => LEADS, (id, r) => session.sendToolResult(id, r), (e) => {
    if (e.type === "text" && !injected) { injected = true; session.inject(msg(2, "dana", "and the cold ones?")); }
  });
  assert.equal(f.requests.length, 2);
  assert.equal(events.filter((e) => e.type === "done").length, 1);
  const msgs = (f.requests[1]?.body as any).messages as any[];
  assert.deepEqual(msgs.slice(-2).map((m) => m.role), ["assistant", "user"]);
  assert.equal(msgs.at(-1).content, "and the cold ones?");
});

test("held at the Gate: the consumer stops reading, no second call is made and the request is released", async () => {
  const { f, session: opened } = open("anthropic", () => ({ chunks: chunked(fixture("anthropic-tool"), 64) }));
  const session = await opened;
  const it = session.send(turnInput(MODELS.anthropic))[Symbol.asyncIterator]();
  for (;;) {
    const r = await it.next();
    assert.equal(r.done, false);
    if (!r.done && r.value.type === "tool_call") break;
  }
  await it.return?.();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0]?.signal.aborted, true);
  assert.equal(session.stats().calls, 1);
});

test("cancel while waiting for a tool result ends the send without an error and without another call", async () => {
  const { f, session: opened } = open("openai", () => ({ chunks: chunked(fixture("openai-tool"), 64) }));
  const session = await opened;
  const it = session.send(turnInput(MODELS.openai))[Symbol.asyncIterator]();
  for (;;) {
    const r = await it.next();
    assert.equal(r.done, false);
    if (!r.done && r.value.type === "tool_call") break;
  }
  const pending = it.next();
  await session.cancel();
  const end = await Promise.race([pending, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("cancel did not release the wait")), 2_000))]);
  assert.equal(end.done, true);
  assert.equal(f.requests.length, 1);
});

test("a model that keeps calling tools is stopped at the step limit with a named error", async () => {
  const { f, session: opened } = open("openai", () => ({ chunks: chunked(fixture("openai-tool"), 128) }), { maxSteps: 3 });
  const session = await opened;
  const events = await drive(session.send(turnInput(MODELS.openai))[Symbol.asyncIterator](), () => LEADS, (id, r) => session.sendToolResult(id, r));
  assert.equal(f.requests.length, 3);
  const last = events.at(-1);
  assert.ok(last && last.type === "error");
  assert.equal(last.code, "engine.step_limit");
});

test("the thread is the prompt: own replies are assistant turns, other voices are named user turns, the conversation opens and ends with the user", async () => {
  const history = [
    msg(1, "dana", "Who are my newest leads?"),
    msg(2, "intake", "Three: A, B, C.", "agent"),
    msg(3, "ravi", "Add D too."),
    msg(4, "docs", "I can draft the intake letters.", "agent"),
    msg(5, "dana", "@intake go ahead"),
  ];
  const { f, session: opened } = open("anthropic", () => ({ chunks: chunked(fixture("anthropic-text"), 64) }));
  const session = await opened;
  await drive(session.send(turnInput(MODELS.anthropic, history))[Symbol.asyncIterator](), () => LEADS, (id, r) => session.sendToolResult(id, r));
  const msgs = (f.requests[0]?.body as any).messages as any[];
  assert.deepEqual(msgs.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(msgs[0].content[0].text, "dana: Who are my newest leads?");
  assert.equal(msgs[1].content[0].text, "Three: A, B, C.");
  assert.equal(msgs[2].content[0].text, "ravi: Add D too.\n\ndocs: I can draft the intake letters.\n\ndana: @intake go ahead");
});

test("a resumed turn tells the model how the held tool call was answered", async () => {
  const { f, session: opened } = open("openai", () => ({ chunks: chunked(fixture("openai-text"), 64) }));
  const session = await opened;
  const input = turnInput(MODELS.openai, [msg(1, "dana", "Send the letter."), msg(2, "intake", "Waiting for approval.", "agent")], {
    resumed: { taskId: "task1", callId: "call_x", toolName: "email_send", approved: true, result: { ok: true, content: "sent" } },
  });
  await drive(session.send(input)[Symbol.asyncIterator](), () => LEADS, (id, r) => session.sendToolResult(id, r));
  const last = (f.requests[0]?.body as any).messages.at(-1);
  assert.equal(last.role, "user");
  assert.match(last.content, /email_send was approved; result: sent/);
});

test("close ends a send that is waiting on the provider", async () => {
  const g = gate();
  const { session: opened } = open("openai", () => ({ body: g.body }));
  const session = await opened;
  const it = session.send(turnInput(MODELS.openai))[Symbol.asyncIterator]();
  const first = it.next();
  await session.close();
  const r = await Promise.race([first, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("close did not end the send")), 2_000))]);
  assert.equal(r.done, true);
});
