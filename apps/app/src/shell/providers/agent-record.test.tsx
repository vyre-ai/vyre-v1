// Opening an Agents row: the agent behind it opens on its own page; a row with no agent (Test) is reported missing, and the page that says so offers Set it up.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentRecord, agentOfRecord, listAgents } from "./agent-record.tsx";
import type { ShellRuntime } from "./runtime.tsx";

const fake = (name: string, pages: Array<{ agents: Array<{ agentId: string; name: string }>; next?: string }>) => {
  const asked: string[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    asked.push(cap);
    if (cap === "records.get") return { record: { fields: { name } } };
    const i = (input as { cursor?: string }).cursor;
    return pages[i ? 1 : 0];
  };
  return { call: call as ShellRuntime["call"], asked };
};

test("an Agents row finds its agent across pages of agents.list", async () => {
  const f = fake("Scout", [{ agents: [{ agentId: "agt_1", name: "Intake" }], next: "c2" }, { agents: [{ agentId: "agt_2", name: "scout " }] }]);
  assert.equal((await listAgents(f.call)).length, 2);
  const r = await agentOfRecord(f.call, "rec_1");
  assert.ok("agent" in r && r.agent.agentId === "agt_2");
});

test("Test is a row with no agent behind it: reported missing by name", async () => {
  const f = fake("Test", [{ agents: [{ agentId: "agt_1", name: "Intake" }] }]);
  assert.deepEqual(await agentOfRecord(f.call, "rec_t"), { missing: "Test" });
});

test("the not-set-up page is a loading frame until the agent is looked up", () => {
  const out = renderToStaticMarkup(<AgentRecord rt={{ call: async () => ({}) } as unknown as ShellRuntime} recordId="rec_t" />);
  assert.ok(!out.includes("agent-set-up"), "no Set it up button before the lookup answers");
});
