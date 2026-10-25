// The per-session MCP socket and stdio shim (ruling 61): a sandboxed CLI engine reaches Vyre's tools through a unix socket and a stdio shim, with the session token still checked by the server.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { createMcpServer, listenMcpSocket, runShim } from "../src/mcp/index.ts";
import type { McpCaller } from "../src/mcp/index.ts";
import { fakeInvoke, loadGenerated } from "../src/tools/harness.ts";
import { mcpConfigJson } from "../src/drivers/cli/claude.ts";
import { CLI_ADAPTERS } from "../src/drivers/cli/driver.ts";

const TOKEN = "vys_tok_0123456789abcdef";
const caller: McpCaller = { kind: "driver", sessionId: "ses_1", space: "spc_1", principal: { kind: "agent", id: "agt_intake" }, actingFor: "per_dana", threadId: "thr_1", runId: "run_1", traceId: "a".repeat(32) };

async function rig() {
  const g = loadGenerated();
  const fake = fakeInvoke(g.caps);
  const server = createMcpServer({ catalog: g.catalog, defaults: g.defaults, invoke: fake.invoke, open: async (t) => (t === TOKEN ? caller : null) });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcps-"));
  const sock = await listenMcpSocket(server, path.join(dir, "m.sock"));
  return { server, sock, dir };
}

async function ask(socketPath: string, token: string, messages: unknown[]): Promise<unknown[]> {
  const input = new PassThrough();
  const out: string[] = [];
  const run = runShim({ socketPath, token, input, write: (l) => out.push(l) });
  for (const m of messages) input.write(`${JSON.stringify(m)}\n`);
  input.end();
  await run;
  return out.map((l) => JSON.parse(l) as unknown);
}

test("the shim carries initialize, tools/list and a notification through the socket to the same MCP server", async () => {
  const r = await rig();
  const out = await ask(r.sock.path, TOKEN, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude", version: "0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ]) as Array<{ id: number; result: { tools?: unknown[]; serverInfo?: unknown } }>;
  assert.equal(out.length, 2, "a notification gets no answer");
  assert.equal(out[0]?.id, 1);
  assert.ok(out[0]?.result.serverInfo);
  assert.equal(out[1]?.id, 2);
  assert.ok((out[1]?.result.tools?.length ?? 0) > 0);
  await r.sock.close();
});

test("a wrong token is refused by the server, and the shim says so in JSON-RPC instead of hanging", async () => {
  const r = await rig();
  const out = await ask(r.sock.path, "vys_wrong", [{ jsonrpc: "2.0", id: 7, method: "tools/list" }]) as Array<{ id: number; error?: { message: string } }>;
  assert.equal(out[0]?.id, 7);
  assert.match(out[0]?.error?.message ?? "", /refused/);
  await r.sock.close();
});

test("the socket is for the session's person only (0600) and closing removes it", async () => {
  const r = await rig();
  assert.equal(fs.statSync(r.sock.path).mode & 0o777, 0o600);
  await r.sock.close();
  assert.equal(fs.existsSync(r.sock.path), false);
  await assert.rejects(listenMcpSocket({ handle: async () => ({ status: 200, headers: {}, body: "" }) }, "relative.sock"), /absolute/);
});

test("with a socket the engine's MCP config runs the shim as a stdio server and names the token variable, never its value", () => {
  const cfg = JSON.parse(mcpConfigJson("http://127.0.0.1:1/mcp", { command: "node", args: ["/opt/vyre/shim.ts", "/run/vyre/m.sock"] })) as { mcpServers: { vyre: { type: string; command: string; args: string[]; env: Record<string, string> } } };
  assert.deepEqual(cfg.mcpServers.vyre, { type: "stdio", command: "node", args: ["/opt/vyre/shim.ts", "/run/vyre/m.sock"], env: { VYRE_MCP_TOKEN: "${VYRE_MCP_TOKEN}" } });
  const argv = CLI_ADAPTERS.codex.command({ model: null, resume: null, mcpUrl: "http://x", mcpStdio: { command: "node", args: ["/h", "/s"] }, planMode: false, workFolder: null, system: null });
  assert.ok(argv.some((a) => a.startsWith("mcp_servers.vyre.command=")));
  assert.ok(!argv.some((a) => a.startsWith("mcp_servers.vyre.url=")));
});
