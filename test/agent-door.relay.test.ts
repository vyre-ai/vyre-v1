// The box's half of the door for outside agents (host/src/seams/relay.ts): what the relay may hand to the daemon on the control socket. The public path stays as it was; the door is a short named list; an Authorization header gets
// through on /mcp and nowhere else.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { doorPath, publicPathOk, servePublic } from "../host/src/seams/relay.ts";

test("the door is the named addresses and nothing near them", () => {
  for (const p of ["/mcp", "/oauth/authorize?client_id=x", "/oauth/token", "/oauth/register", "/oauth/wait", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server"]) {
    assert.equal(doorPath(p), true, p);
    assert.equal(publicPathOk(p), true, p);
  }
  for (const p of ["/mcp/x", "/mcp/../v1/identity/whoami", "/oauth/other", "/oauth/../v1/x", "/.well-known/acme-challenge/x", "/v1/identity/whoami", "/local/daemon/stop", "/sync/hello", "//mcp"]) {
    assert.equal(publicPathOk(p), false, p);
  }
});

test("Authorization reaches the daemon on /mcp alone, Cookie never, and a visitor cannot name themselves", async (t) => {
  const seen: Array<{ url: string; method: string; headers: http.IncomingHttpHeaders }> = [];
  const server = http.createServer((req, res) => { seen.push({ url: req.url ?? "", method: req.method ?? "", headers: req.headers }); req.resume(); res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const port = (server.address() as { port: number }).port;
  const ask = (method: string, path: string): Promise<unknown[]> => new Promise((resolve) => {
    const out: unknown[] = [];
    servePublic((m) => { out.push(m); if ((m as { t: string }).t !== "p.res" && (m as { t: string }).t !== "p.data") resolve(out); }, { id: "1", method, path, ip: "203.0.113.5", headers: { authorization: "Bearer vya_x", cookie: "a=b", "x-vyre-visitor": "1.1.1.1", "mcp-session-id": "ses_1" } }, new Uint8Array(0), port);
  });
  await ask("POST", "/mcp");
  await ask("DELETE", "/mcp");
  await ask("POST", "/oauth/token");
  await ask("POST", "/p/forms/x");
  const [mcp, del, token, form] = seen;
  assert.equal(mcp?.headers.authorization, "Bearer vya_x");
  assert.equal(mcp?.headers["mcp-session-id"], "ses_1");
  assert.equal(mcp?.headers.cookie, undefined);
  assert.equal(mcp?.headers["x-vyre-via"], "relay");
  assert.equal(mcp?.headers["x-vyre-visitor"], "203.0.113.5");
  assert.equal(del?.method, "DELETE");
  assert.equal(token?.headers.authorization, undefined);
  assert.equal(form?.headers.authorization, undefined);
  const refused = await ask("DELETE", "/p/forms/x");
  assert.equal((refused[0] as { status: number }).status, 400, "a public page takes no DELETE");
});
