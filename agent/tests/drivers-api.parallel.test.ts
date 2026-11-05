// Parallel tool calls pass through every API adapter: the request allows them where the provider has a switch, the decoder yields every call of a step, and the results of one step go back together.
import test from "node:test";
import assert from "node:assert/strict";
import { anthropic } from "../src/drivers/api/anthropic.ts";
import { google } from "../src/drivers/api/google.ts";
import { custom, local, openai, openrouter, opencodeGo, xai } from "../src/drivers/api/openai.ts";
import type { CallRequest, Decoded, ProviderAdapter } from "../src/drivers/api/types.ts";

const tool = { name: "calendar_list_events", description: "d", inputSchema: { type: "object", properties: {} } };
const req = (extra: Partial<CallRequest> = {}): CallRequest => ({ model: "m", system: [{ text: "s", stable: true }], tools: [tool], messages: [{ role: "user", text: "hi" }], maxOutputTokens: 100, prefixHash: "h", ...extra }) as CallRequest;
const body = (a: ProviderAdapter, r: CallRequest = req()): Record<string, unknown> => a.request(r).body as Record<string, unknown>;
const events = (a: ProviderAdapter, datas: string[]): Decoded[] => { const d = a.decoder(); return datas.flatMap((x) => d.push({ data: x } as never)).concat(d.end?.() ?? []); };

test("OpenAI, OpenRouter, xAI and OpenCode Go are told parallel_tool_calls is on; a local or custom server is not sent the switch", () => {
  for (const a of [openai, openrouter, xai, opencodeGo]) assert.equal(body(a)["parallel_tool_calls"], true, a.id);
  for (const a of [local, custom]) assert.equal(body(a)["parallel_tool_calls"], undefined, a.id);
  assert.equal(body(openai, req({ tools: [] }))["parallel_tool_calls"], undefined, "no tools, no switch");
});

test("Anthropic is told not to disable parallel tool use", () => {
  assert.deepEqual(body(anthropic)["tool_choice"], { type: "auto", disable_parallel_tool_use: false });
  assert.equal(body(anthropic, req({ tools: [] }))["tool_choice"], undefined);
});

test("every decoder yields all the calls of one step", () => {
  const oa = events(openai, [
    JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "calendar_list_events", arguments: "{}" } }, { index: 1, id: "b", function: { name: "inbox_counts", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }),
    "[DONE]",
  ]).filter((d) => d.type === "tool_call");
  assert.deepEqual(oa.map((d) => (d as { call: { id: string } }).call.id), ["a", "b"]);
  const gem = events(google, [JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "calendar_list_events", args: {} } }, { functionCall: { name: "inbox_counts", args: {} } }] }, finishReason: "STOP" }] })]).filter((d) => d.type === "tool_call");
  assert.equal(gem.length, 2);
  const an = events(anthropic, [
    JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "calendar_list_events" } }), JSON.stringify({ type: "content_block_stop", index: 0 }),
    JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t2", name: "inbox_counts" } }), JSON.stringify({ type: "content_block_stop", index: 1 }),
    JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" } }),
  ]).filter((d) => d.type === "tool_call");
  assert.deepEqual(an.map((d) => (d as { call: { id: string } }).call.id), ["t1", "t2"]);
});

test("the results of one step go back together: Anthropic in one user message, Gemini in one content, OpenAI as one tool message each", () => {
  const msgs = [
    { role: "user", text: "q" },
    { role: "assistant", text: "", calls: [{ id: "a", name: "x", input: {} }, { id: "b", name: "y", input: {} }] },
    { role: "tool", callId: "a", name: "x", ok: true, content: "1" }, { role: "tool", callId: "b", name: "y", ok: true, content: "2" },
  ] as never;
  const an = (body(anthropic, req({ messages: msgs }))["messages"] as { role: string; content: unknown[] }[]);
  assert.deepEqual(an.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(an[2]!.content.length, 2);
  const gm = (body(google, req({ messages: msgs }))["contents"] as { role: string; parts: unknown[] }[]);
  assert.equal(gm.at(-1)!.parts.length, 2);
  const oa = (body(openai, req({ messages: msgs }))["messages"] as { role: string }[]);
  assert.equal(oa.filter((m) => m.role === "tool").length, 2);
});
