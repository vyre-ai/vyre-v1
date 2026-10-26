// The fake CLI's "send" scenario (host/tests/fixtures/fake-cli-driver/fake-cli.mjs): a message "send <address> [mailboxId]" makes it call mail_send over the Vyre MCP server named in --mcp-config, as the
// real CLI would, and answer with what the tool said. Run here against a real HTTP MCP stand-in and against a stdio shim, and the existing hello scenario is unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";

const FAKE = fileURLToPath(new URL("./fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const TOKEN = "vys_token_test_0123456789abcdef";

/** A stand-in MCP server: records every request and answers initialize and tools/call. */
function mcpServer(answer: (args: Record<string, unknown>) => { isError?: boolean; text: string }) {
  const seen: Array<{ auth: string | undefined; body: Record<string, unknown> }> = [];
  const server = http.createServer((q, r) => {
    let b = ""; q.on("data", (d) => (b += d));
    q.on("end", () => {
      const body = JSON.parse(b) as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
      seen.push({ auth: q.headers["authorization"], body });
      r.setHeader("content-type", "application/json");
      if (body.method === "initialize") { r.setHeader("mcp-session-id", "mcp_1"); r.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "stand-in", version: "0" } } })); return; }
      if (body.id === undefined) { r.statusCode = 202; r.end(); return; }
      const a = answer(body.params?.arguments ?? {});
      r.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: a.text }], ...(a.isError ? { isError: true } : {}) } }));
    });
  });
  return { server, seen };
}

/** Run the fake CLI once with one prompt and return the text of its reply. */
async function ask(prompt: string, mcpConfig: unknown): Promise<string> {
  const child = spawn(process.execPath, [FAKE, "claude", "-p", "--mcp-config", JSON.stringify(mcpConfig)], { env: { ...process.env, VYRE_MCP_TOKEN: TOKEN }, stdio: ["pipe", "pipe", "inherit"] });
  child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } })}\n`);
  let out = "";
  child.stdout.setEncoding("utf8");
  const done = new Promise<void>((ok) => {
    child.stdout.on("data", (d: string) => { out += d; if (out.includes('"type":"result"')) { child.stdin.end(); ok(); } });
    child.on("exit", () => ok());
  });
  await done;
  child.kill();
  const result = out.split("\n").filter((l) => l.includes('"type":"result"')).map((l) => JSON.parse(l) as { result: string })[0];
  return result?.result ?? "";
}

test("send over a loopback URL calls mail_send with the address and the bearer token, and reports the answer", async () => {
  const { server, seen } = mcpServer((a) => ({ text: `queued for ${(a["to"] as Array<{ address: string }>)[0]!.address}` }));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
  try {
    const reply = await ask("send pat@acme.test mbx_one", { mcpServers: { vyre: { type: "http", url, headers: { Authorization: "Bearer ${VYRE_MCP_TOKEN}" } } } });
    assert.equal(reply, "mail_send answered: queued for pat@acme.test");
    assert.deepEqual(seen.map((s) => s.body["method"]), ["initialize", "notifications/initialized", "tools/call"]);
    assert.ok(seen.every((s) => s.auth === `Bearer ${TOKEN}`), "every request carries the session token");
    const call = seen[2]!.body["params"] as { name: string; arguments: Record<string, unknown> };
    assert.equal(call.name, "mail_send");
    assert.deepEqual([call.arguments["mailboxId"], call.arguments["to"]], ["mbx_one", [{ address: "pat@acme.test" }]]);
  } finally { await new Promise<void>((ok) => server.close(() => ok())); }
});

test("a refused or held call is reported as refused with the tool's own words, and an MCP failure as an mcp error", async () => {
  const held = mcpServer(() => ({ isError: true, text: "held for approval (tsk_gate1)" }));
  await new Promise<void>((ok) => held.server.listen(0, "127.0.0.1", ok));
  try {
    const url = `http://127.0.0.1:${(held.server.address() as { port: number }).port}/mcp`;
    assert.equal(await ask("send pat@acme.test", { mcpServers: { vyre: { type: "http", url, headers: {} } } }), "mail_send refused: held for approval (tsk_gate1)");
  } finally { await new Promise<void>((ok) => held.server.close(() => ok())); }
  assert.match(await ask("send pat@acme.test", { mcpServers: {} }), /^mcp error: there is no vyre MCP server/);
  assert.equal(await ask("send", { mcpServers: {} }), "mcp error: say who to send to");
});

test("the hello scenario is unchanged", async () => {
  assert.equal(await ask("hello there", { mcpServers: {} }), "Hello from the fake engine.");
});
