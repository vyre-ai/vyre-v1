// The key of a call on the API engines, through the real decoders (13 Nov 2026, review of the minimal branch). A provider's call id is an identity only when the PROVIDER made it: Google sends none and the decoder
// numbers its calls again at every model step (`gcall_1`), and an OpenAI-compatible server may send an empty id (`call_0`). Such a call is marked `synthetic`, the tool layer is given no call id for it, and its key is
// random: it always acts. A real id (Anthropic's `toolu_...`, OpenAI's `call_<random>`) gives `ag:<turn>:<id>` with no counter, so the same call delivered twice has the same key, also after a restart.
import test from "node:test";
import assert from "node:assert/strict";
import { google } from "../src/drivers/api/google.ts";
import { openai } from "../src/drivers/api/openai.ts";
import { anthropic } from "../src/drivers/api/anthropic.ts";
import { createApiTools } from "../src/drivers/open/index.ts";
import { createToolSession } from "../src/tools/index.ts";
import { loadGenerated, validatingInvoke } from "../src/tools/harness.ts";
import type { Decoded, ProviderAdapter, ToolCall } from "../src/drivers/api/types.ts";

function rig() {
  const loaded = loadGenerated();
  const { invoke, sent } = validatingInvoke(loaded.caps);
  const session = createToolSession({
    catalog: loaded.catalog,
    defaults: loaded.defaults,
    invoke,
    levelFor: () => "manage",
    canEngineer: () => false,
  });
  session.preload("thr_1", ["artifact_publish"]);
  const tools = createApiTools({ session, space: "spc_1", system: async () => [] });
  /** What the engine does with a decoded call: hands the runner its id, name, input and whether the id was made up. */
  const run = (turnId: string, call: ToolCall) =>
    tools.runner(
      { id: call.id, name: call.name, input: call.input, ...(call.synthetic ? { synthetic: true } : {}) } as never,
      { threadId: "thr_1", agentId: "agt_dex", asker: "usr_dana", turnId } as never,
    );
  const keys = () => sent.map((x) => (x.input as { idempotencyKey: string }).idempotencyKey);
  return { run, keys, sent };
}

/** One model step, decoded by a NEW decoder (the session makes a new one at every step). */
const step = (a: ProviderAdapter, datas: string[]): ToolCall[] => {
  const d = a.decoder();
  return datas
    .flatMap((x) => d.push({ data: x } as never))
    .concat(d.end?.() ?? [])
    .filter((e: Decoded) => e.type === "tool_call")
    .map((e) => (e as { call: ToolCall }).call);
};
const page = (t: string) => ({ title: t, html: `<h1>${t}</h1>` });
const gemini = (input: unknown) =>
  JSON.stringify({
    candidates: [
      { content: { parts: [{ functionCall: { name: "artifact_publish", args: input } }] }, finishReason: "STOP" },
    ],
  });
const oa = (id: string, input: unknown) => [
  JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [{ index: 0, id, function: { name: "artifact_publish", arguments: JSON.stringify(input) } }],
        },
        finish_reason: "tool_calls",
      },
    ],
  }),
  "[DONE]",
];

test("Google: two steps of one turn, one call each, both numbered gcall_1 by the decoder: both run, same input or different", async () => {
  for (const second of [page("Weekly report"), page("Another")]) {
    const r = rig();
    const a = step(google, [gemini(page("Weekly report"))])[0]!;
    const b = step(google, [gemini(second)])[0]!;
    assert.equal(a.id, b.id, "the collision is real: both steps number their call the same");
    assert.equal(a.synthetic, true);
    await r.run("trn_1", a);
    await r.run("trn_1", b);
    assert.equal(r.sent.length, 2, "two handler runs");
    assert.ok(
      r.keys().every((k) => /^ag:r:/.test(k)),
      String(r.keys()),
    );
    assert.notEqual(r.keys()[0], r.keys()[1]);
  }
});

test("OpenAI-compatible: an empty id is synthesised and gets a random key; two steps both run", async () => {
  const r = rig();
  const a = step(openai, oa("", page("Weekly report")))[0]!;
  const b = step(openai, oa("", page("Another")))[0]!;
  assert.equal(a.id, "call_0");
  assert.equal(a.id, b.id);
  assert.equal(a.synthetic, true);
  await r.run("trn_1", a);
  await r.run("trn_1", b);
  assert.equal(r.sent.length, 2);
  assert.ok(r.keys().every((k) => /^ag:r:/.test(k)));
});

test("a real provider id gives ag:<turn>:<id>, and the same call delivered twice has the same key; the same id in another turn has another", async () => {
  const r = rig();
  const real = step(openai, oa("call_9fXk2LmQ", page("Weekly report")))[0]!;
  assert.equal(real.synthetic, undefined);
  await r.run("trn_1", real);
  await r.run("trn_1", real);
  await r.run("trn_2", real);
  assert.deepEqual(r.keys(), ["ag:trn_1:call_9fXk2LmQ", "ag:trn_1:call_9fXk2LmQ", "ag:trn_2:call_9fXk2LmQ"]);
  const an = JSON.stringify;
  const toolu = step(anthropic, [
    an({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_01AbC", name: "artifact_publish" },
    }),
    an({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(page("A")) },
    }),
    an({ type: "content_block_stop", index: 0 }),
    an({ type: "message_delta", delta: { stop_reason: "tool_use" } }),
  ])[0]!;
  assert.equal(toolu.id, "toolu_01AbC");
  assert.equal(toolu.synthetic, undefined);
});

test("a very long provider id is hashed to a fixed length, the same long id to the same part", async () => {
  const r = rig();
  const long = step(openai, oa("call_".padEnd(500, "x"), page("A")))[0]!;
  await r.run("trn_1", long);
  await r.run("trn_1", long);
  const [a, b] = r.keys();
  assert.ok((a ?? "").length < 100, a);
  assert.equal(a, b);
});
