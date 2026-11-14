// The connect tool as a model meets it (b-connect, 14 Nov 2026): listed from the first turn, a first call written from its description alone is accepted, and what it costs in tokens is measured and held.
// @reads /generated/mcp-tools.json
// @reads /docs/frozen/agent-tools.md
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMcpServer } from "../src/mcp/index.ts";
import type { McpCaller } from "../src/mcp/index.ts";
import { loadGenerated, validatingInvoke } from "../src/tools/harness.ts";
import { slimTool } from "../src/drivers/api/slim.ts";
import { parseDefaultTools } from "../src/tools/catalog.ts";
import { estimateTokens } from "../../lib/reply-format.ts";
import { TELL } from "../../lib/connect-tell.ts";

const g = loadGenerated();
const driver: McpCaller = {
  kind: "driver",
  sessionId: "ses_drv",
  space: "spc_1",
  principal: { kind: "agent", id: "agt_dex" },
  actingFor: "usr_asker",
  threadId: "thr_1",
  runId: "run_1",
  traceId: "a".repeat(32),
};
const tool = (
  JSON.parse(readFileSync(new URL("../../generated/mcp-tools.json", import.meta.url), "utf8")) as {
    tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
  }
).tools.find((t) => t.name === "vault_connect")!;

/** The tool's description and its schema as a model is shown them: every call of a turn re-sends this. */
const shown = (): string => {
  const s = slimTool({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema } as never);
  return JSON.stringify({ name: s.name, description: s.description, input_schema: s.inputSchema });
};

test("the tool is in the default list, so a model has it on its first turn", () => {
  const defaults = parseDefaultTools(
    readFileSync(new URL("../../docs/frozen/agent-tools.md", import.meta.url), "utf8"),
  );
  assert.ok(defaults.has("vault_connect"));
});

test("a description a model picks it from: it names is-X-connected and connect-X, and says what the person sees", () => {
  assert.match(tool.description, /is X connected/i);
  assert.match(tool.description, /connect X/i);
  assert.match(tool.description, /one card/i);
});

test("its description and schema cost a model about 105 tokens, and a result about 55", () => {
  const cost = estimateTokens(shown());
  console.log(`vault_connect as shown to a model: ${cost} tokens`);
  assert.ok(cost <= 110, `the tool costs ${cost} tokens`);
  const results = Object.values(TELL).flatMap((f) => [f("Fathom"), f("Google Calendar")]);
  const worst = Math.max(
    ...results.map((r) =>
      estimateTokens(JSON.stringify({ status: "waiting_person", requestId: "vrq_0123456789abcdef01", tell: r })),
    ),
  );
  console.log(`vault_connect worst result: ${worst} tokens`);
  assert.ok(worst <= 60, `a result costs ${worst} tokens`);
});

test("a CLI engine's first call, written from the description with no key, is accepted by the real validators", async () => {
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
  const t = list.find((x) => x.name === "vault_connect");
  assert.ok(t, "listed to a CLI engine from the start");
  assert.equal("idempotencyKey" in t.inputSchema.properties, false);
  assert.deepEqual(t.inputSchema.required, ["service"]);
  const r = await post("tools/call", { name: "vault_connect", arguments: { service: "Fathom" } });
  assert.ok(!r.result.isError, JSON.stringify(r.result));
  assert.equal(sent.length, 1);
  assert.equal((sent[0]!.input as { service?: string }).service, "Fathom");
});
