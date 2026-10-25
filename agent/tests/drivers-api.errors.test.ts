// Failures (ARCH 6.4, 6.6; spec 4.14, golden 10): provider errors become the codes the accounts module falls back on, transient ones are retried with backoff before the first byte,
// nothing is replayed after a byte was streamed, and a key never appears in an error.
import test from "node:test";
import assert from "node:assert/strict";
import { ADAPTERS, DriverError, createApiDriver } from "../src/drivers/api/index.ts";
import type { ApiDriverDeps } from "../src/drivers/api/index.ts";
import { KEY, MODELS, authorize, chunked, ctx, fakeClock, fakeFetch, fixture, gate, spec, turnInput } from "../src/drivers/api/testing.ts";
import type { Script } from "../src/drivers/api/testing.ts";
import type { DriverEvent } from "../src/turn-engine/types.ts";

const OK = (): Script => ({ chunks: chunked(fixture("openai-text"), 64) });

async function run(handler: Parameters<typeof fakeFetch>[0], extra: Partial<ApiDriverDeps> = {}, provider: "openai" | "anthropic" = "openai") {
  const f = fakeFetch(handler);
  const clock = fakeClock();
  const driver = createApiDriver(ADAPTERS[provider], { authorize, context: () => ctx(), fetch: f.fetch, clock, random: () => 1, ...extra });
  const session = await driver.open(spec(MODELS[provider]));
  const events: DriverEvent[] = [];
  for await (const e of session.send(turnInput(MODELS[provider]))) events.push(e);
  return { events, f, clock, session };
}

const errorOf = (events: DriverEvent[]): { code: string; message: string } => {
  const e = events.find((x) => x.type === "error");
  assert.ok(e && e.type === "error", "an error event");
  return e;
};

test("401 and 403 are provider.auth_failed and are not retried", async () => {
  for (const status of [401, 403]) {
    const { events, f } = await run(() => ({ status, text: `{"error":{"message":"Incorrect API key provided: ${KEY}"}}` }));
    assert.equal(errorOf(events).code, "provider.auth_failed");
    assert.equal(f.requests.length, 1);
    assert.equal(events.length, 1);
  }
});

test("the key never appears in an error, even when the provider or the network echoes it", async () => {
  const echoed = await run(() => ({ status: 401, text: `bad key Bearer ${KEY} and ${KEY}` }));
  assert.equal(JSON.stringify(echoed.events).includes(KEY), false);
  const net = await run(() => ({ throws: `connect ECONNREFUSED while sending Bearer ${KEY}` }), { retry: { max: 0 } });
  assert.equal(errorOf(net.events).code, "provider.unavailable");
  assert.equal(JSON.stringify(net.events).includes(KEY), false);
});

test("a filler that cannot produce a key is provider.auth_failed and no request is made", async () => {
  const { events, f } = await run(OK, { authorize: async () => { throw new Error("vault locked"); } });
  assert.equal(errorOf(events).code, "provider.auth_failed");
  assert.equal(f.requests.length, 0);
});

test("500 twice then success: retried with exponential backoff, the answer streams normally", async () => {
  const { events, f, clock, session } = await run((_r, n) => (n < 2 ? { status: 500, text: "oops" } : OK()));
  assert.equal(f.requests.length, 3);
  assert.deepEqual(clock.sleeps, [250, 500]);
  assert.equal(events.some((e) => e.type === "error"), false);
  assert.equal(events.at(-1)?.type, "done");
  assert.equal(session.stats().retries, 2);
});

test("503 three times: after the retries the turn fails with provider.unavailable", async () => {
  const { events, f } = await run(() => ({ status: 503, text: "overloaded" }));
  assert.equal(f.requests.length, 3);
  assert.equal(errorOf(events).code, "provider.unavailable");
});

test("a dropped connection is retried like a 5xx", async () => {
  const { events, f } = await run((_r, n) => (n === 0 ? { throws: "socket hang up" } : OK()));
  assert.equal(f.requests.length, 2);
  assert.equal(events.at(-1)?.type, "done");
});

test("429 with a short Retry-After waits that long and retries", async () => {
  const { events, clock } = await run((_r, n) => (n === 0 ? { status: 429, headers: { "retry-after": "1" }, text: "slow down" } : OK()));
  assert.deepEqual(clock.sleeps, [1000]);
  assert.equal(events.at(-1)?.type, "done");
});

test("429 with a long wait, or none stated, is surfaced at once so the backup key can take the turn", async () => {
  const long = await run(() => ({ status: 429, headers: { "retry-after": "30" }, text: "quota" }));
  assert.equal(errorOf(long.events).code, "provider.rate_limited");
  assert.equal(long.f.requests.length, 1);
  const none = await run(() => ({ status: 429, text: "quota" }));
  assert.equal(errorOf(none.events).code, "provider.rate_limited");
  assert.equal(none.f.requests.length, 1);
});

