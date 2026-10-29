// The MCP client against a real server process (stdio) and a real HTTP server (JSON and event-stream replies): initialize, list tools with paging, call a tool, a server error, a server that exits,
// a call that times out.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { McpClient, McpError, httpTransport, resultText, stdioTransport } from "../src/mcp-client/index.ts";
import type { FetchPort, ProcLike } from "../src/mcp-client/index.ts";

const port: FetchPort = (url, init) => fetch(url, init) as unknown as ReturnType<FetchPort>;

const SERVER = new URL("../fixtures/mcp/echo-server.mjs", import.meta.url).pathname;

function launch(argv: string[]): ProcLike {
  const child = spawn(argv[0]!, argv.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
  let tail = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d: string) => { tail = (tail + d).slice(-2000); });
  return {
    stdout: child.stdout, write: (d) => new Promise((ok, bad) => child.stdin.write(d, (e) => (e ? bad(e) : ok()))), endInput: () => child.stdin.end(),
    exited: new Promise((r) => child.once("close", r)), stderrTail: () => tail, kill: (s) => { child.kill(s); },
  };
}

test("stdio: initialize, list tools, call a tool, read the result as text", async () => {
  const c = await McpClient.connect(stdioTransport(launch([process.execPath, SERVER])));
  assert.equal(c.serverName, "echo-server");
  const tools = await c.listTools();
  assert.deepEqual(tools.map((t) => [t.name, t.readOnly]), [["echo", true], ["shout", false], ["whoami", true], ["write_outside", false]]);
  assert.equal(resultText(await c.callTool("shout", { text: "quiet" })), "QUIET");
  await assert.rejects(c.callTool("nope", {}), (e: unknown) => e instanceof McpError && e.code === "mcp.server_error");
  await c.close();
  await assert.rejects(c.listTools(), (e: unknown) => e instanceof McpError && e.code === "mcp.closed");
});

test("stdio: a server that exits fails the calls waiting on it and says why", async () => {
  const c = await McpClient.connect(stdioTransport(launch([process.execPath, "-e", `
    const rl = require("readline").createInterface({ input: process.stdin });
    rl.on("line", (l) => { const m = JSON.parse(l); if (m.method === "initialize") console.log(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { serverInfo: { name: "x" } } })); else if (m.method === "tools/call") { console.error("boom: out of cheese"); process.exit(3); } });`])));
  await assert.rejects(c.callTool("x", {}), (e: unknown) => e instanceof McpError && e.code === "mcp.closed" && /out of cheese/.test(e.message));
});

test("a call that never answers times out", async () => {
  const c = await McpClient.connect(stdioTransport(launch([process.execPath, "-e", `
    const rl = require("readline").createInterface({ input: process.stdin });
    rl.on("line", (l) => { const m = JSON.parse(l); if (m.method === "initialize") console.log(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: {} })); });`])), );
  await assert.rejects(c.request("tools/list", {}, 200), (e: unknown) => e instanceof McpError && e.code === "mcp.timeout");
  await c.close();
});

function serve(handler: (body: any, res: http.ServerResponse, req: http.IncomingMessage) => void): Promise<{ url: string; close(): Promise<void>; seen: Array<{ method: string; headers: http.IncomingHttpHeaders }> }> {
  const seen: Array<{ method: string; headers: http.IncomingHttpHeaders }> = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method ?? "", headers: req.headers });
    let raw = "";
    req.on("data", (d) => { raw += d; });
    req.on("end", () => { if (req.method === "DELETE") { res.writeHead(204).end(); return; } handler(raw === "" ? {} : JSON.parse(raw), res, req); });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`, seen, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) })));
}

test("http: JSON replies and event-stream replies, the session id and a header from the caller are sent on", async () => {
  const s = await serve((m, res) => {
    if (m.method === "initialize") { res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "sess-1" }).end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { serverInfo: { name: "remote", version: "2" } } })); return; }
    if (m.method === "notifications/initialized") { res.writeHead(202).end(); return; }
    if (m.method === "tools/list") { res.writeHead(200, { "content-type": "text/event-stream" }).end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "lookup", description: "d", inputSchema: { type: "object" } }] } })}\n\n`); return; }
    if (m.method === "tools/call") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `found ${m.params.arguments.q}` }] } })); return; }
    res.writeHead(404).end();
  });
  try {
    const c = await McpClient.connect(httpTransport({ url: s.url, fetch: port, headers: () => ({ authorization: "Bearer from-the-vault" }) }));
    assert.equal(c.serverName, "remote");
    assert.deepEqual((await c.listTools()).map((t) => t.name), ["lookup"]);
    assert.equal(resultText(await c.callTool("lookup", { q: "dana" })), "found dana");
    assert.equal(s.seen[2]!.headers["mcp-session-id"], "sess-1");
    assert.equal(s.seen[2]!.headers["authorization"], "Bearer from-the-vault");
    await c.close();
    assert.equal(s.seen.at(-1)!.method, "DELETE");
  } finally { await s.close(); }
});

test("http: a server that answers 401 fails the connect with its status", async () => {
  const s = await serve((_m, res) => { res.writeHead(401).end("no key"); });
  try { await assert.rejects(McpClient.connect(httpTransport({ url: s.url, fetch: port })), /401/); } finally { await s.close(); }
});
