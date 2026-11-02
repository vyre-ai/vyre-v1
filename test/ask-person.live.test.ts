// Ask the person (docs/ask-the-person.md), end to end on a booted daemon with a scripted MCP client: an outside agent asks for what only a person does, the person it acts for sees one card and
// approves it, and it runs as them, once, exactly as asked, with the answer back through agents_next. Declined, it does not run. A person without the role is not asked at all. A key goes in
// through the person's own paste, and the agent only ever holds its name.
import assert from "node:assert/strict";
import { expectStatus } from "../golden/steps/02-space.ts";
import type { FlowSpace } from "../golden/steps/02-space.ts";
import { Client, signIn, withOutsideSpace } from "./support/outside-client.ts";

type Json = any;   // eslint-disable-line @typescript-eslint/no-explicit-any

const INIT = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1" } };
const google = (over: Record<string, unknown> = {}) => ({ key: "google", title: "Google", issuer: "https://accounts.google.com", clientId: "123.apps.googleusercontent.com", clientSecretHandle: "#Google_Client_Secret", enabled: true, ...over });

const payloadOf = (bytes: Uint8Array): Json => { try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return {}; } };

/** The next job in the agent's queue, waiting for the consumers to run. */
async function nextJob(s: FlowSpace, c: Client): Promise<Json> {
  for (let i = 0; i < 40; i++) {
    await s.d.hooks?.pump?.();
    const job = (await c.tool("agents_next")).json.result.structuredContent.data.job;
    if (job) return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

const withSpace = (name: string, f: (s: FlowSpace, owner: string) => Promise<void>): void => withOutsideSpace(name, (s, owner) => f(s, owner), ["members", "vault-requests"]);

withSpace("the owner's agent asks to set up Google sign-in: one card for the owner, approve runs it as her, once, exactly as asked, and the answer reaches the agent", async (s, owner) => {
  const c = new Client(`${s.d.url}/mcp`, {}, "Simba (Claude Code)");
  const { agentId } = await signIn(s, c, owner);
  await c.rpc("initialize", INIT);

  // a raw secret never gets onto a card
  const raw = await c.tool("use_tool", { name: "members_sso_set", arguments: { provider: google({ clientSecretHandle: "GOCSPX-raw-secret" }) } });
  assert.equal(raw.json.result.isError, true);
  assert.equal(expectStatus(await s.call("gate.holds.list", owner, {}), 200, "gate.holds.list").holds.length, 0, "no card, so no secret on one");

  const asked = await c.tool("use_tool", { name: "members_sso_set", arguments: { provider: google() } });
  const sc = asked.json.result.structuredContent;
  assert.equal(asked.json.result.isError, true, "not an answer yet");
  assert.deepEqual([sc.held, sc.asksPerson], [true, true], JSON.stringify(sc));
  const taskId = sc.taskId as string;
  assert.equal(expectStatus(await s.call("members.sso.list", owner, {}), 200, "members.sso.list").providers.length, 0, "nothing ran yet");

  // the card: hers alone, named for the agent, what happens and the exact input with the secret as a handle
  const task = expectStatus(await s.call("tasks.get", owner, { taskId }), 200, "tasks.get").task;
  assert.equal(task.kind, "approve");
  assert.deepEqual(task.assigned, { kind: "person", id: "usr_olivia" });
  assert.match(task.title, /^Simba \(Claude Code\) asks: /);
  const pairs = task.blocks.find((b: Json) => b.type === "pairs").data.pairs as string[][];
  assert.deepEqual(pairs.find((p) => p[0] === "Asked by"), ["Asked by", "Simba (Claude Code)"]);
  assert.deepEqual(pairs.find((p) => p[0] === "Runs as"), ["Runs as", "You, once, exactly as shown"]);
  const rows = task.blocks.find((b: Json) => b.type === "table").data.rows as string[][];
  assert.deepEqual(rows, Object.entries(google()).map(([k, v]) => [`provider ${k}`, String(v)]), "the exact input, one value per row");
  assert.match(task.title, /asks: Add or change an OIDC provider \(Google, Microsoft, Okta\)$/, "what happens, in the capability's own words");
  const hold = expectStatus(await s.call("gate.holds.list", owner, { states: ["held"] }), 200, "gate.holds.list").holds.find((h: Json) => h.taskId === taskId);
  assert.deepEqual(hold.principal, { kind: "person", id: "usr_olivia" }, "it runs as her");
  assert.deepEqual(hold.askedBy, { kind: "agent", id: agentId }, "and names the agent");

  // not the agent, not an admin, and not with different input
  assert.equal((await c.tool("use_tool", { name: "tasks_act", arguments: { taskId, action: "approve" } })).json.result.isError, true, "the agent cannot approve its own ask");
  assert.notEqual((await s.call("tasks.act", s.signedIn("usr_adam"), { taskId, action: "approve" })).status, 200, "an admin cannot run it as her");
  const edited = await s.call("tasks.act", owner, { taskId, action: "approve", edits: { provider: google({ clientId: "attacker" }) } });
  assert.equal(edited.body?.error?.code, "validation.field_locked", JSON.stringify(edited.body));

  // her yes: it runs as her, once
  expectStatus(await s.call("tasks.act", owner, { taskId, action: "approve" }), 200, "tasks.act");
  const providers = expectStatus(await s.call("members.sso.list", owner, {}), 200, "members.sso.list").providers as Json[];
  assert.equal(providers.length, 1);
  assert.equal(providers[0].clientId, "123.apps.googleusercontent.com", "exactly what was asked");
  assert.notEqual((await s.call("tasks.act", owner, { taskId, action: "approve" })).status, 200, "single use");
  const changed = await s.d.log!.read({ type: "policy.changed", limit: 50 });
  assert.equal(changed.length, 1, "it ran once");
  assert.equal(changed[0]!.actor, "usr_olivia", "as the person, never as the agent");
  const approved = (await s.d.log!.read({ type: "gate.approved", limit: 50 })).map((e) => payloadOf(e.payload)).find((p) => p.taskId === taskId);
  assert.deepEqual([approved?.by, approved?.askedBy], ["usr_olivia", { kind: "agent", id: agentId }], "logged: who, which agent, what, when");
  const audit = expectStatus(await s.call("audit.list", owner, { limit: 200 }), 200, "audit.list").rows as Json[];
  assert.ok(audit.some((r) => r.action === "members.sso.set" && r.actor?.id === agentId && r.onBehalfOf?.id === "usr_olivia"), "the ask is on the log as the agent's, for her");
  assert.ok(audit.some((r) => r.action === "members.sso.set" && r.actor?.id === "usr_olivia"), "the run is on the log as hers");

  // the answer
  const job = await nextJob(s, c);
  assert.equal(job?.kind, "answer", JSON.stringify(job));
  assert.equal(job.taskId, taskId);
  assert.match(job.text, /^Approved\. members_sso_set ran as the person you act for\. The answer: /);
  assert.match(job.text, /123\.apps\.googleusercontent\.com/);
});

withSpace("declined, it does not run and the agent hears why; a person without the role is not asked at all", async (s, owner) => {
  const c = new Client(`${s.d.url}/mcp`);
  await signIn(s, c, owner);
  await c.rpc("initialize", INIT);
  const asked = (await c.tool("use_tool", { name: "members_sso_set", arguments: { provider: google({ key: "microsoft", title: "Microsoft", issuer: "https://login.microsoftonline.com/common/v2.0", clientId: "ms-1", clientSecretHandle: "#Ms_Secret" }) } })).json.result.structuredContent;
  assert.equal(asked.held, true, JSON.stringify(asked));
  expectStatus(await s.call("tasks.act", owner, { taskId: asked.taskId, action: "reject", note: "Not this week" }), 200, "tasks.act");
  assert.equal(expectStatus(await s.call("members.sso.list", owner, {}), 200, "members.sso.list").providers.length, 0, "nothing ran");
  const job = await nextJob(s, c);
  assert.equal(job?.kind, "answer", JSON.stringify(job));
  assert.match(job.text, /^Not approved\. members_sso_set did not run\. Not this week$/);

  // Noah is a member: he cannot change sign-in, so his agent is refused as before, with who can do it, and nobody gets a card
  const noah = s.signedIn("usr_noah");
  const n = new Client(`${s.d.url}/mcp`, {}, "Noah's Codex");
  await signIn(s, n, noah);
  await n.rpc("initialize", INIT);
  const before = expectStatus(await s.call("gate.holds.list", owner, {}), 200, "gate.holds.list").holds.length;
  const refused = (await n.tool("use_tool", { name: "members_sso_set", arguments: { provider: google() } })).json.result;
  assert.equal(refused.isError, true);
  assert.equal(refused.structuredContent.held, undefined);
  assert.equal(refused.structuredContent.error.details.reason, "person_lacks_role", JSON.stringify(refused.structuredContent));
  assert.match(refused.structuredContent.error.message, /owner or an admin/);
  assert.equal(expectStatus(await s.call("gate.holds.list", owner, {}), 200, "gate.holds.list").holds.length, before, "no hold");
  assert.equal(expectStatus(await s.call("gate.holds.list", noah, {}), 200, "gate.holds.list").holds.length, 0, "and no card for Noah");
});

withSpace("a key goes in by the person's own paste: the agent sends names, the value never reaches it, and it gets the handle", async (s, owner) => {
  const c = new Client(`${s.d.url}/mcp`);
  const { agentId } = await signIn(s, c, owner);
  await c.rpc("initialize", INIT);
  const folder = expectStatus(await s.call("vault.folders.create", owner, { idempotencyKey: "ap-folder", name: "Sign-in", scope: "shared" }), 200, "vault.folders.create").folder.id as string;
  const SECRET = "GOCSPX-only-in-the-vault";

  const withValue = (await c.tool("use_tool", { name: "vault_item_put", arguments: { folderId: folder, name: "Google_Client_Secret", kind: "api_key", fields: [{ key: "value", value: SECRET, secret: true }] } })).json.result;
  assert.equal(withValue.isError, true);
  assert.equal(withValue.structuredContent.error.details.reason, "value_sent");

  const asked = (await c.tool("use_tool", { name: "vault_item_put", arguments: { folderId: folder, name: "Google_Client_Secret", fields: [{ key: "value" }] } })).json.result.structuredContent;
  assert.deepEqual([asked.held, asked.asksPerson, asked.handle], [true, true, "#Google_Client_Secret"], JSON.stringify(asked));
  const requestId = asked.requestId as string;
  assert.match(requestId, /^vrq_/);

  // the paste card is the person's: she types the value in her own app
  expectStatus(await s.call("vault.requests.fulfil", owner, { requestId, fields: [{ key: "value", value: SECRET }] }), 200, "vault.requests.fulfil");
  const job = await nextJob(s, c);
  assert.equal(job?.kind, "answer", JSON.stringify(job));
  assert.match(job.text, /#Google_Client_Secret/);
  assert.equal(JSON.stringify(job).includes(SECRET), false, "the agent never gets the value");
  // and it holds nothing on the item: the Vault stays off from outside, by name or by handle
  const reveal = (await c.tool("use_tool", { name: "vault_item_reveal", arguments: { handle: "#Google_Client_Secret" } })).json.result;
  assert.equal(reveal.isError, true);
  assert.equal(JSON.stringify(reveal).includes(SECRET), false);
  const grants = await s.call("access.grants.list", owner, { subject: { kind: "agent", id: agentId } });
  if (grants.status === 200) assert.equal(JSON.stringify(grants.body).includes("vault_item"), false, "no Use on the item for the outside agent");
});

withSpace("flood guard: the same ask twice is one card; past five open asks for one person the agent is told to wait, and no card is made", async (s, owner) => {
  const c = new Client(`${s.d.url}/mcp`);
  await signIn(s, c, owner);
  await c.rpc("initialize", INIT);
  const ask = async (clientId: string): Promise<Json> => (await c.tool("use_tool", { name: "members_sso_set", arguments: { provider: google({ clientId }) } })).json.result.structuredContent;
  const first = await ask("client-1");
  const again = await ask("client-1");
  assert.equal(again.held, true, JSON.stringify(again));
  assert.equal(again.taskId, first.taskId, "the same pending hold");
  assert.equal(again.already, true);
  const held = async (): Promise<number> => (expectStatus(await s.call("gate.holds.list", owner, { states: ["held"] }), 200, "gate.holds.list").holds as Json[]).length;
  assert.equal(await held(), 1, "one card");
  for (const n of [2, 3, 4, 5]) assert.equal((await ask(`client-${n}`)).held, true);
  assert.equal(await held(), 5);
  const sixth = await ask("client-6");
  assert.equal(sixth.held, undefined, JSON.stringify(sixth));
  assert.equal(sixth.error.details.reason, "asks_waiting");
  assert.equal(sixth.error.message, "You have 5 requests waiting for Olivia Park. Wait for an answer.");
  assert.equal(await held(), 5, "no card past the limit");
});
