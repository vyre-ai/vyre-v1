// Outside agents at work, end to end on a booted daemon, with a scripted MCP client that knows nothing but the address: from the address to a tool call, and everything it does shows up as that
// agent, in the activity list, the audit log and the chat; a mention reaches it through agents_next; outward acts stop; what stays with people stays; a teammate cannot touch it.
// The connection itself (tokens, revocation, addresses, Spaces, cross-site posts) is in outside-agents.connect.live.test.ts; shared setup in test/support/outside-client.ts.
import assert from "node:assert/strict";
import { addVerifiedSendingDomain } from "../golden/steps/07-agent-gate.ts";
import { expectStatus } from "../golden/steps/02-space.ts";
import { Client, raw, signIn, withOutsideSpace as withSpace } from "./support/outside-client.ts";

type Json = any;   // eslint-disable-line @typescript-eslint/no-explicit-any

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
  // never as the agent: off from outside, or asked of the person (a call with nothing in it is refused by its own schema before it could even be asked); docs/ask-the-person.md
  for (const tool of ["identity_totp_remove", "identity_sign_out", "members_sso_set", "connections_create", "connections_delete", "access_share", "access_roles_assign", "gate_rules_set", "devices_revoke", "network_domain_set", "spaces_transfer_ownership", "vault_item_reveal", "terminal_run", "access_actors_create", "agents_delete"]) {
    const r = await c.tool("use_tool", { name: tool, arguments: {} });
    if (r.json.error) continue;   // not a tool in this build
    assert.equal(r.json.result.isError, true, tool);
    const sc = r.json.result.structuredContent;
    assert.ok(sc.asksPerson === true || sc.error?.details?.reason === "not_from_outside" || sc.error?.details?.reason === "person_only" || sc.error?.code === "validation.bad_input", `${tool}: ${JSON.stringify(sc)}`);
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
