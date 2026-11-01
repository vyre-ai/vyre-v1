// OAuth for a remote MCP connection on a booted daemon (rc.9): the MCP authorization flow against a fake server that is both the MCP server and its authorization server. Discovery from the 401,
// a registered public client, a PKCE challenge the fake checks, the code traded for tokens, the tokens sealed in the module table, a refresh when the server refuses the token. No real provider
// is reached.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createGuardedFetch } from "../lib/net-guard.ts";
import { boot, call, connect, makeAgent, ok, seededDir, stop } from "./support/eco-live.ts";

interface Fake { port: number; issue(challenge: string): string; revoke(access: string): void; log: string[]; close(): Promise<void> }

function fakeServer(): Promise<Fake> {
  const log: string[] = [];
  const codes = new Map<string, string>();          // code -> challenge
  const valid = new Set<string>();                  // access tokens the MCP endpoint accepts
  const refreshes = new Set<string>(["rt1"]);
  let issued = 0;
  let origin = "";
  const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += String(c); });
    req.on("end", () => {
      const url = new URL(req.url ?? "/", origin);
      log.push(`${req.method} ${url.pathname}`);
      if (url.pathname === "/.well-known/oauth-protected-resource") return json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [origin] });
      if (url.pathname === "/.well-known/oauth-authorization-server") return json(res, 200, { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`, code_challenge_methods_supported: ["S256"] });
      if (url.pathname === "/register") { const b = JSON.parse(body) as { redirect_uris: string[]; token_endpoint_auth_method: string }; assert.equal(b.token_endpoint_auth_method, "none"); return json(res, 201, { client_id: "client_abc", redirect_uris: b.redirect_uris }); }
      if (url.pathname === "/token") {
        const f = new URLSearchParams(body);
        if (f.get("grant_type") === "authorization_code") {
          const challenge = codes.get(f.get("code") ?? "");
          codes.delete(f.get("code") ?? "");
          const verifier = f.get("code_verifier") ?? "";
          const ok2 = challenge !== undefined && crypto.createHash("sha256").update(verifier).digest("base64url") === challenge && f.get("client_id") === "client_abc";
          if (!ok2) return json(res, 400, { error: "invalid_grant" });
          const access = `at${++issued}`; valid.add(access);
          return json(res, 200, { access_token: access, refresh_token: "rt1", expires_in: 3600 });
        }
        if (f.get("grant_type") === "refresh_token" && refreshes.has(f.get("refresh_token") ?? "")) { const access = `at${++issued}`; valid.add(access); return json(res, 200, { access_token: access, refresh_token: "rt1", expires_in: 3600 }); }
        return json(res, 400, { error: "invalid_grant" });
      }
      if (url.pathname === "/mcp") {
        const token = /^Bearer (.+)$/.exec(String(req.headers["authorization"] ?? ""))?.[1] ?? "";
        if (!valid.has(token)) return json(res, 401, { error: "unauthorized" }, { "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` });
        const m = JSON.parse(body) as { id?: number; method: string; params?: { name?: string } };
        log.push(`mcp ${m.method} as ${token}`);
        const reply = (result: unknown): void => json(res, 200, { jsonrpc: "2.0", id: m.id, result });
        if (m.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-oauth-mcp", version: "1" } });
        if (m.method === "tools/list") return reply({ tools: [{ name: "list_files", description: "List files.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }] });
        if (m.method === "tools/call") return reply({ content: [{ type: "text", text: "a.txt, b.txt" }] });
        res.writeHead(202); return res.end();
      }
      res.writeHead(404); res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as { port: number }).port;
    origin = `http://127.0.0.1:${port}`;
    resolve({ port, log, issue: (challenge) => { const code = `code_${crypto.randomBytes(6).toString("hex")}`; codes.set(code, challenge); return code; }, revoke: (a) => { valid.delete(a); }, close: () => new Promise<void>((r) => server.close(() => r())) });
  }));
}

