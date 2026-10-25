// Prefix cache and request shape (ARCH 6.6): the stable system blocks and the sorted tool list are hashed and marked so a resumed chat's first token reads the provider's cache;
// compaction at 80% of the window keeps the prompt inside it.
import test from "node:test";
import assert from "node:assert/strict";
import { ADAPTERS, COMPACT_AT, compact, createApiDriver, createPrefixTracker, geminiSchema, prefixHash, sortTools } from "../src/drivers/api/index.ts";
import type { ApiTool, Msg, ProviderId, SystemBlock } from "../src/drivers/api/index.ts";
import { MODELS, WIRE, authorize, chunked, ctx, fakeClock, fakeFetch, fixture, msg, spec, turnInput } from "../src/drivers/api/testing.ts";
import { fixedTokens, msgTokens } from "../src/drivers/api/messages.ts";
import type { DriverEvent } from "../src/turn-engine/types.ts";

const tools: ApiTool[] = ctx().tools;
const sys: SystemBlock[] = ctx().system;

async function once(provider: ProviderId, over: Partial<ReturnType<typeof ctx>> = {}) {
  const f = fakeFetch(() => ({ chunks: chunked(fixture(`${WIRE[provider]}-text`), 64) }));
  const driver = createApiDriver(ADAPTERS[provider], { authorize, context: () => ctx(over), fetch: f.fetch, clock: fakeClock() });
  const session = await driver.open(spec(MODELS[provider]));
  const run = async (): Promise<DriverEvent[]> => { const out: DriverEvent[] = []; for await (const e of session.send(turnInput(MODELS[provider]))) out.push(e); return out; };
  return { f, session, run };
}

test("prefixHash: same for any tool order and any volatile text, different when the stable prefix, a tool or the model changes", () => {
  const h = prefixHash(sys, tools, "m");
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(prefixHash(sys, [...tools].reverse(), "m"), h);
  assert.equal(prefixHash(sys.map((b) => (b.stable ? b : { ...b, text: "Today is Sunday." })), tools, "m"), h);
  assert.notEqual(prefixHash(sys.map((b, i) => (i === 0 ? { ...b, text: b.text + "!" } : b)), tools, "m"), h);
  assert.notEqual(prefixHash(sys, tools.map((t, i) => (i === 0 ? { ...t, description: "changed" } : t)), "m"), h);
  assert.notEqual(prefixHash(sys, tools.slice(1), "m"), h);
  assert.notEqual(prefixHash(sys, tools, "other"), h);
  assert.deepEqual(sortTools(tools).map((t) => t.name), ["chat_post", "records_list"]);
});

test("anthropic: the cache marker sits on the last stable block and on the last tool; volatile text comes after it", async () => {
  const { f, run } = await once("anthropic");
  await run();
  const body = f.requests[0]?.body as any;
  assert.deepEqual(body.system.map((b: any) => b.text), ["You are Intake, an agent in this Space.", "VYRE.md: the guide.", "Today is Saturday."]);
  assert.deepEqual(body.system.map((b: any) => Boolean(b.cache_control)), [false, true, false]);
  assert.deepEqual(body.tools.map((t: any) => t.name), ["chat_post", "records_list"]);
  assert.deepEqual(body.tools.map((t: any) => Boolean(t.cache_control)), [false, true]);
  assert.equal(body.stream, true);
  assert.equal(body.model, "claude-sonnet-5-5");
  assert.equal(body.max_tokens, 16_384);
  assert.equal(f.requests[0]?.url, "https://api.anthropic.com/v1/messages");
  assert.equal(f.requests[0]?.headers["x-api-key"], "sk-test-0123456789abcdef");
  assert.equal(f.requests[0]?.headers["anthropic-version"], "2023-06-01");
});