test("402 (credits) is provider.rate_limited and not retried", async () => {
  const { events, f } = await run(() => ({ status: 402, text: "insufficient credits" }));
  assert.equal(errorOf(events).code, "provider.rate_limited");
  assert.equal(f.requests.length, 1);
});

test("a prompt over the context window is provider.context_too_long, never retried", async () => {
  const { events, f } = await run(() => ({ status: 400, text: '{"error":{"message":"This model\'s maximum context length is 128000 tokens"}}' }));
  assert.equal(errorOf(events).code, "provider.context_too_long");
  assert.equal(f.requests.length, 1);
});

test("any other 4xx is provider.bad_request", async () => {
  const { events } = await run(() => ({ status: 422, text: "nope" }));
  assert.equal(errorOf(events).code, "provider.bad_request");
});

test("an error event before the first delta is retried; one after a delta is surfaced and never replayed", async () => {
  const early = 'data: {"error":{"message":"Provider returned error","code":503}}\n\n';
  const a = await run((_r, n) => (n === 0 ? { chunks: chunked(early, 32) } : OK()));
  assert.equal(a.f.requests.length, 2);
  assert.equal(a.events.at(-1)?.type, "done");

  const late = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":1}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Half an ans"}}\n\n',
    'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
  ].join("");
  const b = await run(() => ({ chunks: chunked(late, 40) }), {}, "anthropic");
  assert.equal(b.f.requests.length, 1, "bytes were streamed, so nothing is replayed");
  assert.deepEqual(b.events.map((e) => e.type), ["text", "error"]);
  assert.equal(errorOf(b.events).code, "provider.unavailable");
});

test("a stream that goes quiet is cut after the idle time and reported", async () => {
  const g = gate();
  const { events, f } = await run(() => ({ body: g.body }), { idleMs: 30, retry: { max: 0 } });
  assert.equal(f.requests.length, 1);
  const e = errorOf(events);
  assert.equal(e.code, "provider.unavailable");
  assert.match(e.message, /stopped answering/);
  assert.equal(f.requests[0]?.signal.aborted, true, "the connection was released");
});

test("cancel mid-stream ends the send quietly and releases the connection", async () => {
  const g = gate();
  const wire = fixture("openai-text");
  const f = fakeFetch(() => ({ body: g.body }));
  const driver = createApiDriver(ADAPTERS.openai, { authorize, context: () => ctx(), fetch: f.fetch, clock: fakeClock() });
  const session = await driver.open(spec(MODELS.openai));
  const it = session.send(turnInput(MODELS.openai))[Symbol.asyncIterator]();
  const first = it.next();
  g.push(wire.slice(0, wire.indexOf("\n\n", wire.indexOf("Hello")) + 2));
  const r1 = await first;
  assert.deepEqual(r1.value, { type: "text", text: "Hello" });
  const next = it.next();
  await session.cancel();
  const end = await Promise.race([next, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("cancel did not end the send")), 2_000))]);
  assert.equal(end.done, true, "no error event, no done event: the engine already knows it cancelled");
  assert.equal(f.requests[0]?.signal.aborted, true);
});

test("an account may name its own address, but only https or this machine", async () => {
  const f = fakeFetch(() => OK());
  const mk = (base: string) => createApiDriver(ADAPTERS.openai, { authorize, context: () => ctx(), fetch: f.fetch, clock: fakeClock(), accountOf: () => ({ ref: "#K", base }) });
  await assert.rejects(() => mk("http://evil.example/v1").open(spec(MODELS.openai)), (e: unknown) => e instanceof DriverError && e.code === "provider.bad_address");
  await assert.rejects(() => mk("ftp://x/v1").open(spec(MODELS.openai)), (e: unknown) => e instanceof DriverError && e.code === "provider.bad_address");
  await assert.rejects(() => mk("not a url").open(spec(MODELS.openai)), (e: unknown) => e instanceof DriverError);
  assert.equal(f.requests.length, 0, "a key is never sent to a refused address");

  for (const base of ["https://models.example.com/v1/", "http://127.0.0.1:11434/v1", "http://localhost:8080/v1"]) {
    const session = await mk(base).open(spec(MODELS.openai));
    for await (const e of session.send(turnInput(MODELS.openai))) if (e.type === "error") assert.fail(e.message);
    assert.equal(f.requests.at(-1)?.url, `${base.replace(/\/+$/, "")}/chat/completions`);
  }
});

test("a provider that is content-filtered with no output is reported, not an empty success", async () => {
  const wire = 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"content_filter"}]}\n\ndata: [DONE]\n\n';
  const { events } = await run(() => ({ chunks: chunked(wire, 80) }));
  assert.equal(errorOf(events).code, "provider.filtered");
});

test("an unreadable tool call is an error, not a call with empty arguments", async () => {
  const wire = 'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c","type":"function","function":{"name":"records_list","arguments":"{\\"ty"}}]}}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n';
  const { events } = await run(() => ({ chunks: chunked(wire, 80) }));
  assert.equal(events.some((e) => e.type === "tool_call"), false);
  assert.equal(errorOf(events).code, "provider.bad_response");
});
