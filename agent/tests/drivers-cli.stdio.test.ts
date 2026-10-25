// A sandboxed engine reaches Vyre through a stdio shim instead of the loopback URL (ruling 61): the engine's MCP config names the command and the token variable, never the token.
import test from "node:test";
import assert from "node:assert/strict";
import { mcpConfigJson } from "../src/drivers/cli/claude.ts";
import { CLI_ADAPTERS } from "../src/drivers/cli/driver.ts";

test("with a stdio endpoint the engine's MCP config runs the shim and names the token variable, never its value", () => {
  const cfg = JSON.parse(mcpConfigJson("http://127.0.0.1:1/mcp", { command: "node", args: ["/opt/vyre/shim.ts", "/run/vyre/m.sock"] })) as { mcpServers: { vyre: Record<string, unknown> } };
  assert.deepEqual(cfg.mcpServers.vyre, { type: "stdio", command: "node", args: ["/opt/vyre/shim.ts", "/run/vyre/m.sock"], env: { VYRE_MCP_TOKEN: "${VYRE_MCP_TOKEN}" } });
  const base = { model: null, resume: null, mcpUrl: "http://x", planMode: false, workFolder: null, system: null };
  const codex = CLI_ADAPTERS.codex.command({ ...base, mcpStdio: { command: "node", args: ["/h", "/s"] } });
  assert.ok(codex.some((a) => a === 'mcp_servers.vyre.command="node"'));
  assert.ok(codex.some((a) => a === 'mcp_servers.vyre.args=["/h", "/s"]'));
  assert.ok(!codex.some((a) => a.startsWith("mcp_servers.vyre.url=")));
  assert.ok(CLI_ADAPTERS.codex.command(base).some((a) => a.startsWith("mcp_servers.vyre.url=")), "without it the URL form is unchanged");
});
