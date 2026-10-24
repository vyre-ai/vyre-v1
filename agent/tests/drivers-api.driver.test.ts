// The driver port (ARCH 6.6): five drivers, each lists the models an account can reach, probes an account with no Space data, and opens sessions the warm pool can hold.
import test from "node:test";
import assert from "node:assert/strict";
import { ADAPTERS, PROVIDER_IDS, createApiDrivers } from "../src/drivers/api/index.ts";
import type { ProviderId } from "../src/drivers/api/index.ts";
import { createPool } from "../src/pool/index.ts";
import { MODELS, WIRE, authorize, chunked, ctx, fakeClock, fakeFetch, fixture, spec, turnInput } from "../src/drivers/api/testing.ts";
import type { DriverEvent } from "../src/turn-engine/types.ts";

const LISTS: Record<ProviderId, { json: unknown; expect: string[]; path: RegExp }> = {
  anthropic: { json: { data: [{ id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" }, { id: "claude-haiku-5", display_name: "Claude Haiku 5" }] }, expect: ["claude-sonnet-5-5", "claude-haiku-5"], path: /^https:\/\/api\.anthropic\.com\/v1\/models/ },
  openai: { json: { data: [{ id: "gpt-5" }, { id: "text-embedding-3-large" }, { id: "o4-mini" }, { id: "whisper-1" }] }, expect: ["gpt-5", "o4-mini"], path: /^https:\/\/api\.openai\.com\/v1\/models$/ },
  openrouter: { json: { data: [{ id: "anthropic/claude-sonnet-5-5", name: "Claude Sonnet 5.5" }, { id: "x-ai/grok-4" }] }, expect: ["anthropic/claude-sonnet-5-5", "x-ai/grok-4"], path: /^https:\/\/openrouter\.ai\/api\/v1\/models$/ },
  google: { json: { models: [{ name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", supportedGenerationMethods: ["generateContent"] }, { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] }] }, expect: ["gemini-2.5-pro"], path: /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models/ },
  xai: { json: { data: [{ id: "grok-4" }, { id: "grok-4-fast" }] }, expect: ["grok-4", "grok-4-fast"], path: /^https:\/\/api\.x\.ai\/v1\/models$/ },
};

function drivers(handler: Parameters<typeof fakeFetch>[0]) {
  const f = fakeFetch(handler);
  const all = createApiDrivers({ authorize, context: () => ctx(), fetch: f.fetch, clock: fakeClock() });
  const by = (id: ProviderId) => {
    const d = all.find((x) => x.id === id);
    assert.ok(d, `driver ${id}`);
    return d;
  };
  return { f, all, by };
}

test("there is one api driver for each of the five providers", () => {
  const { all } = drivers(() => ({}));
  assert.deepEqual(all.map((d) => d.id), [...PROVIDER_IDS]);
  assert.deepEqual([...PROVIDER_IDS], ["anthropic", "openai", "openrouter", "google", "xai"]);
  for (const d of all) assert.equal(d.kind, "api");
});

for (const id of PROVIDER_IDS) {
  test(`${id}: models lists what the account can reach, asked with the account's own key`, async () => {
    const L = LISTS[id];
    const { f, by } = drivers(() => ({ text: JSON.stringify(L.json) }));
    const models = await by(id).models({ ref: "#Team_Key" });
    assert.deepEqual(models.map((m) => m.id), L.expect);
    assert.match(f.requests[0]?.url ?? "", L.path);
    assert.equal(f.requests[0]?.method, "GET");
    const h = f.requests[0]?.headers ?? {};
    assert.ok(h["x-api-key"] === "sk-test-0123456789abcdef" || h["x-goog-api-key"] === "sk-test-0123456789abcdef" || h["authorization"] === "Bearer sk-test-0123456789abcdef", "key header present");
    assert.equal(f.requests[0]?.body, undefined, "no prompt, no Space data");
  });

  test(`${id}: probe says ok with a count, auth_failed on a bad key, network on no connection`, async () => {
    const L = LISTS[id];
    const ok = drivers(() => ({ text: JSON.stringify(L.json) }));
    assert.deepEqual(await ok.by(id).probe({ ref: "#K" }), { ok: true, models: L.expect.length });

    const bad = drivers(() => ({ status: 401, text: "invalid key" }));
    const r = await bad.by(id).probe({ ref: "#K" });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, "provider.auth_failed");

    const down = drivers(() => ({ throws: "ECONNREFUSED" }));
    const d = await down.by(id).probe({ ref: "#K" });
    assert.deepEqual([d.ok, d.error?.code], [false, "provider.network"]);
  });
}

test("probe never carries the key into its answer", async () => {
  const { by } = drivers(() => ({ status: 403, text: "key sk-test-0123456789abcdef rejected" }));
  const r = await by("openai").probe({ ref: "#K" });
  assert.equal(JSON.stringify(r).includes("sk-test-0123456789abcdef"), false);
});

test("a rate-limited or broken provider is reported by its code, so a probe does not mark the account failed for it", async () => {
  const { by } = drivers(() => ({ status: 503, text: "down" }));
  const r = await by("anthropic").probe({ ref: "#K" });
  assert.deepEqual([r.ok, r.error?.code], [false, "provider.unavailable"]);
});

test("the pool can hold api sessions: acquire opens one, a second acquire for the same key is warm, and the answer streams through the lease", async () => {
  const f = fakeFetch(() => ({ chunks: chunked(fixture("anthropic-text"), 64) }));
  const [driver] = createApiDrivers({ authorize, context: () => ctx(), fetch: f.fetch, clock: fakeClock() }).filter((d) => d.id === "anthropic");
  assert.ok(driver);
  const pool = createPool({ placement: "host", drivers: [driver] });
  const s = spec(MODELS.anthropic);
  const ps = { key: { driver: "anthropic", accountRef: "#Team_Key", model: MODELS.anthropic, sandboxId: null, mcpProfile: "default" }, threadId: "T1", person: "dana", session: s };
  const a = await pool.acquire(ps);
  assert.equal(a.warm, false);
  const events: DriverEvent[] = [];
  for await (const e of a.session.send(turnInput(MODELS.anthropic))) events.push(e);
  assert.equal(events.at(-1)?.type, "done");
  await pool.release(a, { reuse: true });
  const b = await pool.acquire(ps);
  assert.equal(b.warm, true, "the second turn of a resumed chat does not cold-start");
  assert.equal(b.session, a.session);
  await pool.release(b, { reuse: false });
  await pool.close();
});

test("every provider's adapter names its provider and takes its own model names", () => {
  for (const id of PROVIDER_IDS) assert.equal(ADAPTERS[id].id, id);
  assert.equal(ADAPTERS.anthropic.modelName("anthropic/claude-sonnet-5-5"), "claude-sonnet-5-5");
  assert.equal(ADAPTERS.openai.modelName("openai/gpt-5"), "gpt-5");
  assert.equal(ADAPTERS.google.modelName("models/gemini-2.5-pro"), "gemini-2.5-pro");
  assert.equal(ADAPTERS.openrouter.modelName("anthropic/claude-sonnet-5-5"), "anthropic/claude-sonnet-5-5", "a router keeps the vendor prefix");
  assert.equal(ADAPTERS.xai.modelName("grok-4"), "grok-4");
  assert.equal(WIRE.openrouter, "openai");
});
