// memory.search as an agent working for a person (the agent's memory_search tool): a fresh agent with almost no memory and one holding lessons both get an answer, never a bare 500.
import test from "node:test";
import assert from "node:assert/strict";
import { capture, search } from "../handlers/facts.ts";
import { contractErrors, harness } from "../fixtures/harness.ts";
import type { MemCtx } from "../projections.ts";
import type { Responder } from "../fixtures/harness.ts";

const THREAD = "thr_notes";
const DANA = "usr_dana";
const AGENT = "agt_mira";
const say = (seq: number, body: string, who = { kind: "person", id: DANA }) => ({ messageId: `msg_${seq}`, threadSeq: seq, author: who, body });
const models = [{ provider: "openrouter", model: "google/gemini-flash-lite", allowed: true, pricing: { prompt: "0.0000001", completion: "0.0000004" } }];
const messages = [say(1, "Draft the October note for Sara."), say(2, "Hi Sara, here is how October closed.", { kind: "agent", id: AGENT }), say(3, "No, keep notes to Sara to three lines, the number first.")];
const chat: Record<string, Responder> = {
  "threads.get": () => ({ thread: { kind: "chat", starter: DANA, agents: [{ agentId: AGENT, mode: "lead" }], members: [{ kind: "person", id: DANA }] } }),
  "agents.get": () => ({ agent: { folderId: "fld_mira", ownerId: "usr_boss", captureMode: "auto" } }),
  "chat.messages.list": () => ({ messages, hasMore: false }),
  "engine.models.list": () => ({ models }),
  "engine.complete": () => ({ text: "{\"ops\":[]}", tokensIn: 10, tokensOut: 2 }),
};

for (const mode of ["keyword", "semantic", "hybrid"] as const) {
  test(`${mode}: the agent's search answers in a fresh agent and in one with lessons`, async () => {
    const h = harness({ respond: chat });
    const asAgent = harness({ raw: h.raw, respond: chat, principal: { kind: "agent", id: AGENT }, actingFor: DANA });
    (asAgent.ctx as MemCtx & { thread?: string }).thread = THREAD;
    const fresh = await search(asAgent.ctx, { q: "how do we write notes to Sara", agentId: AGENT, mode });
    assert.deepEqual(contractErrors("memory.search", "out", fresh), []);
    await capture(h.ctx, { threadId: THREAD, reason: "turn", agentId: AGENT, account: { ref: "#a", driver: "openrouter", kind: "api_key", payer: DANA } as never });
    for (const input of [{ q: "notes to Sara", agentId: AGENT, mode }, { q: "notes to Sara", mode }, { q: "lesson", layers: ["person" as const], mode }]) {
      const out = await search(asAgent.ctx, input);
      assert.deepEqual(contractErrors("memory.search", "out", out), [], JSON.stringify(out).slice(0, 300));
    }
  });
}