test("openai: the prefix hash is the prompt cache key; xai and openrouter do not send one", async () => {
  const o = await once("openai");
  await o.run();
  const ob = o.f.requests[0]?.body as any;
  assert.equal(ob.prompt_cache_key, prefixHash(sys, tools, "gpt-5"));
  assert.equal(ob.max_completion_tokens, 16_384);
  assert.equal(ob.max_tokens, undefined);
  assert.deepEqual(ob.stream_options, { include_usage: true });
  assert.equal(ob.messages[0].role, "system");
  assert.equal(ob.messages[0].content, "You are Intake, an agent in this Space.\n\nVYRE.md: the guide.\n\nToday is Saturday.");
  assert.deepEqual(ob.tools.map((t: any) => t.function.name), ["chat_post", "records_list"]);
  assert.equal(o.f.requests[0]?.headers["authorization"], "Bearer sk-test-0123456789abcdef");

  const x = await once("xai");
  await x.run();
  const xb = x.f.requests[0]?.body as any;
  assert.equal(xb.prompt_cache_key, undefined);
  assert.equal(xb.max_tokens, 16_384);
  assert.equal(x.f.requests[0]?.url, "https://api.x.ai/v1/chat/completions");
});

test("openrouter: an Anthropic model gets the cache marker on the stable prefix, asks for usage and refuses data collection", async () => {
  const r = await once("openrouter");
  await r.run();
  const b = r.f.requests[0]?.body as any;
  assert.equal(b.model, "anthropic/claude-sonnet-5-5");
  assert.deepEqual(b.messages[0].content.map((p: any) => Boolean(p.cache_control)), [false, true, false]);
  assert.deepEqual(b.usage, { include: true });
  assert.deepEqual(b.provider, { data_collection: "deny" });
  assert.equal(r.f.requests[0]?.url, "https://openrouter.ai/api/v1/chat/completions");
});

