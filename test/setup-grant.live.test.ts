// The setup grant (owner ruling 3 Nov, docs/ask-the-person.md), end to end on a booted daemon with a scripted MCP client. With "Act for me, including setup" the owner's outside agent sets the Space up
// as her with no card: a key into the Vault, Google sign-in, the Space's AI key, invites. The audit names the agent, the person and the grant, and no value comes back. Without it the same calls are
// cards. A member cannot give it. Taking it back makes the next call a card again; an admin can take it back too, and no agent can reach the switch.
import test from "node:test";
import assert from "node:assert/strict";
import { expectStatus } from "../golden/steps/02-space.ts";
import type { FlowSpace } from "../golden/steps/02-space.ts";
import { Client, signIn, withOutsideSpace } from "./support/outside-client.ts";

type Json = any;   // eslint-disable-line @typescript-eslint/no-explicit-any
const INIT = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1" } };
const google = (over: Record<string, unknown> = {}) => ({ key: "google", title: "Google", issuer: "https://accounts.google.com", clientId: "123.apps.googleusercontent.com", clientSecretHandle: "#Google_Client_Secret", enabled: true, ...over });
const SECRET = "GOCSPX-agent-held-secret-0123";
const KEY = "sk-ant-api03-setup-grant-test-0123456789abcdef";
const withSpace = (name: string, f: (s: FlowSpace, owner: string) => Promise<void>): void => withOutsideSpace(name, (s, owner) => f(s, owner), ["members", "vault-requests"]);
const tool = async (c: Client, name: string, args: unknown): Promise<Json> => (await c.tool("use_tool", { name, arguments: args })).json.result;
const holds = async (s: FlowSpace, who: string): Promise<number> => (expectStatus(await s.call("gate.holds.list", who, { states: ["held"] }), 200, "gate.holds.list").holds as Json[]).length;

withSpace("with the setup grant the owner's agent sets things up as her with no card: a key into the Vault, Google sign-in, the AI key, invites; the audit names the grant and nothing echoes a secret", async (s, owner) => {
  const req = await (async () => { const c = new Client(`${s.d.url}/mcp`); await c.discover(); await c.register(); return (await c.authorize()).requestId; })();
  assert.equal(expectStatus(await s.call("mcp.oauth.request", owner, { requestId: req }), 200, "mcp.oauth.request").request.canSetup, true, "the owner is offered the choice");

  const c = new Client(`${s.d.url}/mcp`, {}, "Simba (Claude Code)");
  const { agentId } = await signIn(s, c, owner, { setup: true });
  await c.rpc("initialize", INIT);
  assert.equal(expectStatus(await s.call("mcp.connected.list", owner, {}), 200, "mcp.connected.list").agents.find((a: Json) => a.agentId === agentId).setup, true, "Settings shows it");
  const folder = expectStatus(await s.call("vault.folders.create", owner, { idempotencyKey: "sg-folder", name: "Sign-in", scope: "shared" }), 200, "vault.folders.create").folder.id as string;

  const put = await tool(c, "vault_item_put", { folderId: folder, name: "Google_Client_Secret", kind: "api_key", fields: [{ key: "value", value: SECRET, secret: true }], idempotencyKey: "sg-put" });
  assert.equal(put.isError, false, JSON.stringify(put).slice(0, 400));
  assert.equal(JSON.stringify(put).includes(SECRET), false, "the value is never echoed");

  const sso = await tool(c, "members_sso_set", { provider: google() });
  assert.equal(sso.isError, false, JSON.stringify(sso).slice(0, 400));
  assert.equal(expectStatus(await s.call("members.sso.list", owner, {}), 200, "members.sso.list").providers[0].clientSecretHandle, "#Google_Client_Secret");

  const ai = await tool(c, "providers_add", { providerKey: "anthropic", connection: "api_key", apiKey: KEY, name: "Space AI", scope: "shared", folderId: folder, idempotencyKey: "sg-ai" });
  assert.equal(JSON.stringify(ai).includes(KEY), false, "the AI key is never echoed");
  assert.equal(ai.structuredContent?.held, undefined, "the AI key is never a card under the grant");
  assert.equal(ai.isError, false, JSON.stringify(ai).slice(0, 400));
  assert.equal(ai.structuredContent.data.provider.scope ?? "shared", "shared", "a Space key");

  const roles = expectStatus(await s.call("access.roles.list", owner, {}), 200, "access.roles.list").roles as Json[];
  const member = (roles.find((r) => r.name === "Member" || r.id === "member") ?? roles.find((r) => r.id !== "owner" && r.id !== "rol_owner"))!.id;
  const invite = await tool(c, "members_invites_create", { role: member, email: "sam@northwind.example", idempotencyKey: "sg-inv" });
  assert.equal(invite.isError, false, JSON.stringify(invite).slice(0, 400));
  assert.equal(await holds(s, owner), 0, "no card for any of it");

  const audit = expectStatus(await s.call("audit.list", owner, { limit: 300 }), 200, "audit.list").rows as Json[];
  for (const cap of ["members.sso.set", "members.invites.create", "vault.item.put"]) {
    assert.ok(audit.some((r) => r.action === cap && r.actor?.id === agentId && r.onBehalfOf?.id === "usr_olivia" && r.after?.reason === "setup_grant"), `${cap}: the agent, for her, under the setup grant`);
    assert.ok(audit.some((r) => r.action === cap && r.actor?.id === "usr_olivia"), `${cap}: the run is hers`);
  }
  assert.equal(JSON.stringify(audit).includes(SECRET) || JSON.stringify(audit).includes(KEY), false, "no secret in the log");
  // reading a secret back stays impossible, and the switch is out of its reach
  const reveal = await tool(c, "vault_item_reveal", { handle: "#Google_Client_Secret" });
  assert.equal(reveal.isError, true);
  assert.equal(JSON.stringify(reveal).includes(SECRET), false);
  assert.ok((await c.tool("use_tool", { name: "mcp_setup_set", arguments: { agentId, setup: true } })).json.error, "no agent reaches the switch");
});

