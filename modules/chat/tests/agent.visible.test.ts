// A person can only bring in, ask or @mention an agent the agents module lets them see; a private assistant of someone else is "not found", the same as an agent that does not exist.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DRAFTER, INTAKE, codeOf, harness } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
const notFound = (): never => { throw Object.assign(new Error("That agent does not exist."), { code: "validation.not_found" }); };
const PRIVATE = "agt_someoneelses";

test("a chat or an Ask with an agent the person cannot see is refused; one they can see opens", async () => {
  const hn = harness({ calls: { "agents.get": (i) => (i["agentId"] === PRIVATE ? notFound() : { agent: { agentId: i["agentId"] } }) } });
  await assert.rejects(h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [PRIVATE], idempotencyKey: "v1" }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE, PRIVATE], idempotencyKey: "v2" }), (e) => codeOf(e) === "validation.not_found", "one hidden agent among visible ones still refuses");
  const ok = await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: "v3" });
  assert.ok(ok.thread.threadId);
});

test("an @mention of an agent the person cannot see is refused", async () => {
  const hn = harness({ calls: { "agents.get": (i) => (i["agentId"] === PRIVATE ? notFound() : { agent: {} }) } });
  const started = await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [DRAFTER], idempotencyKey: "v4" });
  await assert.rejects(h["chat.post"]!(hn.ctx, { threadId: started.thread.threadId, body: "hi", mentions: [{ kind: "agent", id: PRIVATE }], idempotencyKey: "v5" }), (e) => codeOf(e) === "validation.not_found");
  const fine = await h["chat.post"]!(hn.ctx, { threadId: started.thread.threadId, body: "hi", mentions: [{ kind: "agent", id: DRAFTER }], idempotencyKey: "v6" });
  assert.ok(fine.message);
});
