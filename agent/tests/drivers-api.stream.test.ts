// API drivers stream without buffering (spec 4.14, speed; ARCH 6.6): recorded provider streams replay as deltas, and a delta leaves the driver the moment its bytes arrive,
// with the rest of the response still unsent. Anthropic, OpenAI, OpenRouter, Google and xAI; chunks cut at every awkward place, including inside a multi-byte character.
import test from "node:test";
import assert from "node:assert/strict";
import { ADAPTERS, createApiDriver, createSseParser, parseSse } from "../src/drivers/api/index.ts";
import type { ProviderId } from "../src/drivers/api/index.ts";
import { MODELS, WIRE, authorize, chunked, ctx, fakeClock, fakeFetch, fixture, gate, spec, turnInput } from "../src/drivers/api/testing.ts";
import type { DriverEvent } from "../src/turn-engine/types.ts";

const PROVIDERS: ProviderId[] = ["anthropic", "openai", "openrouter", "google", "xai"];
const DELTAS = ["Hello", " there, ", "Dana. ", "Café ready."];

const textOf = (provider: ProviderId): string => fixture(`${WIRE[provider]}-text`, { crlf: provider === "google" });

function driverFor(provider: ProviderId, f: ReturnType<typeof fakeFetch>) {
  return createApiDriver(ADAPTERS[provider], { authorize, context: () => ctx(), fetch: f.fetch, clock: fakeClock() });
}

async function collect(it: AsyncIterable<DriverEvent>): Promise<DriverEvent[]> {
  const out: DriverEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const within = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out waiting for ${what}`)), ms))]);

for (const provider of PROVIDERS) {
  test(`${provider}: a recorded stream replays as deltas, then usage, then done`, async () => {
    const f = fakeFetch(() => ({ chunks: chunked(textOf(provider), 7) }));
    const session = await driverFor(provider, f).open(spec(MODELS[provider]));
    const events = await collect(session.send(turnInput(MODELS[provider])));
    const texts = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text);
    assert.deepEqual(texts, DELTAS, "each provider delta is one text event, in order, none merged");
    assert.equal(texts.join(""), "Hello there, Dana. Café ready.");
    const kinds = events.map((e) => e.type);
    assert.deepEqual(kinds, ["text", "text", "text", "text", "usage", "done"]);
    const usage = events.find((e) => e.type === "usage");
    assert.deepEqual(usage, { type: "usage", inputTokens: 2200, outputTokens: 12 });
    assert.equal(f.requests.length, 1);
  });

  test(`${provider}: the same stream cut into chunks of every size from 1 to 13 bytes decodes the same`, async () => {
    for (let size = 1; size <= 13; size++) {
      const f = fakeFetch(() => ({ chunks: chunked(textOf(provider), size) }));
      const session = await driverFor(provider, f).open(spec(MODELS[provider]));
      const events = await collect(session.send(turnInput(MODELS[provider])));
      const texts = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text);
      assert.deepEqual(texts, DELTAS, `chunk size ${size}`);
      assert.equal(events[events.length - 1]?.type, "done");
    }
  });

  test(`${provider}: a delta is yielded before the rest of the response is sent`, async () => {
    const wire = textOf(provider);
    const sep = provider === "google" ? "\r\n\r\n" : "\n\n";
    // Everything up to and including the event that carries the first delta.
    const firstCut = wire.indexOf(sep, wire.indexOf("Hello")) + sep.length;
    const secondCut = wire.indexOf(sep, wire.indexOf(" there, ")) + sep.length;
    assert.ok(firstCut > sep.length && secondCut > firstCut, "fixture has the events the test cuts at");

    const g = gate();
    const f = fakeFetch(() => ({ body: g.body }));
    const session = await driverFor(provider, f).open(spec(MODELS[provider]));
    const it = session.send(turnInput(MODELS[provider]))[Symbol.asyncIterator]();

    const first = it.next();
    g.push(wire.slice(0, firstCut));
    const r1 = await within(first, 2_000, "the first delta");
    assert.deepEqual(r1.value, { type: "text", text: "Hello" }, "the first delta arrived while the response was still open and incomplete");

    // Nothing more may come until more bytes do.
    let early = false;
    const second = it.next();
    void second.then(() => { early = true; });
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(early, false, "the driver did not invent or batch anything while waiting");

    g.push(wire.slice(firstCut, secondCut));
    const r2 = await within(second, 2_000, "the second delta");
    assert.deepEqual(r2.value, { type: "text", text: " there, " });

    g.push(wire.slice(secondCut));
    g.end();
    const rest: DriverEvent[] = [];
    for (;;) { const r = await within(it.next(), 2_000, "the rest"); if (r.done) break; rest.push(r.value); }
    assert.deepEqual(rest.map((e) => e.type), ["text", "text", "usage", "done"]);
  });
}

test("openrouter: processing comments between events are ignored", async () => {
  const wire = ": OPENROUTER PROCESSING\n\n" + fixture("openai-text").replace(/\n\n/g, "\n\n: OPENROUTER PROCESSING\n\n");
  const f = fakeFetch(() => ({ chunks: chunked(wire, 11) }));
  const session = await driverFor("openrouter", f).open(spec(MODELS.openrouter));
  const events = await collect(session.send(turnInput(MODELS.openrouter)));
  assert.deepEqual(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text), DELTAS);
});

test("sse parser: events leave as soon as their blank line is read", async () => {
  const g = gate();
  const it = parseSse(g.body)[Symbol.asyncIterator]();
  const a = it.next();
  g.push("event: x\ndata: one\n\n");
  assert.deepEqual((await within(a, 1_000, "event one")).value, { event: "x", data: "one" });
  const b = it.next();
  g.push("data: two");
  g.push("\n");
  let early = false;
  void b.then(() => { early = true; });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(early, false, "a line without its blank line is not an event yet");
  g.push("\n");
  assert.deepEqual((await within(b, 1_000, "event two")).value, { event: "message", data: "two" });
  g.end();
  assert.equal((await within(it.next(), 1_000, "the end")).done, true);
});

test("sse parser: CRLF, lone CR, comments, multi-line data, no-colon fields, a final event with no blank line", () => {
  const p = createSseParser();
  const got = [
    ...p.push("data: a\r\n\r\n: keep-alive\r\ndata: b\r\ndata: c\r\n\r"),
    ...p.push("\ndata\n\n"),
    ...p.push("event: tail\ndata: last"),
    ...p.end(),
  ];
  assert.deepEqual(got, [
    { event: "message", data: "a" },
    { event: "message", data: "b\nc" },
    { event: "message", data: "" },
    { event: "tail", data: "last" },
  ]);
});

test("sse parser: a multi-byte character split across chunks is whole in the event", async () => {
  const bytes = new TextEncoder().encode("data: café ☃\n\n");
  const out: string[] = [];
  async function* body(): AsyncGenerator<Uint8Array> { for (const b of bytes) yield new Uint8Array([b]); }
  for await (const ev of parseSse(body())) out.push(ev.data);
  assert.deepEqual(out, ["café ☃"]);
});
