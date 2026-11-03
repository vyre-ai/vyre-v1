// Private agents on a booted daemon (l-outsidepriv): the owner, Olivia, connects Claude Code as "Simba (Claude Code)"; Noah and Adam are members. Simba and Olivia's assistant are hers alone:
// what the members' shell offers (built from their real access.principals.list and agents.list answers) never holds them, and a chat or an @mention of Simba is refused in plain words.
// Owner ruling (3 Nov): what it does where others see it (a channel post, a record, an automation) is credited to Olivia, "Olivia ... (Agent)", never "Simba"; Olivia herself sees "Simba";
// the audit row keeps the headline and adds which agent, its id, the setup grant and the trace. Owners and admins see every outside agent in Console and can remove one.
import assert from "node:assert/strict";
import { expectStatus } from "../golden/steps/02-space.ts";
import { Client, signIn, withOutsideSpace } from "./support/outside-client.ts";
import { directoryOf, offered } from "../apps/app/src/shell/session/private-agents.ts";
import { agentDetails } from "../apps/app/src/console/pages/audit/model.ts";
import { PRIVATE_AGENT } from "../modules/agents/projections.ts";

type Json = any;   // eslint-disable-line @typescript-eslint/no-explicit-any
const INIT = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1" } };
const OLIVIA = "usr_olivia", NOAH = "usr_noah", ADAM = "usr_adam";
const NO_OWN = { id: "", name: "" };
/** A person's shell directory, from their own real answers: id to the name every screen shows. */
async function namesFor(s: Parameters<Parameters<typeof withOutsideSpace>[1]>[0], who: string, id: string): Promise<Map<string, { name: string; agentName?: string }>> {
  const agents = expectStatus(await s.call("agents.list", who, { teammates: "include", limit: 500 }), 200, "agents.list").agents as Json[];
  const principals = expectStatus(await s.call("access.principals.list", who, {}), 200, "access.principals.list").principals as Json[];
  return new Map(directoryOf(principals, NO_OWN, id, new Set(agents.map((a) => a.agentId as string))).map((p) => [p.id, p] as const));
}
const actorsIn = (v: unknown): string[] => [...new Set(JSON.stringify(v).match(/agt_[a-z0-9]+|usr_[a-z0-9]+/g) ?? [])];

withOutsideSpace("Simba and the owner's assistant are invisible to members, refused by id, named where Simba worked; an admin sees and removes outside agents in Console", async (s, owner, mcp) => {
  const c = new Client(mcp, {}, "Simba (Claude Code)");
  const { agentId: simba } = await signIn(s, c, owner, { setup: true });
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
    const dir = directoryOf(principals, NO_OWN, id, usable);
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
  const noahSees = await namesFor(s, noah, NOAH);
  const credited = noahSees.get(simba)?.name ?? "";
  assert.match(credited, /^Olivia\b.* \(Agent\)$/, `Noah sees the post credited to Olivia as her agent, got ${credited}`);
  assert.equal(credited.includes("Simba"), false, "the agent's own name never shows to Noah");
  const oliviaSees = await namesFor(s, owner, OLIVIA);
  assert.equal(oliviaSees.get(simba)?.name, "Simba (Claude Code)", "Olivia sees her agent by name");

  // a record and an automation Simba creates: whoever the history names for it reads, to Noah, as Olivia's agent
  const rec = await c.tool("use_tool", { name: "records_create", arguments: { type: "contact", fields: { name: "Ada Lovelace" }, idempotencyKey: "simba-rec" } });
  const recordId = rec.json.result?.structuredContent?.data?.record?.id as string;
  assert.ok(recordId, JSON.stringify(rec.json).slice(0, 400));
  // Noah can read the record; the one log that names who made it (the audit row, below) names Simba, and Noah's shell names that id as Olivia's agent
  expectStatus(await s.call("records.activity", noah, { type: "contact", recordId }), 200, "records.activity");
  const auto = await c.tool("use_tool", { name: "automations_create", arguments: { name: "Weekly digest", idempotencyKey: "simba-auto" } });
  const automationId = auto.json.result?.structuredContent?.data?.automation?.id as string;
  assert.ok(automationId, JSON.stringify(auto.json).slice(0, 400));
  const versions = await s.call("automations.versions", owner, { automationId });
  const who = actorsIn(versions.body).filter((x) => x === simba || x === OLIVIA);
  assert.ok(who.length > 0, `the automation's history names its maker: ${JSON.stringify(versions.body).slice(0, 300)}`);
  for (const x of who) assert.match(noahSees.get(x)?.name ?? "", /^Olivia\b/, "to Noah, the automation is Olivia's (or her agent's)");

  // the audit row: the headline credits Olivia's agent; the details line says which agent, its id, the setup grant and the trace
  const audit = expectStatus(await s.call("audit.list", owner, { limit: 300 }), 200, "audit.list").rows as Json[];
  const row = audit.find((r) => r.actor?.id === simba && r.action === "records.create");
  assert.ok(row, "an audit row for Simba's record");
  const details = agentDetails(row, oliviaSees.get(simba)?.agentName ?? oliviaSees.get(simba)?.name);
  assert.match(details ?? "", new RegExp(`^Simba \\(Claude Code\\) · ${simba} · .*trace ${row.traceId}$`));
  assert.equal(agentDetails(row, noahSees.get(simba)?.agentName)?.startsWith("Simba (Claude Code)"), true, "the log names the agent, the screens never do");

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
}, ["records", "automations"]);
