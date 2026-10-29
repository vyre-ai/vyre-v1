import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createMcpRoute } from "./mcp.ts";

async function serve(runtime: Parameters<typeof createMcpRoute>[0]): Promise<{ url: string; close(): Promise<void> }> {
  const route = createMcpRoute(runtime);
  const server = http.createServer((req, res) => {
    if (!route.handle(req, res)) { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/mcp`, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

test("the daemon MCP route forwards protocol requests and response headers to the live module runtime", async () => {
  const seen: unknown[] = [];
  const s = await serve(() => ({
    async handle(req) {
      seen.push(req);
      return { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "ses_1" }, body: '{"jsonrpc":"2.0","id":1,"result":{}}' };
    },
  }));
  try {
    const r = await fetch(s.url, { method: "POST", headers: { authorization: "Bearer tok", "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("mcp-session-id"), "ses_1");
    assert.deepEqual(JSON.parse(await r.text()), { jsonrpc: "2.0", id: 1, result: {} });
    assert.equal((seen[0] as { method: string }).method, "POST");
    assert.equal((seen[0] as { headers: Record<string, string> }).headers.authorization, "Bearer tok");
  } finally { await s.close(); }
});

test("the daemon MCP route is closed when the live runtime is absent", async () => {
  const s = await serve(() => null);
  try { assert.equal((await fetch(s.url, { method: "POST", body: "{}" })).status, 503); }
  finally { await s.close(); }
});
