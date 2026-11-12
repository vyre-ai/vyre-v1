// An API session with no model never sends one the provider refuses (release gate, 12 Nov 2026: after a restart a chat went out with `model: ""` and every turn answered 400 "`model` must be a
// non-empty string"). It sends nothing and says in plain words how to pick one.
import test from "node:test";
import assert from "node:assert/strict";
import { createApiSession } from "../src/drivers/api/session.ts";
import { opencodeGo } from "../src/drivers/api/openai.ts";
import { authorize, ctx, fakeClock, fakeFetch, fixture, spec, turnInput } from "../src/drivers/api/testing.ts";
import type { DriverEvent } from "../src/turn-engine/types.ts";

test("no model: nothing is sent, and the turn says how to pick one", async () => {
  const f = fakeFetch(() => ({ text: fixture("openai-text") }));
  const s = spec("opencode_go/kimi-k2");
  const session = createApiSession({ adapter: opencodeGo, account: { ref: "#Team_OpenCode", base: opencodeGo.defaultBase }, base: opencodeGo.defaultBase, fetch: f.fetch, authorize, clock: fakeClock(), context: () => ctx() }, { ...s, agent: { ...s.agent, model: "" } });
  const out: DriverEvent[] = [];
  for await (const e of session.send(turnInput(""))) out.push(e);
  assert.equal(f.requests.length, 0, "nothing reached the provider");
  const err = out.find((e) => e.type === "error") as { code: string; message: string } | undefined;
  assert.equal(err?.code, "engine.no_model");
  assert.match(err!.message, /^No model is set for this chat\. Pick one in the chat's model menu/);
});

test("OpenRouter picks its own default model when a request names none: the request goes out with no model field, never an empty one", async () => {
  const { openrouter } = await import("../src/drivers/api/openai.ts");
  const { chunked } = await import("../src/drivers/api/testing.ts");
  const f = fakeFetch(() => ({ chunks: chunked(fixture("openai-text"), 64) }));
  const s = spec("openrouter/x");
  const session = createApiSession({ adapter: openrouter, account: { ref: "#Team_Router", base: openrouter.defaultBase }, base: openrouter.defaultBase, fetch: f.fetch, authorize, clock: fakeClock(), context: () => ctx() }, { ...s, agent: { ...s.agent, model: "" } });
  const out: DriverEvent[] = [];
  for await (const e of session.send(turnInput(""))) out.push(e);
  assert.equal(f.requests.length, 1, "it reached OpenRouter");
  const body = f.requests[0]!.body as Record<string, unknown>;
  assert.equal("model" in body, false, "no model field: OpenRouter runs it on the account's default");
  assert.equal(out.some((e) => e.type === "error"), false, JSON.stringify(out.filter((e) => e.type === "error")));
});
