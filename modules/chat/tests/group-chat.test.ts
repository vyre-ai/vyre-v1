// A private chat gains people (owner ruling, 4 Nov 2026; lane l-addsheet). Adding a person turns it into a group chat. The newcomer reads from the moment they were added unless "Include earlier messages"
// (fromStart) is on; a goal chat shows its history; the chat's own agents are shown to everyone who reads the chat; and a group chat is no longer private to its starter, so agents stop loading the asker's
// private profile there (lib/audience.ts, the one rule memory and the engine both ask).
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, MAYA, LEO, contractErrors, harness as baseHarness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { ensure, insertThread, addMember } from "../projections.ts";
import { ensureTranscript } from "../handlers/g24d.ts";
import { chatAudience, othersRead } from "../../../lib/audience.ts";

type Fn = (ctx: Harness["ctx"], input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = () => `gc${++n}`;
const failure = async (p: Promise<unknown>): Promise<string> => { try { await p; } catch (e) { return (e as { error?: { code?: string } }).error?.code ?? "unknown"; } return "none"; };

interface Log { shared: Array<Record<string, any>>; unshared: Array<Record<string, any>> }
function world(): { hn: Harness; log: Log } {
  const log: Log = { shared: [], unshared: [] };
  let made = 0;
  const hn = baseHarness({
    calls: {
      "agents.create": (i) => ({ agent: { agentId: `agt_own${++made}`, name: i["name"], kind: "teammate", chatOf: i["threadId"] } }),
      "agents.get": (i) => ({ agent: { agentId: i["agentId"], name: "Checker", runtime: "vyre" } }),
      "access.principals.get": () => ({ principal: { name: "Someone" } }),
      "access.share": (i) => { log.shared.push(i); return { granted: true }; },
      "access.unshare": (i) => { log.unshared.push(i); return { revoked: 1 }; },
      "engine.set_mode": () => ({ mode: "listen", leadAgentId: null }),
    },
  });
  return { hn, log };
}
const chatOf = async (hn: Harness) => (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
const say = async (ctx: Harness["ctx"], threadId: string, body: string) => (await h["chat.post"]!(ctx, { threadId, body, idempotencyKey: key() })).message.messageId as string;
const bodies = async (ctx: Harness["ctx"], threadId: string): Promise<string[]> => (await h["chat.messages.list"]!(ctx, { threadId })).messages.map((m: any) => m.body);

test("adding a person to a private agent chat works and makes it a group chat; the old refusal and its channel offer are gone", async () => {
  const { hn } = world();
  const id = await chatOf(hn);
  const out = await h["threads.members.add"]!(hn.ctx, { threadId: id, personId: MAYA });
  assert.ok(out.thread.members.some((m: any) => m.id === MAYA), "Maya is in");
  assert.deepEqual(contractErrors("threads.members.add", "out", out), []);
  assert.equal(await failure(h["threads.members.add"]!(hn.ctx, { threadId: id, personId: "agt_x" })), "validation.bad_input");
  // Maya can now open and write in it
  await say(hn.person(MAYA), id, "Hello from Maya");
  assert.ok((await bodies(hn.person(MAYA), id)).includes("Hello from Maya"));
});

test("history is hidden by default: the newcomer reads from the moment they were added, in the list, a single message, pins, reading back, the catch-up and search", async () => {
  const { hn } = world();
  const id = await chatOf(hn);
  const before = await say(hn.ctx, id, "The secret retainer is 40000 dollars");
  hn.advance(5_000);
  await h["threads.members.add"]!(hn.ctx, { threadId: id, personId: MAYA });
  hn.advance(5_000);
  await say(hn.ctx, id, "Welcome Maya, retainer talk follows");
  const maya = hn.person(MAYA);
  const seen = await bodies(maya, id);
  assert.ok(!seen.some((b) => b.includes("40000")), "the earlier message is not listed");
  assert.ok(seen.some((b) => b.includes("Welcome Maya")));
  assert.equal(await failure(h["chat.message.get"]!(maya, { threadId: id, messageId: before })), "validation.not_found", "nor fetched by its id");
  const page = await h["chat.history.page"]!(maya, { threadId: id, before: 999 });
  assert.ok(!page.messages.some((m: any) => String(m.body).includes("40000")), "nor read further back");
  const hits = await h["chat.history.search"]!(maya, { q: "retainer" });
  assert.ok(!hits.hits.some((x: any) => String(x.text).includes("40000")), "nor found by searching");
  assert.ok(hits.hits.some((x: any) => String(x.text).includes("Welcome Maya")), "what came after is found");
  const dana = await bodies(hn.ctx, id);
  assert.ok(dana.some((b) => b.includes("40000")), "the person who was always here still reads it all");
  const summary = await h["chat.transcript.summary"]!(maya, { threadId: id });
  assert.equal(summary.summary, "", "no summary of what Maya may not read");
  const forked = await h["chat.fork"]!(maya, { threadId: id, idempotencyKey: key() });
  assert.ok(!(await bodies(maya, forked.thread.threadId)).some((b) => b.includes("40000")), "a fork copies only what she may read");
});

test("with Include earlier messages (fromStart) the newcomer reads from the start, and asking again widens a person who was added without", async () => {
  const { hn } = world();
  const id = await chatOf(hn);
  await say(hn.ctx, id, "The first words");
  hn.advance(5_000);
  await h["threads.members.add"]!(hn.ctx, { threadId: id, personId: MAYA, fromStart: true });
  assert.ok((await bodies(hn.person(MAYA), id)).some((b) => b.includes("The first words")));
  await h["threads.members.add"]!(hn.ctx, { threadId: id, personId: LEO });
  assert.ok(!(await bodies(hn.person(LEO), id)).some((b) => b.includes("The first words")), "default: hidden");
  await h["threads.members.add"]!(hn.ctx, { threadId: id, personId: LEO, fromStart: true });
  assert.ok((await bodies(hn.person(LEO), id)).some((b) => b.includes("The first words")), "widened");
});

test("a goal chat follows the same rule with its history shown", async () => {
  const { hn } = world();
  ensure(hn.db);
  const t = insertThread(hn.ctx, { kind: "chat", title: "Goal: sign the Rivera letter", starter: DANA, listed: true, scopeType: "goal", scopeId: "gol_1", mode: "auto" });
  addMember(hn.ctx, t.id, DANA, "owner");
  await say(hn.ctx, t.id, "Where the goal stands today");
  hn.advance(5_000);
  await h["threads.members.add"]!(hn.ctx, { threadId: t.id, personId: MAYA });
  assert.ok((await bodies(hn.person(MAYA), t.id)).some((b) => b.includes("Where the goal stands")), "a goal chat shows its earlier messages");
});

test("once a person joins, the chat is no longer private to its starter: the audience has two people, so the asker's private profile is not loaded (lib/audience.ts, memory.profile.context)", async () => {
  const { hn } = world();
  const id = await chatOf(hn);
  const call = async (cap: string, input: any) => h[cap]!(hn.ctx, input);
  assert.equal(othersRead(await chatAudience(call, id), DANA), false, "alone with the agent: private");
  await h["threads.members.add"]!(hn.ctx, { threadId: id, personId: MAYA });
  const a = await chatAudience(call, id);
  assert.deepEqual([...a.people].sort(), [DANA, MAYA]);
  assert.equal(othersRead(a, DANA), true, "a group chat: others read it, so only the public profile loads");
});

test("an agent the chat made is shown to everyone who reads the chat, whoever made it; a joiner gets it and a leaver loses it", async () => {
  const { hn, log } = world();
  const id = await chatOf(hn);
  await h["threads.members.add"]!(hn.ctx, { threadId: id, personId: MAYA });
  hn.advance(10);
  await h["threads.agent.create"]!(hn.person(MAYA), { threadId: id, name: "Checker", idempotencyKey: key() });
  const toPeople = (l: Array<Record<string, any>>) => l.map((g) => g["subject"].id).sort();
  assert.deepEqual(toPeople(log.shared), [DANA, MAYA], "Dana made nothing, and still sees what Maya's chat made");
  assert.ok(log.shared.every((g) => g["resource"].type === "agent" && g["source"] === `chat:${id}`));
  await h["threads.members.add"]!(hn.ctx, { threadId: id, personId: LEO });
  assert.ok(log.shared.some((g) => g["subject"].id === LEO), "a joiner sees it");
  await h["threads.members.remove"]!(hn.ctx, { threadId: id, personId: LEO });
  assert.deepEqual(log.unshared.map((g) => [g["subject"].id, g["source"]]), [[LEO, `chat:${id}`]], "and a leaver does not");
});

test("the file export of a chat (its transcript) and the channel stream hold the same line: nothing from before a newcomer's start", async () => {
  const { hn } = world();
  const id = await chatOf(hn);
  ensureTranscript(hn.db);
  const row = (idx: number, at: number, text: string) => hn.db.run("INSERT INTO chat_transcript_row (thread, idx, turnId, author, role, kind, content, at) VALUES (?, ?, 'trn_1', ?, 'user', 'text', ?, ?)", id, idx, DANA, JSON.stringify(text), at);
  const t0 = hn.clock.t;
  row(1, t0, "the old retainer in the transcript");
  hn.advance(5_000);
  await h["threads.members.add"]!(hn.ctx, { threadId: id, personId: MAYA });
  hn.advance(5_000);
  row(2, hn.clock.t, "after Maya joined");
  const maya = (await h["chat.transcript.read"]!(hn.person(MAYA), { threadId: id })).markdown as string;
  assert.ok(!maya.includes("the old retainer"), "not in her export");
  assert.ok(maya.includes("after Maya joined"));
  assert.ok((await h["chat.transcript.read"]!(hn.ctx, { threadId: id })).markdown.includes("the old retainer"), "Dana's export still has it");
});

test("a chat of two people with an agent (not a direct message since l-polish L0) still hides its earlier messages from a third person added later", async () => {
  const { hn } = world();
  const id = await chatOf(hn);
  await h["threads.members.add"]!(hn.ctx, { threadId: id, personId: MAYA });
  await say(hn.ctx, id, "Dana: the settlement floor is 120000");
  await say(hn.person(MAYA), id, "Maya: and the client wants it quiet");
  hn.advance(5_000);
  await h["threads.members.add"]!(hn.ctx, { threadId: id, personId: LEO });
  hn.advance(5_000);
  await say(hn.ctx, id, "Leo is here now");
  const leo = hn.person(LEO);
  const seen = await bodies(leo, id);
  assert.ok(!seen.some((b) => b.includes("120000") || b.includes("quiet")), `the newcomer reads nothing from before: ${seen.join(" | ")}`);
  assert.ok(seen.some((b) => b.includes("Leo is here now")));
  const hits = await h["chat.history.search"]!(leo, { q: "settlement" });
  assert.ok(!hits.hits.some((x: any) => String(x.text).includes("120000")), "nor by search");
  assert.ok((await bodies(hn.person(MAYA), id)).some((b) => b.includes("120000")), "Maya, there from before, reads it all");
});
