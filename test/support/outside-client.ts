// An MCP client that knows nothing but a Space's /mcp address, the sign-in a person allows, and a booted Space per test, for the live tests of outside agents (test/outside-agents.work.live.test.ts, test/outside-agents.connect.live.test.ts, test/ask-person.live.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { bootAgentGateSpace, LIVE_FOR_GATE_REPLY } from "../../golden/steps/07-agent-gate.ts";
import { expectStatus } from "../../golden/steps/02-space.ts";
import type { FlowSpace } from "../../golden/steps/02-space.ts";

type Json = any;   // eslint-disable-line @typescript-eslint/no-explicit-any

/** One HTTP request with exact headers: fetch will not let a test set Host. */
export function raw(url: string, o: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: `${u.pathname}${u.search}`, method: o.method ?? "GET", headers: o.headers ?? {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(o.body);
  });
}

/** What an MCP client does, from nothing but the address. Nothing here reads Vyre's code: it follows the 401. */
export class Client {
  token = ""; refresh = ""; clientId = ""; session = ""; verifier = randomBytes(40).toString("base64url"); redirect = "http://127.0.0.1:39281/callback"; issuer = ""; meta: Json = {}; resource = "";
  url: string; extra: Record<string, string>; name: string;
  constructor(url: string, extra: Record<string, string> = {}, name = "Claude Code") { this.url = url; this.extra = extra; this.name = name; }
  async discover(): Promise<void> {
    const r = await raw(this.url, { method: "POST", headers: { "content-type": "application/json", ...this.extra }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
    assert.equal(r.status, 401);
    const www = String(r.headers["www-authenticate"]);
    const at = /resource_metadata="([^"]+)"/.exec(www)?.[1];
    assert.ok(at, www);
    const prm = JSON.parse((await raw(this.door(new URL(at).pathname), { headers: this.extra })).text) as Json;
    this.resource = prm.resource;
    assert.equal(new URL(this.resource).pathname, "/mcp");
    this.issuer = prm.authorization_servers[0];
    assert.equal(`${this.issuer}/mcp`, this.resource);
    assert.equal(new URL(at).origin, this.issuer);
    this.meta = JSON.parse((await raw(this.door("/.well-known/oauth-authorization-server"), { headers: this.extra })).text);
    assert.equal(this.meta.issuer, this.issuer);
    assert.ok(this.meta.code_challenge_methods_supported.includes("S256"));
  }
  /** The door on this host, whatever public address the metadata names. */
  door(path: string): string { return `${new URL(this.url).origin}${path}`; }
  async register(): Promise<void> {
    const r = await raw(this.door("/oauth/register"), { method: "POST", headers: { "content-type": "application/json", ...this.extra }, body: JSON.stringify({ client_name: this.name, redirect_uris: [this.redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) });
    assert.equal(r.status, 201, r.text);
    this.clientId = JSON.parse(r.text).client_id;
  }
  async authorize(): Promise<{ requestId: string; proof: string; page: Awaited<ReturnType<typeof raw>> }> {
    const q = new URLSearchParams({ client_id: this.clientId, redirect_uri: this.redirect, response_type: "code", code_challenge: createHash("sha256").update(this.verifier).digest("base64url"), code_challenge_method: "S256", state: "s7", resource: this.resource });
    const page = await raw(this.door(`/oauth/authorize?${q}`), { headers: this.extra });
    assert.equal(page.status, 200, page.text);
    const data = JSON.parse(/var d=(\{.*?\}),\$=/.exec(page.text)![1]!) as { request: string; proof: string };
    return { requestId: data.request, proof: data.proof, page };
  }
  async wait(requestId: string, proof: string): Promise<Json> {
    const r = await raw(this.door("/oauth/wait"), { method: "POST", headers: { "content-type": "application/json", ...this.extra }, body: JSON.stringify({ request: requestId, proof }) });
    return JSON.parse(r.text);
  }
  async exchange(form: Record<string, string>): Promise<{ status: number; json: Json }> {
    const r = await raw(this.door("/oauth/token"), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...this.extra }, body: new URLSearchParams({ client_id: this.clientId, ...form }).toString() });
    return { status: r.status, json: JSON.parse(r.text) };
  }
  async trade(code: string): Promise<void> {
    const r = await this.exchange({ grant_type: "authorization_code", code, redirect_uri: this.redirect, code_verifier: this.verifier, resource: this.resource });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    this.token = r.json.access_token; this.refresh = r.json.refresh_token;
  }
  async rpc(method: string, params: unknown = {}, id: number | null = 1): Promise<{ status: number; json: Json; headers: http.IncomingHttpHeaders }> {
    const r = await raw(this.url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.token}`, ...(this.session ? { "mcp-session-id": this.session } : {}), ...this.extra }, body: JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params }) });
    if (typeof r.headers["mcp-session-id"] === "string") this.session = r.headers["mcp-session-id"];
    return { status: r.status, json: r.text ? JSON.parse(r.text) : null, headers: r.headers };
  }
  tool(name: string, args: unknown = {}): Promise<{ status: number; json: Json; headers: http.IncomingHttpHeaders }> { return this.rpc("tools/call", { name, arguments: args }); }
}

/** The whole sign-in: a person presses Allow with their own session. */
/** `setup`: the person chooses "Act for me, including setup" on the Allow screen (owner ruling 3 Nov). */
export async function signIn(s: FlowSpace, c: Client, person: string, o: { setup?: boolean } = {}): Promise<{ agentId: string; requestId: string }> {
  await c.discover();
  await c.register();
  const { requestId, proof } = await c.authorize();
  assert.equal((await c.wait(requestId, proof)).status, "waiting");
  const allow = expectStatus(await s.call("mcp.oauth.allow", person, { requestId, ...(o.setup === true ? { setup: true } : {}) }), 200, "mcp.oauth.allow");
  const w = await c.wait(requestId, proof);
  assert.equal(w.status, "allowed");
  const back = new URL(w.redirect);
  assert.equal(`${back.origin}${back.pathname}`, c.redirect);
  assert.equal(back.searchParams.get("state"), "s7");
  assert.equal(back.searchParams.get("iss"), c.issuer);
  await c.trade(back.searchParams.get("code")!);
  return { agentId: allow.agentId, requestId };
}

/** The modules an outside agent's live tests need live. */
export const OUTSIDE_LIVE: readonly string[] = [...LIVE_FOR_GATE_REPLY, "mcp", "audit", "spaces"];

/** One test on its own booted Space: the owner, Olivia, signed in, and the Space's /mcp address. `extra` names more modules to have live. */
export function withOutsideSpace(name: string, f: (s: FlowSpace, owner: string, mcp: string) => Promise<void>, extra: readonly string[] = []): void {
  test(name, async () => {
    const s = await bootAgentGateSpace([...OUTSIDE_LIVE, ...extra]);
    try { await f(s, s.signedIn("usr_olivia"), `${s.d.url}/mcp`); } finally { await s.stop(); }
  });
}
