// The engine names an agent with the one resolver: agents.get when the reader may see it, else access (someone else's private agent: "<Person> (Agent)"), never a raw id.
import test from "node:test";
import assert from "node:assert/strict";
import { UNNAMED_AGENT, agentDisplay } from "../agent-names.ts";

const refuse = (): Promise<never> => Promise.reject(Object.assign(new Error("That agent is private to the person it belongs to."), { code: "validation.not_found" }));

test("an agent the reader may see is named by agents.get, with its face", async () => {
  const call = async (cap: string): Promise<unknown> => (cap === "agents.get" ? { agent: { name: "Docs", face: "pick-3" } } : refuse());
  assert.deepEqual(await agentDisplay(call, "agt_docs"), { name: "Docs", face: "pick-3" });
});

test("someone else's private agent is named as its person", async () => {
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    if (cap === "agents.get") return refuse();
    assert.deepEqual(input, { principal: { kind: "agent", id: "agt_simba" } });
    return { principal: { name: "Olivia Reyes (Agent)" } };
  };
  assert.deepEqual(await agentDisplay(call, "agt_simba"), { name: "Olivia Reyes (Agent)" });
});

test("nobody can name it: a plain word, never the id", async () => {
  assert.deepEqual(await agentDisplay(refuse, "agt_gone"), { name: UNNAMED_AGENT });
});
