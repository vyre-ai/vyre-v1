// Skills and outside connections on a CLI engine, on a booted daemon (skills audit changes 1, 4 and 6). The engine is the fake claude of host/tests/fixtures/fake-cli-driver, started in the real
// sandbox (bubblewrap on Linux, Seatbelt on a Mac) with the argv the driver builds; it reaches Vyre over the MCP bridge the way Claude Code does. Nothing inside the daemon is faked.
//   - a Space skill and the agent's own skill are written into the chat's work folder where Claude Code looks for its own, with their files, and Skill is an allowed tool
//   - a remote MCP connection (a fake server on loopback) is called from the CLI through Vyre's MCP: a read goes through, a tool that may change things is refused as a read and waits at the Gate
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGuardedFetch } from "../lib/net-guard.ts";
import { boot, connect, hostLog, makeAgent, ok, post, seededDir, stop } from "./support/eco-live.ts";

const FAKE_CLI = fileURLToPath(new URL("../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const mac = process.platform === "darwin" && spawnSync("/usr/bin/sandbox-exec", ["-n", "no-network", "/usr/bin/true"]).status === 0;
const sandboxed: string | false = mac || (process.platform === "linux" && process.env["VYRE_HEAVY_DOCKER"] === "1") ? false : "needs a Mac, or VYRE_HEAVY_DOCKER=1 with bubblewrap (the CLI runs in the real sandbox)";

interface Fake { url: string; log: string[]; close(): Promise<void> }
/** A remote MCP server: list_files only reads, delete_file changes things. */
function fakeServer(): Promise<Fake> {
  const log: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += String(c); });
    req.on("end", () => {
      if (req.url !== "/mcp" || req.method !== "POST") { res.writeHead(404); res.end(); return; }
      const m = JSON.parse(body) as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
      log.push(m.method === "tools/call" ? `call ${m.params?.name} ${JSON.stringify(m.params?.arguments ?? {})}` : m.method);
      const reply = (result: unknown): void => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result })); };
      if (m.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-files", version: "1" } });
      if (m.method === "tools/list") return reply({ tools: [
        { name: "list_files", description: "List files.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
        { name: "delete_file", description: "Delete a file.", inputSchema: { type: "object", properties: { name: { type: "string" } } } },
      ] });
      if (m.method === "tools/call") return reply({ content: [{ type: "text", text: m.params?.name === "list_files" ? "a.txt, b.txt" : "deleted" }] });
      res.writeHead(202); res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as { port: number }).port;
    resolve({ url: `http://127.0.0.1:${port}/mcp`, log, close: () => new Promise<void>((r) => server.close(() => r())) });
  }));
}

test("a CLI engine: the Space's and the agent's own skills are in its folder where Claude Code looks, and it calls a remote connection through Vyre's MCP, a change waiting at the Gate", { skip: sandboxed, timeout: 120_000 }, async () => {
  const fake = await fakeServer();
  const d = await boot(seededDir(), null as never, { engineOpenSession: undefined, engineCli: { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] }, mcpFetch: createGuardedFetch({ own: true }) });
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Clerk");
    await ok(d, "skills.add", { idempotencyKey: "csc-s1", text: "---\nname: filing-rules\ndescription: How this firm files a new matter.\n---\n\nRun scripts/check.sh first.\n", files: { "scripts/check.sh": "#!/bin/sh\necho checked\n" } });
    const agent = (await ok(d, "agents.get", { agentId })).agent;
    const skillsDir = (await ok(d, "files.list", { section: "space", folder: agent.folderId })).folders.find((f: { name: string }) => f.name === "skills").folderId as string;
    const own = (await ok(d, "files.folder.create", { idempotencyKey: "csc-f1", parentId: skillsDir, name: "clerk-notes" })).folder.folderId as string;
    await ok(d, "files.create", { idempotencyKey: "csc-f2", folderId: own, name: "SKILL.md", kind: "text", mime: "text/markdown", content: { text: "---\nname: clerk-notes\ndescription: The clerk's own way of taking notes.\n---\n\nShort lines.\n" } });
    await ok(d, "plugins.connection.add", { idempotencyKey: "csc-c1", name: "files", scope: "space", url: fake.url });
    const threadId = (await ok(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "csc-start" })).thread.threadId as string;

    // skills: written where Claude Code reads its own, with their files, and the CLI may open them
    const seen = await post(d, threadId, agentId, "skillscheck", "csc-1");
    assert.equal(seen, "skills: clerk-notes=The clerk's own way of taking notes.=; filing-rules=How this firm files a new matter.=scripts/check.sh | Skill allowed: true", seen);

    // a read of the connection, from the CLI, through Vyre's MCP
    const read = await post(d, threadId, agentId, `tool mcp_read ${JSON.stringify({ agentId, server: "files", tool: "list_files" })}`, "csc-2");
    assert.match(read, /^mcp_read answered: /, read);
    assert.match(read, /a\.txt, b\.txt/);
    assert.ok(fake.log.includes("call list_files {}"), fake.log.join("; "));

    // a tool that may change things is not a read
    const sneaky = await post(d, threadId, agentId, `tool mcp_read ${JSON.stringify({ agentId, server: "files", tool: "delete_file", input: { name: "a.txt" } })}`, "csc-3");
    assert.match(sneaky, /may change things.*mcp_call/, sneaky);
    // through mcp_call it waits at the Gate for the person: the server is not called
    const change = await post(d, threadId, agentId, `tool mcp_call ${JSON.stringify({ agentId, server: "files", tool: "delete_file", input: { name: "a.txt" }, idempotencyKey: "csc-del" })}`, "csc-4");
    assert.doesNotMatch(change, /^mcp_call answered: deleted/, change);
    assert.ok(!fake.log.some((l) => l.startsWith("call delete_file")), `the change did not run: ${fake.log.join("; ")}`);
    const holds = (await ok(d, "gate.holds.list", {})).holds as Array<{ capName: string; principal: { kind: string; id: string }; actingFor?: string; state: string }>;
    assert.ok(holds.some((h) => h.capName === "engine.mcp.call" && h.principal.id === agentId && h.state === "held"), JSON.stringify(holds).slice(0, 600));
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 2000) : e, hostLog(d)); throw e; } finally { await stop(d); await fake.close(); }
});
