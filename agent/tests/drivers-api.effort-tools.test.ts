// OpenAI refuses some models' reasoning_effort when the request carries function tools on /v1/chat/completions (real-model gate, 13 Nov 2026: gpt-5.6-luna answered 400 "Function tools
// with reasoning_effort are not supported for gpt-5.6-luna in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'"). The driver does what the
// provider's own message says: it sends the same request once more with reasoning_effort "none", and remembers the model so its next request goes out with "none" at once. A model that takes
// the effort with tools keeps the effort the person set.
import test from "node:test";
import assert from "node:assert/strict";
import { createApiSession } from "../src/drivers/api/session.ts";
import { openai } from "../src/drivers/api/openai.ts";
import { authorize, chunked, ctx, fakeClock, fakeFetch, fixture, spec, turnInput } from "../src/drivers/api/testing.ts";
import type { DriverEvent } from "../src/turn-engine/types.ts";

const REFUSAL = JSON.stringify({ error: { message: "Function tools with reasoning_effort are not supported for gpt-5.6-luna in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.", type: "invalid_request_error", param: "reasoning_effort", code: "unsupported_value" } });

async function turn(model: string, refuses: (body: Record<string, unknown>) => boolean, effort: "low" | "medium" | "high" | null = "medium") {
  const f = fakeFetch((req) => (refuses(req.body as Record<string, unknown>) ? { status: 400, text: REFUSAL } : { chunks: chunked(fixture("openai-text"), 64) }));
  const s = spec(`openai/${model}`, effort !== null ? { effort } : {});
  const session = createApiSession({ adapter: openai, account: { ref: "#Key", base: openai.defaultBase }, base: openai.defaultBase, fetch: f.fetch, authorize, clock: fakeClock(), context: () => ctx() }, s);
  const out: DriverEvent[] = [];
  for await (const e of session.send(turnInput(`openai/${model}`))) out.push(e);
  return { bodies: f.requests.map((r) => r.body as Record<string, unknown>), errors: out.filter((e) => e.type === "error") };
}
const lunaRefuses = (b: Record<string, unknown>): boolean => Array.isArray(b["tools"]) && b["reasoning_effort"] !== "none";

test("a model that refuses reasoning_effort with function tools: the request goes once more with \"none\", the turn answers, and the next request sends \"none\" at once", async () => {
  const first = await turn("gpt-5.6-luna", lunaRefuses);
  assert.deepEqual(first.errors, [], JSON.stringify(first.errors));
  assert.deepEqual(first.bodies.map((b) => b["reasoning_effort"]), ["medium", "none"]);
  assert.ok(Array.isArray(first.bodies[1]!["tools"]), "the tools are kept");
  const next = await turn("gpt-5.6-luna", lunaRefuses);
  assert.deepEqual(next.bodies.map((b) => b["reasoning_effort"]), ["none"], "remembered: one request");
});

test("with no effort set the same refusal is fixed the same way; a model that takes the effort keeps it; a second refusal is the turn's error (one resend, never a loop)", async () => {
  const noEffort = await turn("gpt-5.7-terra", (b) => Array.isArray(b["tools"]) && b["reasoning_effort"] !== "none", null);
  assert.deepEqual(noEffort.errors, []);
  assert.deepEqual(noEffort.bodies.map((b) => b["reasoning_effort"]), [undefined, "none"]);
  const plain = await turn("gpt-5", () => false, "high");
  assert.deepEqual(plain.bodies.map((b) => b["reasoning_effort"]), ["high"]);
  const always = await turn("gpt-5.8-sol", () => true);
  assert.equal(always.bodies.length, 2);
  assert.equal((always.errors[0] as { code?: string } | undefined)?.code, "provider.bad_request");
});
