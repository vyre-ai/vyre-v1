// The MCP socket bridge (ruling 61), on this machine with a real unix socket and a fake endpoint: a line in is posted with the session token as the bearer and the reply comes back as a line; a wrong
// token is closed before anything is posted; an endpoint that is down gives a JSON-RPC error, not a hang; the shim file and the socket are in the scratch folder and the socket goes with close().
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { openMcpBridge, SHIM_SOURCE } from "../mcp-bridge.ts";

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-mcpb-")));

function lines(c: net.Socket, n: number): Promise<string[]> {
  return new Promise((ok) => {
    const got: string[] = [];
    let buf = "";
    c.setEncoding("utf8");
    c.on("data", (d: string) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { got.push(buf.slice(0, i)); buf = buf.slice(i + 1); if (got.length === n) ok(got); } });
    c.on("close", () => ok(got));
  });
}

test("a line is posted to the endpoint with the session token, and the reply is a line", async () => {
  const seen: Array<{ auth: string | null; body: string }> = [];
  const f = (async (_u: string, init: RequestInit) => {
    seen.push({ auth: new Headers(init.headers).get("authorization"), body: String(init.body) });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), { headers: { "content-type": "application/json", "mcp-session-id": "s1" } });
  }) as unknown as typeof fetch;
  const b = await openMcpBridge({ url: "http://127.0.0.1:1/mcp", token: "tok" }, { scratch, fetch: f });
  assert.ok(fs.existsSync(path.join(scratch, "mcp-shim.mjs")));
  assert.equal(fs.readFileSync(path.join(scratch, "mcp-shim.mjs"), "utf8"), SHIM_SOURCE);
  assert.ok(b.socket.startsWith(scratch));
  const c = net.connect(b.socket);
  const got = lines(c, 1);
  c.write(`${JSON.stringify({ auth: "tok" })}\n${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
  assert.deepEqual(JSON.parse((await got)[0]!), { jsonrpc: "2.0", id: 1, result: { ok: true } });
  assert.equal(seen[0]!.auth, "Bearer tok");
  assert.match(seen[0]!.body, /tools\/list/);
  c.destroy();
  await b.close();
  assert.ok(!fs.existsSync(b.socket));
});

test("a wrong token is closed before anything is posted", async () => {
  let posted = 0;
  const f = (async () => { posted++; return new Response("{}"); }) as unknown as typeof fetch;
  const b = await openMcpBridge({ url: "http://127.0.0.1:1/mcp", token: "tok" }, { scratch, fetch: f });
  const c = net.connect(b.socket);
  const got = lines(c, 1);
  c.write(`${JSON.stringify({ auth: "nope" })}\n${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
  assert.deepEqual(await got, []);
  assert.equal(posted, 0);
  await b.close();
});

test("an event-stream reply gives one line per event, and an endpoint that is down gives an error line", async () => {
  const sse = (async () => new Response('data: {"id":1}\n\ndata: {"id":2}\n\n', { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
  const b = await openMcpBridge({ url: "http://x/mcp", token: "t" }, { scratch, fetch: sse });
  const c = net.connect(b.socket);
  const got = lines(c, 2);
  c.write(`${JSON.stringify({ auth: "t" })}\n{"jsonrpc":"2.0","id":1,"method":"x"}\n`);
  assert.deepEqual((await got).map((l) => (JSON.parse(l) as { id: number }).id), [1, 2]);
  await b.close();
  const down = (async () => { throw new Error("refused"); }) as unknown as typeof fetch;
  const b2 = await openMcpBridge({ url: "http://x/mcp", token: "t" }, { scratch, fetch: down });
  const c2 = net.connect(b2.socket);
  const g2 = lines(c2, 1);
  c2.write(`${JSON.stringify({ auth: "t" })}\n{"jsonrpc":"2.0","id":1,"method":"x"}\n`);
  const failure = JSON.parse((await g2)[0]!) as { id: unknown; error?: { message?: string } };
  assert.equal(failure.id, 1, "the client can settle the request instead of waiting forever");
  assert.match(failure.error?.message ?? "", /could not be reached/);
  await b2.close();
});
