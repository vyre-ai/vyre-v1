// Outside agents, end to end on a booted daemon, with a scripted MCP client that knows nothing but the address: discovery from the 401, registration, the tab, a person's Allow, the code, the tokens, a tool call. Then what the owner
// asked for: everything it does shows up as that agent, in the activity list, the audit log and the chat; a mention reaches it through agents_next; outward acts stop; what stays with people stays; a teammate cannot touch it.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { addVerifiedSendingDomain, bootAgentGateSpace, LIVE_FOR_GATE_REPLY } from "../golden/steps/07-agent-gate.ts";
import { expectStatus } from "../golden/steps/02-space.ts";
import type { FlowSpace } from "../golden/steps/02-space.ts";

const LIVE = [...LIVE_FOR_GATE_REPLY, "mcp", "audit", "spaces"];
type Json = any;   // eslint-disable-line @typescript-eslint/no-explicit-any

/** One HTTP request with exact headers: fetch will not let a test set Host. */
function raw(url: string, o: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
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
class Client {
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
async function signIn(s: FlowSpace, c: Client, person: string): Promise<{ agentId: string; requestId: string }> {
  await c.discover();
  await c.register();
  const { requestId, proof } = await c.authorize();
  assert.equal((await c.wait(requestId, proof)).status, "waiting");
  const allow = expectStatus(await s.call("mcp.oauth.allow", person, { requestId }), 200, "mcp.oauth.allow");
  const w = await c.wait(requestId, proof);
  assert.equal(w.status, "allowed");
  const back = new URL(w.redirect);
  assert.equal(`${back.origin}${back.pathname}`, c.redirect);
  assert.equal(back.searchParams.get("state"), "s7");
  assert.equal(back.searchParams.get("iss"), c.issuer);
  await c.trade(back.searchParams.get("code")!);
  return { agentId: allow.agentId, requestId };
}

const withSpace = (name: string, f: (s: FlowSpace, owner: string, mcp: string) => Promise<void>): void => {
  test(name, async () => {
    const s = await bootAgentGateSpace(LIVE);
    try { await f(s, s.signedIn("usr_olivia"), `${s.d.url}/mcp`); } finally { await s.stop(); }
  });
};

withSpace("from nothing but the address to a tool call, and everything it did shows up as that agent", async (s, owner, mcp) => {
  const c = new Client(mcp);
  await c.discover();
  await c.register();
  const { requestId, proof, page } = await c.authorize();
  assert.match(page.text, /Claude Code wants to join/);
  assert.match(String(page.headers["content-security-policy"]), /frame-ancestors 'none'/);
  assert.equal(page.headers["x-frame-options"], "DENY");
  const seen = expectStatus(await s.call("mcp.oauth.request", owner, { requestId }), 200, "mcp.oauth.request").request;
  assert.equal(seen.clientName, "Claude Code");
  assert.match(page.text, new RegExp(`id="code">${seen.match}<`), "the tab and Vyre show the same code");
  const allow = expectStatus(await s.call("mcp.oauth.allow", owner, { requestId }), 200, "mcp.oauth.allow");
  const w = await c.wait(requestId, proof);
  await c.trade(new URL(w.redirect).searchParams.get("code")!);

  // it is a normal agent: a row, an owner, a face, a principal
  const agent = expectStatus(await s.call("agents.get", owner, { agentId: allow.agentId }), 200, "agents.get").agent;
  assert.equal(agent.name, "Claude Code");
  assert.equal(agent.runtime, "outside");
  assert.equal(agent.ownerId, "usr_olivia");
  assert.match(agent.face, /^outside-/);
  assert.ok(agent.folderId && agent.folderId !== "fld_unset");
  const listed = expectStatus(await s.call("mcp.connected.list", owner, {}), 200, "mcp.connected.list").agents;
  assert.deepEqual(listed.map((a: Json) => a.agentId), [allow.agentId]);

  const init = await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1" } });
  assert.equal(init.status, 200);
  assert.ok(c.session.startsWith("ses_"));
  assert.match(init.json.result.instructions, /agents_next/);
  assert.equal((await c.rpc("notifications/initialized", {}, null)).status, 202);
  const tools = (await c.rpc("tools/list")).json.result.tools.map((t: Json) => t.name);
  assert.ok(tools.includes("agents_next") && tools.includes("use_tool") && tools.includes("chat_post") && tools.includes("tasks_create"));
  assert.equal(tools.includes("vault_item_reveal"), false);

  const made = await c.tool("tasks_create", { title: "Draft the pricing page", assigned: { kind: "person", id: "usr_olivia" }, idempotencyKey: "out-task-1" });
  assert.equal(made.json.result.isError, false, JSON.stringify(made.json.result));

  // the activity row, the audit row and the status all name the agent
  const activity = expectStatus(await s.call("mcp.activity.list", owner, { agentId: allow.agentId }), 200, "mcp.activity.list").rows;
  assert.equal(activity[0].tool, "tasks_create");
  assert.equal(activity[0].outcome, "ok");
  const audit = expectStatus(await s.call("audit.list", owner, { limit: 100 }), 200, "audit.list").rows;
  const row = audit.find((r: Json) => r.action === "tasks.create" && r.actor?.id === allow.agentId);
  assert.ok(row, `the audit row names the agent: ${JSON.stringify(audit.slice(0, 3)).slice(0, 400)}`);
  assert.equal(row.onBehalfOf?.id, "usr_olivia", "and the person it acted for");
  await s.d.hooks?.pump?.();
  assert.equal(expectStatus(await s.call("agents.get", owner, { agentId: allow.agentId }), 200, "agents.get").agent.status, "working");

  // a rotated token keeps the session the client holds
  const rotated = await c.exchange({ grant_type: "refresh_token", refresh_token: c.refresh, resource: c.resource });
  assert.equal(rotated.status, 200);
  c.token = rotated.json.access_token;
  assert.equal((await c.rpc("ping")).status, 200, "the same session id, on the new token");
});

withSpace("a mention reaches it through agents_next, and what it does in the chat is there like any agent's", async (s, owner, mcp) => {
  const c = new Client(mcp);
  const { agentId } = await signIn(s, c, owner);
  await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1" } });
  assert.equal((await c.tool("agents_next")).json.result.structuredContent.data.job, null, "nothing waiting");

  const threadId = expectStatus(await s.call("chat.start", owner, { kind: "chat", agentIds: [agentId], idempotencyKey: "out-chat" }), 200, "chat.start").thread.threadId as string;
  expectStatus(await s.call("chat.post", owner, { threadId, body: "@Claude Code draft the pricing page", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "out-ask" }), 200, "chat.post");
  let job: Json = null;
  for (let i = 0; i < 40 && !job; i++) {
    await s.d.hooks?.pump?.();
    job = (await c.tool("agents_next")).json.result.structuredContent.data.job;
    if (!job) await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(job, "the mention reached the queue");
  assert.equal(job.kind, "mention");
  assert.equal(job.threadId, threadId);
  assert.equal(job.from, "usr_olivia");
  assert.match(job.text, /pricing page/);
  assert.equal(expectStatus(await s.call("engine.turns.list", owner, { threadId }), 200, "engine.turns.list").turns.length, 0, "no turn ran here: it runs elsewhere");

  // bound to the chat: its calls show there as steps, its words as its message
  await c.tool("tasks_list", {});
  const said = await c.tool("chat_post", { threadId, body: "The draft is in Pricing.", idempotencyKey: "out-said" });
  assert.equal(said.json.result.isError, false, JSON.stringify(said.json.result));
  await new Promise((r) => setTimeout(r, 1800));
  const messages = expectStatus(await s.call("chat.messages.list", owner, { threadId, limit: 20 }), 200, "chat.messages.list").messages as Json[];
  const mine = messages.filter((m) => m.author.id === agentId);
  assert.ok(mine.some((m) => m.body === "The draft is in Pricing."), "its words are its own message");
  const blocks = mine.flatMap((m) => m.blocks ?? []);
  assert.ok(blocks.some((b: Json) => b.type === "tool_call" && b.data.name === "tasks_list"), `its tool call is a step in the chat: ${JSON.stringify(blocks).slice(0, 300)}`);
  assert.equal(mine.every((m) => m.author.kind === "agent"), true);
  const activity = expectStatus(await s.call("mcp.activity.list", owner, { agentId }), 200, "mcp.activity.list").rows;
  assert.equal(activity.find((r: Json) => r.tool === "tasks_list").threadId, threadId);

  // a task assigned to it waits in the queue too, and the agent can take it
  const task = expectStatus(await s.call("tasks.create", owner, { title: "Check the numbers", assigned: { kind: "agent", id: agentId }, idempotencyKey: "out-assign" }), 200, "tasks.create").task;
  let taskJob: Json = null;
  for (let i = 0; i < 40 && !taskJob; i++) {
    await s.d.hooks?.pump?.();
    taskJob = (await c.tool("agents_next")).json.result.structuredContent.data.job;
    if (!taskJob) await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(taskJob, "the task reached the queue");
  assert.equal(taskJob.kind, "task");
  assert.equal(taskJob.taskId, task.id);
  assert.ok(taskJob.threadId, "with its thread");
});

withSpace("outward act held: a send stops for a person's yes, as that agent, and the yes sends it", async (s, owner, mcp) => {
  const admin = s.d.token;
  await addVerifiedSendingDomain(s, admin, "out");
  const c = new Client(mcp);
  const { agentId } = await signIn(s, c, owner);
  const made = expectStatus(await s.call("mail.mailbox.create", admin, { idempotencyKey: "out-mailbox", kind: "agent", address: "out@send.agent-gate.test", title: "Out", agentId }), 200, "mail.mailbox.create").mailbox;
  const mailboxId = (made.mailboxId ?? made.id) as string;
  await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1" } });
  const held = await c.tool("mail_send", { mailboxId, to: [{ address: "pat@acme.test" }], subject: "Hello", text: "From outside", idempotencyKey: "out-send" });
  assert.equal(held.json.result.isError, true);
  assert.equal(held.json.result.structuredContent.held, true, JSON.stringify(held.json.result));
  const holds = expectStatus(await s.call("gate.holds.list", admin, { states: ["held"] }), 200, "gate.holds.list").holds as Json[];
  assert.equal(holds.length, 1);
  assert.equal(holds[0].capName, "mail.send");
  assert.equal(holds[0].principal?.id ?? holds[0].principalId, agentId);
  assert.equal((await c.tool("use_tool", { name: "tasks_act", arguments: { taskId: holds[0].taskId, action: "approve" } })).json.result.isError, true, "it cannot approve its own send");
  expectStatus(await s.call("tasks.act", owner, { taskId: holds[0].taskId, action: "approve" }), 200, "tasks.act");
  const sent = expectStatus(await s.call("mail.message.list", admin, { mailboxId, direction: "out" }), 200, "mail.message.list").messages as Json[];
  assert.equal(sent.length, 1);
  assert.equal(sent[0].status, "sent");
  const activity = expectStatus(await s.call("mcp.activity.list", owner, { agentId }), 200, "mcp.activity.list").rows as Json[];
  assert.ok(activity.some((r) => r.tool === "mail_send" && r.outcome === "held" && r.taskId === holds[0].taskId));
  // the answer reaches it the only way anything can
  await s.d.hooks?.pump?.();
  const answer = (await c.tool("agents_next")).json.result.structuredContent.data.job;
  assert.equal(answer?.kind, "answer", JSON.stringify(answer));
  assert.equal(answer.taskId, holds[0].taskId);
  assert.match(answer.text, /^Approved\. mail_send ran\.$/);
});

withSpace("an outside agent trying what stays with people: allow another client, change sign-in, widen access, connect the company", async (s, owner, mcp) => {
  const c = new Client(mcp);
  await signIn(s, c, owner);
  await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
  for (const tool of ["mcp_oauth_allow", "mcp_connected_remove", "agents_outside_connect", "agents_outside_enqueue"]) {
    const r = await c.tool(tool, { requestId: "oar_x", agentId: "agt_x" });
    assert.ok(r.json.error, `${tool} is no tool at all`);
  }
  for (const tool of ["identity_totp_remove", "identity_sign_out", "members_sso_set", "connections_create", "connections_delete", "access_share", "access_roles_assign", "gate_rules_set", "devices_revoke", "network_domain_set", "spaces_transfer_ownership", "vault_item_reveal", "terminal_run", "access_actors_create", "agents_delete"]) {
    const r = await c.tool("use_tool", { name: tool, arguments: {} });
    if (r.json.error) continue;   // not a tool in this build
    assert.equal(r.json.result.isError, true, tool);
    assert.equal(r.json.result.structuredContent.error.details?.reason, "person_only", `${tool}: ${JSON.stringify(r.json.result.structuredContent.error)}`);
  }
  // and a token of an outside agent opens nothing but /mcp
  assert.equal((await raw(`${s.d.url}/v1/identity/whoami`, { method: "POST", headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" }, body: "{}" })).status, 401);
  const stranger = new Client(mcp, {}, "Second");
  await stranger.discover();
  await stranger.register();
  const { requestId } = await stranger.authorize();
  assert.equal((await raw(`${s.d.url}/v1/mcp/oauth/allow`, { method: "POST", headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" }, body: JSON.stringify({ requestId }) })).status, 401);
});

withSpace("a teammate cannot use someone's outside agent: not see it, not mention it, not give it work, not read what it did, not remove it", async (s, owner, mcp) => {
  const c = new Client(mcp);
  const { agentId } = await signIn(s, c, owner);
  const noah = s.signedIn("usr_noah");
  assert.notEqual((await s.call("agents.get", noah, { agentId })).status, 200);
  const list = expectStatus(await s.call("agents.list", noah, {}), 200, "agents.list").agents as Json[];
  assert.equal(list.some((a) => a.agentId === agentId), false);
  const own = expectStatus(await s.call("agents.create", noah, { name: "Noah's own", idempotencyKey: "noah-agent" }), 200, "agents.create").agent.agentId as string;
  const thread = expectStatus(await s.call("chat.start", noah, { kind: "chat", agentIds: [own], idempotencyKey: "noah-chat" }), 200, "chat.start").thread.threadId as string;
  const mention = await s.call("chat.post", noah, { threadId: thread, body: "hey", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "noah-mention" });
  assert.notEqual(mention.status, 200, "a mention of it is refused");
  const task = await s.call("tasks.create", noah, { title: "Do this for me", assigned: { kind: "agent", id: agentId }, idempotencyKey: "noah-task" });
  assert.notEqual(task.status, 200, "a task for it is refused");
  assert.equal(task.body.error.details?.reason, "outside_agent");
  assert.notEqual((await s.call("mcp.activity.list", noah, { agentId })).status, 200);
  assert.notEqual((await s.call("mcp.connected.remove", noah, { agentId })).status, 200);
  assert.deepEqual(expectStatus(await s.call("mcp.connected.list", noah, {}), 200, "mcp.connected.list").agents, []);
  // and nothing was queued
  await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
  await s.d.hooks?.pump?.();
  assert.equal((await c.tool("agents_next")).json.result.structuredContent.data.job, null);
});

withSpace("revoked and expired tokens stop at the next request; Remove ends the agent, and the same app starts over as a new one", async (s, owner, mcp) => {
  const c = new Client(mcp);
  const { agentId } = await signIn(s, c, owner);
  await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
  assert.equal((await c.tool("agents_next")).status, 200);

  s.d.db!.run("UPDATE mcp_oauth_tokens SET expires_at = 1 WHERE kind = 'access'");
  const expired = await c.tool("agents_next");
  assert.equal(expired.status, 401);
  assert.match(String(expired.headers["www-authenticate"]), /invalid_token/);
  const fresh = await c.exchange({ grant_type: "refresh_token", refresh_token: c.refresh });
  assert.equal(fresh.status, 200);
  c.token = fresh.json.access_token; c.refresh = fresh.json.refresh_token;
  assert.equal((await c.tool("agents_next")).status, 200);

  expectStatus(await s.call("mcp.connected.remove", owner, { agentId }), 200, "mcp.connected.remove");
  assert.equal((await c.tool("agents_next")).status, 401, "ended at once");
  assert.equal((await c.exchange({ grant_type: "refresh_token", refresh_token: c.refresh })).status, 400);
  assert.notEqual((await s.call("agents.get", owner, { agentId })).status, 200, "the agent went to Trash");
  assert.deepEqual(expectStatus(await s.call("mcp.connected.list", owner, {}), 200, "mcp.connected.list").agents, []);

  const again = await signIn(s, c, owner);
  assert.notEqual(again.agentId, agentId, "a removed agent does not come back");
});

withSpace("an outside agent moved to Trash any other way ends its sign-in too", async (s, owner, mcp) => {
  const c = new Client(mcp);
  const { agentId } = await signIn(s, c, owner);
  await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
  assert.equal((await c.tool("agents_next")).status, 200);
  expectStatus(await s.call("agents.delete", owner, { agentId }), 200, "agents.delete");
  await s.d.hooks?.pump?.();
  assert.equal((await c.tool("agents_next")).status, 401);
  assert.deepEqual(expectStatus(await s.call("mcp.connected.list", owner, {}), 200, "mcp.connected.list").agents, []);
});

test("in a Personal Space it works the same, on this computer's own address", async () => {
  const s = await bootAgentGateSpace(LIVE, { spaceKind: "personal" });
  try {
    const owner = s.signedIn("usr_olivia");
    const c = new Client(`${s.d.url}/mcp`);
    const { agentId } = await signIn(s, c, owner);
    await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
    assert.equal((await c.tool("agents_next")).status, 200);
    assert.equal(expectStatus(await s.call("mcp.connected.link", owner, {}), 200, "mcp.connected.link").url, `${s.d.url}/mcp`);
    assert.equal(expectStatus(await s.call("agents.get", owner, { agentId }), 200, "agents.get").agent.runtime, "outside");
  } finally { await s.stop(); }
});

withSpace("a person suspended ends their agent's access at once", async (s, owner, mcp) => {
  const c = new Client(mcp);
  const noah = s.signedIn("usr_noah");
  await signIn(s, c, noah);
  await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
  assert.equal((await c.tool("agents_next")).status, 200);
  expectStatus(await s.call("members.suspend", owner, { personId: "usr_noah" }), 200, "members.suspend");
  assert.equal((await c.tool("agents_next")).status, 401);
});

withSpace("a token from another address opens nothing, and the relay address is its own resource", async (s, owner, mcp) => {
  const port = new URL(mcp).port;
  const local = new Client(mcp);
  await signIn(s, local, owner);
  await local.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
  assert.equal((await local.tool("agents_next")).status, 200);
  const other = await raw(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { host: `localhost:${port}`, authorization: `Bearer ${local.token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  assert.equal(other.status, 401, "the same daemon on another name is another resource");

  // a phone address: the box hands the request on with x-vyre-via, and the metadata names the public address, whatever Host says
  s.d.db!.run("INSERT OR REPLACE INTO network_phone (id, name, state, reported_at) VALUES (1, 'northwind', 'claimed', 1)");
  const relay = new Client(mcp, { "x-vyre-via": "relay", host: "evil.example" });
  await relay.discover();
  assert.equal(relay.issuer, "https://northwind.vyre.run");
  assert.equal(relay.resource, "https://northwind.vyre.run/mcp");
  await relay.register();
  const { requestId, proof } = await relay.authorize();
  expectStatus(await s.call("mcp.oauth.allow", owner, { requestId }), 200, "mcp.oauth.allow");
  const w = await relay.wait(requestId, proof);
  assert.equal(new URL(w.redirect).searchParams.get("iss"), "https://northwind.vyre.run");
  await relay.trade(new URL(w.redirect).searchParams.get("code")!);
  assert.equal((await relay.rpc("ping")).status, 200);
  const crossed = await raw(mcp, { method: "POST", headers: { authorization: `Bearer ${relay.token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  assert.equal(crossed.status, 401, "a token for the relay address opens nothing on loopback");
  const wrong = await relay.exchange({ grant_type: "refresh_token", refresh_token: local.refresh });
  assert.equal(wrong.status, 400, "and a refresh token of the other address does not trade here");
});

test("a token from another Space opens nothing", async () => {
  const a = await bootAgentGateSpace(LIVE);
  const b = await bootAgentGateSpace(LIVE);
  try {
    const c = new Client(`${a.d.url}/mcp`);
    await signIn(a, c, a.signedIn("usr_olivia"));
    const there = await raw(`${b.d.url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    assert.equal(there.status, 401);
  } finally { await a.stop(); await b.stop(); }
});

withSpace("a cross-site Allow post is refused: no session, a cookie, a foreign Origin, a preflight", async (s, owner, mcp) => {
  const c = new Client(mcp);
  await c.discover();
  await c.register();
  const { requestId, proof } = await c.authorize();
  const body = JSON.stringify({ requestId });
  const post = (headers: Record<string, string>) => raw(`${s.d.url}/v1/mcp/oauth/allow`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  assert.equal((await post({ origin: "https://evil.example" })).status, 401, "a form on another site has no Bearer token to send");
  assert.equal((await post({ origin: "https://evil.example", cookie: `session=${owner}; vyre=${owner}` })).status, 401, "a cookie is not a session here");
  const form = await raw(`${s.d.url}/v1/mcp/oauth/allow`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" }, body: `requestId=${requestId}` });
  assert.notEqual(form.status, 200);
  const preflight = await raw(`${s.d.url}/v1/mcp/oauth/allow`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });
  assert.equal(preflight.headers["access-control-allow-origin"], undefined, "a browser never gets to send one with a Bearer token");
  assert.equal((await c.wait(requestId, proof)).status, "waiting", "nothing was allowed");
  assert.equal((await raw(c.door(`/oauth/authorize`), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "allow=1" })).status, 405, "and there is no Allow on the page to post to");
});
