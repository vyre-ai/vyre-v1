// A CLI engine's first call through the MCP door (13 Nov 2026): the call is written from the tool's description, so it has no key, and it is accepted by the real validators. The door gives a CLI call no turn id,
// so its key is random for each call: two identical calls act twice (a request id is not an identity, it restarts when a client reconnects).
import test from "node:test";
import assert from "node:assert/strict";
import { createMcpServer } from "../../../agent/src/mcp/index.ts";
import type { McpCaller } from "../../../agent/src/mcp/index.ts";
import { loadGenerated, validatingInvoke } from "../../../agent/src/tools/harness.ts";

const g = loadGenerated();
const driver: McpCaller = {
  kind: "driver",
  sessionId: "ses_drv",
  space: "spc_1",
  principal: { kind: "agent", id: "agt_intake" },
  actingFor: "usr_dana",
  threadId: "thr_1",
  runId: "run_1",
  traceId: "a".repeat(32),
};

test("a CLI engine's artifact_publish with no key is accepted through the MCP door, with a key of the layer's own", async () => {
  const { invoke, sent } = validatingInvoke(g.caps);
  const server = createMcpServer({ catalog: g.catalog, defaults: g.defaults, invoke, open: async () => driver });
  let n = 0;
  const post = async (method: string, params?: unknown) =>
    JSON.parse(
      (
        await server.handle({
          method: "POST",
          headers: { authorization: "Bearer drv" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, ...(params === undefined ? {} : { params }) }),
        })
      ).body,
    );
  const list = (await post("tools/list")).result.tools as Array<{
    name: string;
    inputSchema: { properties: object; required?: string[] };
  }>;
  const tool = list.find((t) => t.name === "artifact_publish");
  assert.ok(tool, "listed to a CLI engine");
  assert.equal("idempotencyKey" in tool.inputSchema.properties, false);
  assert.deepEqual(tool.inputSchema.required, ["title"]);
  const args = { title: "Weekly report", html: "<h1>Report</h1>" };
  const a = await post("tools/call", { name: "artifact_publish", arguments: args });
  const b = await post("tools/call", { name: "artifact_publish", arguments: args });
  assert.ok(!a.result.isError && !b.result.isError, JSON.stringify([a.result, b.result]));
  const keys = sent.map((x) => (x.input as { idempotencyKey?: string }).idempotencyKey);
  assert.equal(sent.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.match(keys[0] ?? "", /^ag:r:/);
});
