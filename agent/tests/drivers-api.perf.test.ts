// Speed budgets that touch the API drivers (perf/budgets.json, ARCH 10.4, spec Speed and smoothness):
//   send           first token = the provider's own latency plus under 150 ms of ours (turn.first_token_overhead p95)
//   stream_render  deltas leave the driver inside one frame (16.7 ms) of their bytes arriving, so the client can render at 60 fps
// The thresholds are read from perf/budgets.json, never copied here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ADAPTERS, createApiDriver, createSseParser } from "../src/drivers/api/index.ts";
import type { ProviderId } from "../src/drivers/api/index.ts";
import { MODELS, WIRE, authorize, chunked, ctx, fakeClock, fakeFetch, fixture, gate, spec, turnInput } from "../src/drivers/api/testing.ts";

interface Row { id: string; p95: number; also?: Array<{ metric: string; p95: number }> }
const rows = (JSON.parse(readFileSync(new URL("../../perf/budgets.json", import.meta.url), "utf8")) as { budgets: Row[] }).budgets;
const row = (id: string): Row => {
  const r = rows.find((x) => x.id === id);
  assert.ok(r, `perf/budgets.json has a row ${id}`);
  return r;
};
const FIRST_TOKEN_MS = row("send").also?.find((a) => a.metric === "turn.first_token_overhead")?.p95 ?? NaN;
const FRAME_MS = row("stream_render").p95;

const PROVIDERS: ProviderId[] = ["anthropic", "openai", "openrouter", "google", "xai"];
const INJECTED_MS = 200;
const percentile = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? 0;
};

test("perf budgets are present and sane", () => {
  assert.ok(Number.isFinite(FIRST_TOKEN_MS) && FIRST_TOKEN_MS > 0);
  assert.ok(Number.isFinite(FRAME_MS) && FRAME_MS > 0);
});

test("perf send: first token overhead of every API driver is inside the budget with a 200 ms provider", async () => {
  // The five drivers run side by side: eight sequential turns each would not fit the 20 s cap of a test file at 200 ms a turn.
  const results = await Promise.all(PROVIDERS.map(async (provider) => {
    const wire = fixture(`${WIRE[provider]}-text`);
    const f = fakeFetch(() => ({ latencyMs: INJECTED_MS, chunks: chunked(wire, 256) }));
    let fetchStart = 0;
    let fetchEnd = 0;
    const driver = createApiDriver(ADAPTERS[provider], {
      authorize, context: () => ctx(),
      fetch: async (url, init) => { fetchStart = performance.now(); const r = await f.fetch(url, init); fetchEnd = performance.now(); return r; },
      clock: fakeClock(),
    });
    const overheads: number[] = [];
    for (let i = 0; i < 8; i++) {
      const session = await driver.open(spec(MODELS[provider]));
      const t0 = performance.now();
      let firstText = 0;
      for await (const e of session.send(turnInput(MODELS[provider]))) if (e.type === "text" && firstText === 0) firstText = performance.now();
      assert.ok(firstText > 0, "a first token arrived");
      const providerMs = fetchEnd - fetchStart;
      assert.ok(providerMs >= INJECTED_MS - 5, "the injected provider latency really elapsed");
      // Ours: everything between send() and the first token except the time the provider took to start answering.
      overheads.push(firstText - t0 - providerMs);
    }
    return { provider, p95: percentile(overheads, 95) };
  }));
  console.log(`perf send: injected=${INJECTED_MS}ms first_token_overhead_p95_ms ${results.map((r) => `${r.provider}=${r.p95.toFixed(2)}`).join(" ")} budget=${FIRST_TOKEN_MS}`);
  for (const r of results) assert.ok(r.p95 < FIRST_TOKEN_MS, `${r.provider}: first token overhead p95 ${r.p95.toFixed(2)} ms is over the ${FIRST_TOKEN_MS} ms budget`);
});

const DELTA: Record<"anthropic" | "openai" | "google", (i: number) => string> = {
  anthropic: (i) => `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"w${i} "}}\n\n`,
  openai: (i) => `data: {"choices":[{"index":0,"delta":{"content":"w${i} "}}]}\n\n`,
  google: (i) => `data: {"candidates":[{"content":{"parts":[{"text":"w${i} "}],"role":"model"}}]}\n\n`,
};

test("perf stream_render: a delta leaves the driver inside one frame of its bytes arriving", async () => {
  const lines: string[] = [];
  for (const provider of ["anthropic", "openai", "google"] as const) {
    const g = gate();
    const f = fakeFetch(() => ({ body: g.body }));
    const driver = createApiDriver(ADAPTERS[provider], { authorize, context: () => ctx(), fetch: f.fetch, clock: fakeClock() });
    const session = await driver.open(spec(MODELS[provider]));
    const it = session.send(turnInput(MODELS[provider]))[Symbol.asyncIterator]();
    const lat: number[] = [];
    for (let i = 0; i < 320; i++) {
      const next = it.next();
      const t0 = performance.now();
      g.push(DELTA[provider](i));
      const r = await next;
      const dt = performance.now() - t0;
      assert.equal(r.done, false);
      assert.deepEqual(r.value, { type: "text", text: `w${i} ` });
      // The first 20 warm the path (JIT, the decoder's first allocations).
      if (i >= 20) lat.push(dt);
    }
    g.end();
    for (;;) { const r = await it.next(); if (r.done) break; }
    const p95 = percentile(lat, 95);
    lines.push(`${provider}=${p95.toFixed(3)}`);
    assert.equal(lat.length, 300);
    assert.ok(p95 < FRAME_MS, `${provider}: delta latency p95 ${p95.toFixed(3)} ms is over the ${FRAME_MS} ms frame`);
  }
  console.log(`perf stream_render: delta_latency_p95_ms ${lines.join(" ")} budget=${FRAME_MS}`);
});

test("perf stream_render: ten thousand deltas decode in well under a second, no quadratic slowdown", () => {
  const p = createSseParser();
  const one = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"word "}}\n\n';
  const t0 = performance.now();
  let n = 0;
  for (let i = 0; i < 10_000; i++) n += p.push(one).length;
  const dt = performance.now() - t0;
  assert.equal(n, 10_000);
  console.log(`perf stream_render: sse_decode_10k_events_ms=${dt.toFixed(1)}`);
  assert.ok(dt < 1_000, `decoding 10,000 events took ${dt.toFixed(0)} ms`);
});
