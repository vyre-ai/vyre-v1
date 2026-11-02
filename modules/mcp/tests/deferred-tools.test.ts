// A capability that only refuses (host/src/routes/deferred.ts) is never offered to an agent, on the MCP server or in a turn: the list follows DEFERRED_CAPS, so Sites comes back when its handlers go live, with no name to remove.
import test from "node:test";
import assert from "node:assert/strict";
import "../../sites/impl.ts";
import "../../vault/impl.ts";
import { DEFERRED_CAPS } from "../../../host/src/routes/deferred.ts";
import { toolsFor, searchTools } from "../../../agent/src/tools/access.ts";
import { createEngineApiTools } from "../../engine/api-tools.ts";
import { loadGenerated } from "../projections.ts";

const ctx = { space: "spc_1", agentId: "agt_1", asker: "per_1", thread: { threadId: "T1", kind: "chat" as const, planMode: false } };
const offered = (): { names: string[]; searchable: ReturnType<typeof toolsFor>["searchable"] } => {
  const g = loadGenerated();
  const set = toolsFor({ catalog: g.catalog, defaults: g.defaults, levelFor: () => null, canEngineer: () => true }, ctx);
  return { names: [...set.listed, ...set.searchable].map((t) => t.name), searchable: set.searchable };
};
const inTurn = async (): Promise<string[]> => {
  const tools = createEngineApiTools({ invoke: (async () => ({ status: "ok", output: {}, traceId: "t" })) as never, space: "spc_1", system: async () => [] });
  const spec = { threadId: "T1", agent: { id: "agt_1" }, asker: "per_1", turnId: "turn_1", traceId: "t" };
  return (await tools.context(spec as never, { threadId: "T1", turnId: "turn_1", agent: spec.agent, trigger: null, history: [], listeners: [] } as never)).tools.map((t) => t.name);
};

test("the MCP list and tool search leave out every capability that only refuses, and keep the rest", () => {
  const { names, searchable } = offered();
  assert.ok(DEFERRED_CAPS.has("sites.list") && DEFERRED_CAPS.has("vault.import"), "this test needs the deferred handlers registered");
  assert.deepEqual(names.filter((n) => n.startsWith("sites_") || n.startsWith("vault_import")), []);
  assert.deepEqual(searchTools(searchable, "site deploy staging", 50).filter((t) => t.name.startsWith("sites_")), []);
  assert.ok(names.includes("forms_publish"), "a real tool stays");
});

test("a turn is not offered them either", async () => {
  const names = await inTurn();
  assert.deepEqual(names.filter((n) => n.startsWith("sites_") || n.startsWith("vault_import")), []);
  assert.ok(names.length > 0, "the turn has tools");
});

test("the list follows the deferred set: a capability that goes live comes back with no other change", async () => {
  DEFERRED_CAPS.delete("sites.build");
  try {
    assert.ok(offered().names.includes("sites_build"));
    assert.ok((await inTurn()).includes("sites_build"));
  } finally { DEFERRED_CAPS.add("sites.build"); }
  assert.ok(!offered().names.includes("sites_build"));
});

test("a call by name still finds the tool, so it gets its plain refusal", () => {
  assert.equal(loadGenerated().catalog.byName("sites_build")?.cap, "sites.build");
});