withSpace("without the grant the same calls are cards; a member cannot give the grant; taking it back makes the next call a card", async (s, owner) => {
  // Ask me first
  const ask = new Client(`${s.d.url}/mcp`);
  await signIn(s, ask, owner);
  await ask.rpc("initialize", INIT);
  const carded = (await tool(ask, "members_sso_set", { provider: google({ clientId: "ask-1" }) })).structuredContent;
  assert.deepEqual([carded.held, carded.asksPerson], [true, true], JSON.stringify(carded));

  // a member is offered no choice, and cannot give it
  const noah = s.signedIn("usr_noah");
  const n = new Client(`${s.d.url}/mcp`, {}, "Noah's Codex");
  await n.discover(); await n.register();
  const { requestId } = await n.authorize();
  assert.equal(expectStatus(await s.call("mcp.oauth.request", noah, { requestId }), 200, "mcp.oauth.request").request.canSetup, undefined);
  const refused = await s.call("mcp.oauth.allow", noah, { requestId, setup: true });
  assert.equal(refused.status >= 400, true);
  assert.equal(refused.body?.error?.code, "permission.role_lacks_permission", JSON.stringify(refused.body));
  const noahAgent = new Client(`${s.d.url}/mcp`, {}, "Noah's other app");
  const { agentId: noahsId } = await signIn(s, noahAgent, noah);
  assert.equal((await s.call("mcp.setup.set", noah, { agentId: noahsId, setup: true })).body?.error?.code, "permission.role_lacks_permission", "nor later in Settings");

  // granted, then taken back: the next call is a card again
  const c = new Client(`${s.d.url}/mcp`, {}, "Simba (Claude Code)");
  const { agentId } = await signIn(s, c, owner, { setup: true });
  await c.rpc("initialize", INIT);
  assert.equal((await tool(c, "members_sso_set", { provider: google({ clientId: "granted-1" }) })).isError, false);
  expectStatus(await s.call("mcp.setup.set", owner, { agentId, setup: false }), 200, "mcp.setup.set");
  const back = (await tool(c, "members_sso_set", { provider: google({ clientId: "after-revoke" }) })).structuredContent;
  assert.deepEqual([back.held, back.asksPerson], [true, true], JSON.stringify(back));
  // on again, and an admin takes it back from the Console
  expectStatus(await s.call("mcp.setup.set", owner, { agentId, setup: true }), 200, "mcp.setup.set");
  const all = expectStatus(await s.call("mcp.connected.list", s.signedIn("usr_adam"), { all: true }), 200, "mcp.connected.list").agents as Json[];
  assert.equal(all.find((a) => a.agentId === agentId)?.setup, true, "the Console sees it");
  expectStatus(await s.call("mcp.setup.set", s.signedIn("usr_adam"), { agentId, setup: false }), 200, "mcp.setup.set");
  assert.equal((await tool(c, "members_sso_set", { provider: google({ clientId: "after-admin" }) })).structuredContent.held, true);
  assert.equal((await s.call("mcp.connected.list", noah, { all: true })).status >= 400, true, "a member sees only their own");
});
