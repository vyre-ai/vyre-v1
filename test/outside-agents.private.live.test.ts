// Private agents on a booted daemon (l-outsidepriv): the owner, Olivia, connects Claude Code as "Simba (Claude Code)"; Noah and Adam are members. Simba and Olivia's assistant are hers alone:
// what the members' shell offers (built from their real access.principals.list and agents.list answers) never holds them, a chat or an @mention of Simba is refused in plain words, and
// search does not find it. Its post in a public channel still reaches everyone, named with its person. Owners and admins see every outside agent in Console and can remove one.
import assert from "node:assert/strict";
import { expectStatus } from "../golden/steps/02-space.ts";
import { Client, signIn, withOutsideSpace } from "./support/outside-client.ts";
import { attributed, offered, principalOf } from "../apps/app/src/shell/session/private-agents.ts";
import { PRIVATE_AGENT } from "../modules/agents/projections.ts";

type Json = any;   // eslint-disable-line @typescript-eslint/no-explicit-any
const INIT = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1" } };
const OLIVIA = "usr_olivia", NOAH = "usr_noah", ADAM = "usr_adam";

withOutsideSpace("Simba and the owner's assistant are invisible to members, refused by id, named where Simba worked; an admin sees and removes outside agents in Console", async (s, owner, mcp) => {
  const c = new Client(mcp, {}, "Simba (Claude Code)");
  const { agentId: simba } = await signIn(s, c, owner);
  await c.rpc("initialize", INIT);
  const mine = expectStatus(await s.call("agents.list", owner, { limit: 500 }), 200, "agents.list").agents as Json[];
  assert.ok(mine.some((a) => a.agentId === simba), "Olivia sees her own outside agent");
  const oliviasAssistant = mine.find((a) => a.kind === "assistant" && a.ownerId === OLIVIA)?.agentId as string | undefined;

  for (const id of [NOAH, ADAM]) {
    const who = s.signedIn(id);
    const agents = expectStatus(await s.call("agents.list", who, { teammates: "include", limit: 500 }), 200, "agents.list").agents as Json[];
    const principals = expectStatus(await s.call("access.principals.list", who, {}), 200, "access.principals.list").principals as Json[];
    // what was visible before: the Space's principal directory names every agent, Simba and every assistant included, and the shell offered all of it to mention and to Cmd-K
    assert.ok(principals.some((p) => p.id === simba), `${id}: the directory still names Simba, so its work stays attributed`);
    assert.equal(agents.some((a) => a.agentId === simba), false, `${id}: agents.list has no row for Simba`);
    if (oliviasAssistant) assert.equal(agents.some((a) => a.agentId === oliviasAssistant), false, `${id}: nor for Olivia's assistant`);
    assert.equal(agents.some((a) => a.kind === "assistant" && a.ownerId !== id), false, `${id}: no one else's assistant`);
    // the shell's directory, built from these two real answers
    const usable = new Set(agents.map((a) => a.agentId as string));
    const dir = principals.map((p) => principalOf(p, { id: "", name: "" }, id, usable));
    const shown = dir.filter(offered).map((p) => p.id);
    assert.equal(shown.includes(simba), false, `${id}: Simba is not offered to @mention or in Cmd-K`);
    for (const p of principals) if (p.kind === "agent" && p.owner && p.owner !== id && !usable.has(p.id)) assert.equal(shown.includes(p.id), false, `${id}: ${p.name} is not offered`);
    // a direct reach by id is refused in plain words
    const get = await s.call("agents.get", who, { agentId: simba });
    assert.equal(get.status, 404, JSON.stringify(get.body));
    assert.equal(get.body.error.message, PRIVATE_AGENT);
    const chat = await s.call("chat.start", who, { kind: "chat", agentIds: [simba], idempotencyKey: `${id}-chat-simba` });
    assert.notEqual(chat.status, 200, `${id}: cannot open a chat with Simba`);
    assert.equal(chat.body.error.message, PRIVATE_AGENT, JSON.stringify(chat.body));
  }

  // Simba works in a public channel: everyone sees the post, named with its person
  const channel = expectStatus(await s.call("channels.create", owner, { name: "launch", visibility: "public", memberIds: [NOAH, ADAM], agentIds: [simba], idempotencyKey: "launch-channel" }), 200, "channels.create").channel;
  const posted = await c.tool("chat_post", { threadId: channel.mainThreadId, body: "The pricing page draft is up.", idempotencyKey: "simba-post" });
  assert.equal(posted.json.result?.isError ?? false, false, JSON.stringify(posted.json).slice(0, 400));
  const noah = s.signedIn(NOAH);
  const msgs = expectStatus(await s.call("chat.messages.list", noah, { threadId: channel.mainThreadId }), 200, "chat.messages.list").messages as Json[];
  const byIt = msgs.find((m) => JSON.stringify(m).includes(simba) && m.body?.includes("pricing page"));
  assert.ok(byIt, "Noah sees Simba's post in the channel");
  const noahsAgents = new Set((expectStatus(await s.call("agents.list", noah, { limit: 500 }), 200, "agents.list").agents as Json[]).map((a) => a.agentId as string));
  const noahsDir = (expectStatus(await s.call("access.principals.list", noah, {}), 200, "access.principals.list").principals as Json[]).map((p) => principalOf(p, { id: "", name: "" }, NOAH, noahsAgents));
  const byId = new Map(noahsDir.map((p) => [p.id, p] as const));
  assert.match(attributed(byId.get(simba), (x) => byId.get(x)?.name) ?? "", /^Simba \(Claude Code\) · \S+’s agent$/, "named with its person");
  // and Noah cannot @mention it there
  const mention = await s.call("chat.post", noah, { threadId: channel.mainThreadId, body: "@Simba hi", mentions: [{ kind: "agent", id: simba }], idempotencyKey: "noah-at-simba" });
  assert.notEqual(mention.status, 200, "an @mention of Simba is refused");
  assert.equal(mention.body.error.message, PRIVATE_AGENT, JSON.stringify(mention.body));

  // Console: Noah connects his own; Olivia (owner) sees it with its person, does not get it in her agents list even with All in the Space, and removes it
  const n = new Client(mcp, {}, "Noah's Codex");
  const { agentId: noahs } = await signIn(s, n, noah);
  expectStatus(await s.call("agents.visibility.set", owner, { all: true }), 200, "agents.visibility.set");
  const console = expectStatus(await s.call("mcp.connected.list", owner, { all: true }), 200, "mcp.connected.list").agents as Json[];
  assert.deepEqual(console.filter((a) => a.agentId === noahs).map((a) => a.person), [NOAH], "Console shows Noah's agent and who connected it");
  assert.equal((expectStatus(await s.call("agents.list", owner, { limit: 500 }), 200, "agents.list").agents as Json[]).some((a) => a.agentId === noahs), false, "not in her own lists");
  assert.notEqual((await s.call("chat.start", owner, { kind: "chat", agentIds: [noahs], idempotencyKey: "olivia-chat-noahs" })).status, 200, "she cannot chat as or with it");
  const removed = await s.call("mcp.connected.remove", owner, { agentId: noahs });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal((expectStatus(await s.call("mcp.connected.list", owner, { all: true }), 200, "mcp.connected.list").agents as Json[]).some((a) => a.agentId === noahs), false, "gone from Console");
});