test("a remote MCP connection signs in with OAuth: discovery, PKCE, the sealed token, and a refresh when the server refuses it", async () => {
  const fake = await fakeServer();
  const dir = seededDir();
  const d = await boot(dir, async () => ({ warm: true, async *send() { yield { type: "done" as const }; }, sendToolResult() {}, inject() {}, async cancel() {}, async close() {} }) as never, { mcpFetch: createGuardedFetch({ own: true }), vault: undefined });
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Ops");
    const url = `http://127.0.0.1:${fake.port}/mcp`;
    const bad = await call(d, "plugins.connection.add", { idempotencyKey: "o0", name: "files", scope: "space", url, auth: "oauth", headers: { "x-api-key": "#Olivia_Key.k" } });
    assert.equal(bad.status, 422, "an OAuth connection holds no key of its own");
    const conn = (await ok(d, "plugins.connection.add", { idempotencyKey: "o1", name: "files", scope: "space", url, auth: "oauth" })).connection;
    assert.equal(conn.auth, "oauth");

    // not signed in yet: the server says so, and nothing is guessed
    assert.equal((await ok(d, "engine.mcp.oauth_status", { connectionId: conn.connectionId })).signedIn, false);
    const before = (await ok(d, "engine.mcp.tools", { agentId })).servers.find((s: { key: string }) => s.key === "files");
    assert.equal(before.ok, false);
    assert.match(before.error, /needs to be signed in/);

    // start: the address carries a PKCE challenge, the state and the resource, and the client was registered once
    const redirectUri = "http://localhost:5173/oauth/callback";
    const started = await ok(d, "engine.mcp.oauth_start", { connectionId: conn.connectionId, redirectUri });
    const au = new URL(started.authUrl);
    assert.equal(au.origin + au.pathname, `http://127.0.0.1:${fake.port}/authorize`);
    assert.equal(au.searchParams.get("code_challenge_method"), "S256");
    assert.equal(au.searchParams.get("client_id"), "client_abc");
    assert.equal(au.searchParams.get("redirect_uri"), redirectUri);
    assert.equal(au.searchParams.get("resource"), url);
    assert.match(started.state, /^mcs_/);
    assert.equal(au.searchParams.get("state"), started.state);

    // the person approves in the browser; the server issues a code for that challenge; the callback finishes it, once
    const code = fake.issue(au.searchParams.get("code_challenge")!);
    const wrong = await call(d, "engine.mcp.oauth_complete", { state: started.state, code: "code_not_issued" });
    assert.notEqual(wrong.status, 200, "a code the server did not issue is refused");
    const restarted = await ok(d, "engine.mcp.oauth_start", { connectionId: conn.connectionId, redirectUri });
    const code2 = fake.issue(new URL(restarted.authUrl).searchParams.get("code_challenge")!);
    void code;
    assert.deepEqual(await ok(d, "engine.mcp.oauth_complete", { state: restarted.state, code: code2 }), { connectionId: conn.connectionId });
    const again = await call(d, "engine.mcp.oauth_complete", { state: restarted.state, code: code2 });
    assert.equal(again.status, 401, "the link works once");
    assert.equal((await ok(d, "engine.mcp.oauth_status", { connectionId: conn.connectionId })).signedIn, true);

    // signed in: the tools list, and a read runs with the token
    const server = (await ok(d, "engine.mcp.tools", { agentId })).servers.find((s: { key: string }) => s.key === "files");
    assert.equal(server.ok, true, JSON.stringify(server));
    assert.equal(server.oauth, true);
    assert.deepEqual(server.tools.map((t: { name: string; readOnly: boolean }) => [t.name, t.readOnly]), [["list_files", true]]);
    assert.ok(fake.log.some((l) => l === "mcp tools/list as at1"));

    // the server withdraws the token: the next read is refused once, a fresh token is made from the refresh token, and the read goes through
    fake.revoke("at1");
    const read = await ok(d, "engine.mcp.read", { agentId, server: "files", tool: "list_files" });
    assert.equal(read.text, "a.txt, b.txt");
    assert.ok(fake.log.some((l) => l === "mcp tools/call as at2"), `a refreshed token was used: ${fake.log.join("; ")}`);

    // no token is kept in the clear and none was ever answered
    d.sink.flush();
    const modules = new DatabaseSync(path.join(dir, "modules.db"), { readOnly: true });
    const row = JSON.stringify(modules.prepare("SELECT * FROM engine_mcp_oauth").all());
    modules.close();
    for (const secret of ["at1", "at2", "rt1"]) assert.equal(row.includes(`"${secret}"`) || row.includes(`:${secret}`), false, `${secret} is not stored in the clear`);
    assert.ok(row.includes("tokens_sealed"));
    assert.ok(!JSON.stringify(started).includes("rt1") && !JSON.stringify(read).includes("at2"));
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e); throw e; } finally { await stop(d); await fake.close(); }
});
