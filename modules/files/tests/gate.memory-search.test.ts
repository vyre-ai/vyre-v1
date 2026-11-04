// The read gate's files half on an agent's memory_search answer: a lesson, a fact, a note of the agent's memory folder and an empty answer all pass the gate; none of them is a 500.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { agentGate } from "../handlers/redact.ts";
import { redactWorld } from "../fixtures/redact-world.ts";

const OUTS: Record<string, unknown> = {
  empty: { hits: [], tookMs: 1 },
  lesson: { hits: [{ kind: "fact", factId: "fct_1", title: "Lesson", text: "Keep notes to Sara to three lines.", trueSince: 1, layer: "person", sourceLink: "/chats/thr_1#msg_3", score: 0.5, by: "agt_mira", byKind: "agent", versions: 1, lesson: { how: "refuse", used: 0, scope: "you" } }], tookMs: 1 },
  note: { hits: [{ kind: "note", noteId: "not_1", title: "AGENT", text: "Who I am", path: "agents/mira/AGENT.md", layer: "agent", sourceLink: "/files/fil_missing", score: 0.4 }], tookMs: 1 },
};
for (const [name, out] of Object.entries(OUTS)) {
  test(`memory.search answer (${name}) passes the gate for an agent`, async () => {
    const w = redactWorld(new DatabaseSync(":memory:"));
    const r = await agentGate(w.ctxFor({ kind: "service", id: "svc_host" }), { phase: "after", cap: "memory.search", input: { q: "notes", agentId: "agt_mira" }, output: out, who: { principal: { kind: "agent", id: "agt_mira" }, actingFor: "usr_dana" } });
    assert.ok("output" in r, JSON.stringify(r));
  });
}
