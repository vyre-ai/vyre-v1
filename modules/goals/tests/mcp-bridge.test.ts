// Claude Code and Codex reach Vyre through the MCP socket bridge (ruling 61, lane l-skills1): a line in on the session's unix socket is the MCP server's answer out. A goal's lead running in either
// CLI finds every goals tool the working-on-goals skill names with tool_search, sees its schema, and calls it as the agent acting for the owner.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { openMcpBridge } from "../../engine/mcp-bridge.ts";
import { createMcpServer } from "../../../agent/src/mcp/index.ts";
import type { McpCaller } from "../../../agent/src/mcp/index.ts";
import { fakeInvoke, loadGenerated } from "../../../agent/src/tools/harness.ts";

const g = loadGenerated();
const TOOLS = ["goals_get", "goals_progress_read", "goals_plan_update", "goals_checkin_post", "goals_ask", "goals_mark_stuck", "goals_complete", "goals_search_past", "goals_sources", "goals_step", "goals_folder"];

function rig() {
  const fake = fakeInvoke(g.caps);
  const lead: McpCaller = { kind: "driver", sessionId: "ses_lead", space: "spc_1", principal: { kind: "agent", id: "agt_labdesk" }, actingFor: "usr_irfad", threadId: "thr_goal", traceId: "a".repeat(32) };
  const server = createMcpServer({ catalog: g.catalog, defaults: g.defaults, invoke: fake.invoke, open: async (t) => (t === "tok" ? lead : null), now: () => 1_000_000 });
  // the bridge posts to the endpoint; here the endpoint is the server itself, so the whole path from the CLI's socket to a tool call is real
  const f = (async (_u: string, init: RequestInit) => {
    const r = await server.handle({ method: "POST", headers: Object.fromEntries(new Headers(init.headers).entries()), body: String(init.body) });
    return new Response(r.body, { status: r.status, headers: r.headers as Record<string, string> });
  }) as unknown as typeof fetch;
  return { fake, f };
}

async function session(b: { socket: string }, requests: unknown[]): Promise<any[]> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const c = net.connect(b.socket);
  const got: string[] = [];
  let buf = "";
  const done = new Promise<void>((ok) => {
    c.setEncoding("utf8");
    c.on("data", (d: string) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { got.push(buf.slice(0, i)); buf = buf.slice(i + 1); if (got.length === requests.length) ok(); } });
    c.on("close", () => ok());
  });
  c.write([{ auth: "tok" }, ...requests].map((x) => JSON.stringify(x)).join("\n") + "\n");
  await done;
  c.destroy();
  return got.map((l) => JSON.parse(l));
}

for (const cli of ["Claude Code", "Codex"]) {
  test(`${cli} finds and calls every goals tool through the MCP socket bridge`, async () => {
    const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-goals-mcp-")));
    const { fake, f } = rig();
    const b = await openMcpBridge({ url: "http://127.0.0.1:1/mcp", token: "tok" }, { scratch, fetch: f });
    try {
      let id = 0;
      const rpc = (method: string, params?: unknown) => ({ jsonrpc: "2.0", id: ++id, method, ...(params === undefined ? {} : { params }) });
      const replies = await session(b, [
        rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: cli, version: "1" } }),
        ...TOOLS.map((t) => rpc("tools/call", { name: "tool_search", arguments: { query: t } })),
        rpc("tools/call", { name: "goals_checkin_post", arguments: { goalId: "gol_a1b2c3", summary: "212, behind pace by 30." } }),
      ]);
      assert.equal(replies.length, TOOLS.length + 2, JSON.stringify(replies).slice(0, 400));
      // the bridge posts each line as it comes, so replies can arrive in any order: match them by id
      const byId = new Map(replies.map((r) => [r.id, r]));
      TOOLS.forEach((t, i) => assert.ok(JSON.stringify(byId.get(i + 2)).includes(`\\"name\\":\\"${t}\\"`), `${cli}: tool_search finds ${t}`));
      const last = byId.get(TOOLS.length + 2);
      assert.ok(!last.error && last.result?.isError !== true, JSON.stringify(last).slice(0, 400));
      const called = fake.calls.find((c: { cap: string }) => c.cap === "goals.report") as { cap: string; seed?: { principal?: { id: string }; actingFor?: string } } | undefined;
      assert.ok(called, `${cli}: goals_checkin_post reached goals.report`);
      if (called?.seed) { assert.equal(called.seed.principal?.id, "agt_labdesk"); assert.equal(called.seed.actingFor, "usr_irfad"); }
    } finally { await b.close(); }
  });
}
