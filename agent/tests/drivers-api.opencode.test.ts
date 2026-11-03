// OpenCode Go (rc.16 on MLA, 3 Nov 2026: every chat answered 400 MissingSessionID, "Request is missing x-opencode-session", while the model list answered). It takes a request only with both
// `user-agent: vyre/<version>` (a generic SDK or HTTP library agent is refused) and `x-opencode-session`, a stable id of the conversation: the same for every turn of one agent in one chat, so its
// cache works. One-shot jobs get one id per job kind and person. A 400 MissingSessionID, should it come back, reads in plain words.
import test from "node:test";
import assert from "node:assert/strict";
import { createApiSession, conversationId } from "../src/drivers/api/session.ts";
import { custom, opencodeGo, opencodeHeaders, vyreUserAgent } from "../src/drivers/api/openai.ts";
import { createApiDriver } from "../src/drivers/api/index.ts";
import { plainRefusal } from "../src/drivers/api/errors.ts";
import { authorize, ctx, fakeClock, fakeFetch, fixture, spec, turnInput } from "../src/drivers/api/testing.ts";
import type { DriverEvent, SessionSpec } from "../src/turn-engine/types.ts";

const UA = /^vyre\/[\w.+-]+$/;

async function turnOn(fetch: ReturnType<typeof fakeFetch>, s: SessionSpec, base = opencodeGo.defaultBase, adapter = opencodeGo): Promise<DriverEvent[]> {
  const session = createApiSession({ adapter, account: { ref: "#Team_OpenCode", base }, base, fetch: fetch.fetch, authorize, clock: fakeClock(), context: () => ctx() }, s);
  const out: DriverEvent[] = [];
  for await (const e of session.send(turnInput("kimi-k2"))) out.push(e);
  await session.close();
  return out;
}

test("an OpenCode Go chat carries vyre's user agent and the conversation's session id, the same id on every turn of that agent in that chat", async () => {
  const f = fakeFetch(() => ({ text: fixture("openai-text") }));
  const one = { ...spec("opencode_go/kimi-k2"), threadId: "thr_one" };
  await turnOn(f, one);
  await turnOn(f, one);
  await turnOn(f, { ...one, threadId: "thr_two" });
  await turnOn(f, { ...one, agent: { ...one.agent, id: "agt_other" } });
  const heads = f.requests.map((r) => r.headers);
  assert.equal(heads.length, 4);
  for (const h of heads) {
    assert.match(h["user-agent"] ?? "", UA, "vyre's own user agent");
    assert.match(h["x-opencode-session"] ?? "", /^vyre-[\w-]{32}$/, "a session id");
    assert.match(h["authorization"] ?? "", /^Bearer /);
  }
  assert.equal(heads[0]!["x-opencode-session"], heads[1]!["x-opencode-session"], "the same chat and agent: the same id, turn after turn");
  assert.notEqual(heads[0]!["x-opencode-session"], heads[2]!["x-opencode-session"], "another chat: another id");
  assert.notEqual(heads[0]!["x-opencode-session"], heads[3]!["x-opencode-session"], "another agent: another id");
  assert.equal(heads[0]!["x-opencode-session"], conversationId(one));
  assert.match(f.requests[0]!.url, /^https:\/\/opencode\.ai\/inference\/go\/openai\/v1\/chat\/completions$/);
});

test("a one-shot job gets one id per job kind and person, not one per call", () => {
  const a = conversationId({ threadId: "oneshot_m1", agent: { id: "memory-upkeep", name: "Memory upkeep", mode: "lead" }, asker: "usr_dana" });
  const b = conversationId({ threadId: "oneshot_m2", agent: { id: "memory-upkeep", name: "Memory upkeep", mode: "lead" }, asker: "usr_dana" });
  const c = conversationId({ threadId: "oneshot_m3", agent: { id: "memory-upkeep", name: "Memory upkeep", mode: "lead" }, asker: "usr_maya" });
  const d = conversationId({ threadId: "oneshot_m4", agent: { id: "chat-title", name: "Titles", mode: "lead" }, asker: "usr_dana" });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});

test("the OpenCode model list carries vyre's user agent too", async () => {
  const f = fakeFetch(() => ({ text: JSON.stringify({ data: [{ id: "kimi-k2" }, { id: "glm-5" }] }) }));
  const oc = createApiDriver(opencodeGo, { authorize, context: () => ctx(), fetch: f.fetch, clock: fakeClock() });
  assert.deepEqual((await oc.models({ ref: "#Team_OpenCode" })).map((m) => m.id), ["kimi-k2", "glm-5"]);
  assert.equal(f.requests[0]!.url, "https://opencode.ai/inference/go/v1/models");
  assert.match(f.requests[0]!.headers["user-agent"] ?? "", UA);
  assert.match(opencodeGo.modelsRequest().headers["user-agent"] ?? "", UA, "the adapter's own model request");
});

test("a custom OpenAI-compatible endpoint pointed at opencode.ai sends the same two headers; any other address sends neither", async () => {
  const f = fakeFetch(() => ({ text: fixture("openai-text") }));
  await turnOn(f, { ...spec("custom/kimi-k2"), threadId: "thr_custom" }, "https://opencode.ai/inference/go/openai/v1", custom);
  assert.match(f.requests[0]!.headers["user-agent"] ?? "", UA);
  assert.ok(f.requests[0]!.headers["x-opencode-session"]);
  assert.deepEqual(opencodeHeaders("https://api.example.com/v1", "x"), {});
  assert.deepEqual(opencodeHeaders("http://localhost:11434/v1"), {});
  assert.equal(vyreUserAgent().startsWith("vyre/"), true);
});

test("a 400 MissingSessionID reads in plain words", async () => {
  const f = fakeFetch(() => ({ status: 400, text: JSON.stringify({ type: "error", error: { type: "MissingSessionID", message: "Request is missing x-opencode-session" } }) }));
  const events = await turnOn(f, { ...spec("opencode_go/kimi-k2"), threadId: "thr_err" });
  const err = events.find((e) => e.type === "error") as { message?: string } | undefined;
  assert.ok(err, JSON.stringify(events).slice(0, 300));
  assert.match(err!.message ?? "", /OpenCode Go turned the chat away because it carried no session id/);
  assert.equal(plainRefusal(400, "Request is missing x-opencode-session"), err!.message);
  assert.equal(plainRefusal(400, "model not found"), null);
});