test("google: system instruction, sorted function declarations without keywords Gemini refuses, the key in a header", async () => {
  const { f, run } = await once("google");
  await run();
  const req = f.requests[0];
  assert.equal(req?.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse");
  assert.equal(req?.headers["x-goog-api-key"], "sk-test-0123456789abcdef");
  const b = req?.body as any;
  assert.equal(b.systemInstruction.parts[0].text, "You are Intake, an agent in this Space.\n\nVYRE.md: the guide.\n\nToday is Saturday.");
  assert.deepEqual(b.tools[0].functionDeclarations.map((d: any) => d.name), ["chat_post", "records_list"]);
  assert.equal(JSON.stringify(b.tools).includes("additionalProperties"), false);
  assert.deepEqual(geminiSchema({ $schema: "x", type: "object", additionalProperties: false, properties: { a: { type: "string", additionalProperties: true } } }), { type: "object", properties: { a: { type: "string" } } });
  assert.equal(b.generationConfig.maxOutputTokens, 16_384);
});

test("a session notes whether each call's prefix matched the last, and counts the tokens the provider read from cache", async () => {
  const a = await once("anthropic");
  await a.run();
  await a.run();
  const s = a.session.stats();
  assert.equal(s.calls, 2);
  assert.equal(s.prefix.expectedMisses, 1, "the first call writes the prefix");
  assert.equal(s.prefix.expectedHits, 1, "the resumed chat's second call reads it");
  assert.equal(s.prefix.cacheReadTokens, 2000, "1000 tokens read from cache per call, as the provider reported");
  assert.equal(s.prefix.lastHash, prefixHash(sys, tools, "claude-sonnet-5-5"));

  // The same chat after an edit to the guide: a miss, and the hash moves.
  const t = createPrefixTracker();
  assert.equal(t.note("a"), false);
  assert.equal(t.note("a"), true);
  assert.equal(t.note("b"), false);
  assert.deepEqual([t.stats().expectedHits, t.stats().expectedMisses], [1, 2]);
});

test("the wire request is identical across sends when only the thread grows: the prefix bytes do not move", async () => {
  const f = fakeFetch(() => ({ chunks: chunked(fixture("anthropic-text"), 64) }));
  const driver = createApiDriver(ADAPTERS.anthropic, { authorize, context: () => ctx(), fetch: f.fetch, clock: fakeClock() });
  const session = await driver.open(spec(MODELS.anthropic));
  for await (const _ of session.send(turnInput(MODELS.anthropic, [msg(1, "dana", "first")]))) void _;
  for await (const _ of session.send(turnInput(MODELS.anthropic, [msg(1, "dana", "first"), msg(2, "intake", "reply", "agent"), msg(3, "dana", "second")]))) void _;
  const [a, b] = f.requests.map((r) => r.body as any);
  assert.equal(JSON.stringify(a.system), JSON.stringify(b.system));
  assert.equal(JSON.stringify(a.tools), JSON.stringify(b.tools));
});

const big = (n: number, role: "user" | "assistant" = "user"): Msg =>
  role === "user" ? { role: "user", text: "x".repeat(n) } : { role: "assistant", text: "y".repeat(n), calls: [] };

test("compaction: under 80% of the window nothing changes", async () => {
  const messages: Msg[] = [big(4_000), big(4_000, "assistant"), big(4_000)];
  const out = await compact(fixedTokens(sys, tools), messages, 100_000);
  assert.equal(out.dropped, 0);
  assert.deepEqual(out.messages, messages);
});

test("compaction: over 80% the oldest messages become one summary, the newest stay, the cut falls on a user message", async () => {
  const window = 10_000;
  const messages: Msg[] = [];
  for (let i = 0; i < 12; i++) { messages.push(big(3_200)); messages.push(big(3_200, "assistant")); }
  messages.push(big(400));
  let given: readonly Msg[] = [];
  const out = await compact(fixedTokens(sys, tools), messages, window, async (dropped) => { given = dropped; return "SUMMARY OF EARLIER"; });
  assert.ok(out.dropped > 0 && out.dropped < messages.length);
  assert.equal(given.length, out.dropped);
  assert.equal(out.messages[0]?.role, "user");
  assert.match((out.messages[0] as { text: string }).text, /^Earlier in this conversation .*\nSUMMARY OF EARLIER$/s);
  assert.deepEqual(out.messages.at(-1), messages.at(-1), "the newest message is untouched");
  const total = fixedTokens(sys, tools) + out.messages.reduce((n, m) => n + msgTokens(m), 0);
  assert.ok(total <= window * COMPACT_AT, `compacted prompt is ${total} tokens, over ${window * COMPACT_AT}`);
});

test("compaction never separates a tool call from its results and falls back to a plain extract when the summarizer fails", async () => {
  const call = { id: "c1", name: "records_list", input: {} };
  const messages: Msg[] = [
    big(24_000), { role: "assistant", text: "", calls: [call] }, { role: "tool", callId: "c1", name: "records_list", content: "z".repeat(24_000), ok: true },
    big(24_000, "assistant"), big(200), { role: "assistant", text: "", calls: [{ ...call, id: "c2" }] },
    { role: "tool", callId: "c2", name: "records_list", content: "ok", ok: true },
  ];
  const out = await compact(fixedTokens(sys, tools), messages, 20_000, async () => { throw new Error("no model"); });
  assert.ok(out.dropped > 0);
  const first = out.messages[1];
  assert.ok(first, "something follows the summary");
  assert.notEqual(first.role, "tool", "a result is never left without its call");
  assert.match((out.messages[0] as { text: string }).text, /Asked: x+/);
  for (const [i, m] of out.messages.entries()) if (m.role === "tool") assert.equal(out.messages[i - 1]?.role === "assistant" || out.messages[i - 1]?.role === "tool", true);
});

test("a long thread is compacted inside a send, and the request that goes out fits the window", async () => {
  const history = Array.from({ length: 40 }, (_, i) => msg(i + 1, i % 2 === 0 ? "dana" : "intake", "w".repeat(20_000), i % 2 === 0 ? "person" : "agent"));
  history.push(msg(41, "dana", "Now what?"));
  const f = fakeFetch(() => ({ chunks: chunked(fixture("anthropic-text"), 64) }));
  const driver = createApiDriver(ADAPTERS.anthropic, { authorize, context: () => ctx(), fetch: f.fetch, clock: fakeClock(), summarize: async () => "short summary" });
  const session = await driver.open(spec(MODELS.anthropic));
  const events: DriverEvent[] = [];
  for await (const e of session.send(turnInput(MODELS.anthropic, history))) events.push(e);
  assert.equal(session.stats().compactions, 1);
  const msgs = (f.requests[0]?.body as any).messages as any[];
  assert.ok(msgs.length < 41);
  assert.match(msgs[0].content[0].text, /short summary/);
  assert.equal(msgs.at(-1).content[0].text.endsWith("Now what?"), true);
  assert.equal(events.at(-1)?.type, "done");
});
