// One audience check on every memory read (agent-visibility gaps 3 and 4, memory audit items 1 and 2). In a chat other people read, an agent working for Dana never gets Dana's own memory from any
// memory tool, not only recall, search and quote; shared memory (agent, project, Space) comes back only when every person in the chat may open it; and what an agent learned in an invite-only
// channel is kept for that channel's people: it is never recalled in a chat whose people are not all in the channel.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../handlers/index.ts";
import { capture, pointer, search } from "../handlers/facts.ts";
import { remember } from "../handlers/tools.ts";
import { pagePut } from "../handlers/pages.ts";
import { recallRecord } from "../handlers/recalllog.ts";
import { harness, openRaw, NOW, seedFact } from "../fixtures/harness.ts";
import type { Harness, HarnessOptions } from "../fixtures/harness.ts";
import { sealText } from "../projections.ts";
import type { MemCtx } from "../projections.ts";

const AGENT = "agt_intake", DANA = "usr_dana", MAYA = "usr_maya", GUEST = "usr_gus";
const SECRET = "zebra";
const person = (id: string) => ({ kind: "person", id });
const chatOf = (...people: string[]) => ({ thread: { kind: "chat", starter: people[0], members: [...people.map(person), { kind: "agent", id: AGENT }] } });

/** Dana's world: what she told the agent in her own chat, a personal note and a personal page, all mentioning the secret word; a recall of one fact in her own chat; one personal fact in Trash. */
async function danasWorld(raw = openRaw()): Promise<{ raw: ReturnType<typeof openRaw>; factId: string; noteId: string; pageId: string }> {
  const dana = harness({ raw, respond: { "files.read": () => ({ text: `my ${SECRET} notes` }) } });
  const fact = await remember(dana.ctx, { text: `Dana's knee surgery is the ${SECRET} plan`, agentId: AGENT, threadId: "thr_dana" });
  const gone = await remember(dana.ctx, { text: `Dana's old ${SECRET} diet`, agentId: AGENT, threadId: "thr_dana" });
  dana.db.run("UPDATE memory_facts SET trashed_at = ?, trash_reason = 'removed', trashed_by = ? WHERE id = ?", NOW, DANA, gone.fact.factId);
  const noteId = "not_dana1";
  dana.db.run(
    "INSERT INTO memory_notes (note_id, file_id, path, title, sealed_title, layer, owner_ref, agent_id, project_id, area, body, updated_at) VALUES (?, ?, ?, '', ?, 'person', ?, ?, NULL, 'notes', '', ?)",
    noteId, "fil_dana1", `People/${DANA}/memory/${AGENT}/notes/${SECRET}.md`, sealText(dana.ctx, DANA, `${SECRET} note`), DANA, AGENT, NOW,
  );
  const page = await pagePut(dana.ctx, { title: `Dana ${SECRET}`, layer: "person", notes: `The ${SECRET} page of Dana` });
  await recallRecord(dana.ctx, { threadId: "thr_dana", messageId: "msg_dana", agentId: AGENT, lines: [{ kind: "fact", ref: fact.fact.factId }, { kind: "quote", ref: "thr_dana#1" }] });
  return { raw, factId: fact.fact.factId, noteId, pageId: page.page.pageId };
}

/** The agent at work for Dana in a chat with Maya: every read it makes carries the chat. */
function agentInShared(raw: ReturnType<typeof openRaw>, extra: Omit<HarnessOptions, "raw" | "principal" | "actingFor"> = {}): Harness & { ctx: MemCtx } {
  const respond = {
    "threads.get": (b: Record<string, unknown>) => (b["threadId"] === "thr_dana" ? chatOf(DANA) : chatOf(DANA, MAYA)),
    "files.read": () => ({ text: `my ${SECRET} notes` }),
    "files.versions": () => ({ versions: [] }),
    "search.resolve": () => ({}),
    "chat.message.get": () => ({ message: { createdAt: NOW + 1 } }),
    // the chat module answers as the asker: Dana may open her own chat, so her own words come back from it
    "chat.history.search": () => ({ hits: [{ source: "message", ref: "thr_dana#1", threadId: "thr_dana", threadKind: "chat", seq: 1, role: "person", author: person(DANA), text: `my ${SECRET} plan`, at: NOW, link: "vyre://thread/thr_dana", score: 1 }] }),
    ...(extra.respond ?? {}),
  };
  const h = harness({ ...extra, raw, principal: { kind: "agent", id: AGENT }, actingFor: DANA, respond });
  (h.ctx as MemCtx & { thread?: string }).thread = "thr_shared";
  return h;
}

/** Inputs for every memory read an agent can make. A read that returns no memory content is listed in NO_CONTENT with why. */
const INPUTS: Record<string, (w: { factId: string; noteId: string; pageId: string }) => Record<string, unknown>> = {
  "memory.search": () => ({ q: SECRET, mode: "keyword" }),
  "memory.quote": () => ({ q: `${SECRET} plan` }),
  "memory.used": () => ({ threadId: "thr_dana", messageId: "msg_dana" }),
  "memory.read_note": (w) => ({ noteId: w.noteId }),
  "memory.facts_as_of": () => ({ date: NOW + 1000 }),
  "memory.facts.list": () => ({}),
  "memory.fact.get": (w) => ({ factId: w.factId }),
  "memory.notes.list": () => ({}),
  "memory.pointer": () => ({ threadId: "thr_shared", agentId: AGENT, text: `the ${SECRET} plan for the knee` }),
  "memory.learned": () => ({}),
  "memory.trash.search": () => ({ q: SECRET }),
  "memory.page.get": (w) => ({ pageId: w.pageId }),
  "memory.page.list": () => ({}),
  "memory.page.versions": (w) => ({ pageId: w.pageId }),
  "memory.backlinks": (w) => ({ pageId: w.pageId }),
  "memory.export_markdown": () => ({ includePersonal: true }),
  "memory.questions.list": () => ({}),
  "memory.versions": (w) => ({ noteId: w.noteId }),
};
const NO_CONTENT: Record<string, string> = {
  "memory.keys.get": "which account pays for upkeep: no memory text",
  "memory.layers.list": "layer names and flags",
  "memory.counts": "numbers only",
  "memory.map.get": "MAP.md is the agent layer only, never a person's memory",
  "memory.graph": "agent, project and Space layers only",
  "memory.graph_everything": "admins only, never personal layers",
  "memory.layout.get": "node positions",
  "memory.trail": "the trail never holds content",
  "memory.upkeep.status": "spend and run counts",
  "memory.meaning.status": "model state",
  "memory.meaning.rank": "ranks text the caller already holds",
};

test("every memory read an agent can call is in the table: a new tool cannot skip the audience check", () => {
  type Cap = { name: string; module?: string; effects?: string; surfaces?: { mcp?: { toolset?: string } } };
  const reads = (registry.capabilities as unknown as Cap[]).filter((c) => c.module === "memory" && c.effects === "read" && c.surfaces?.mcp?.toolset === "memory").map((c) => c.name).sort();
  assert.ok(reads.length >= 25, `the registry lists the memory reads: ${reads.length}`);
  const covered = [...Object.keys(INPUTS), ...Object.keys(NO_CONTENT)].sort();
  assert.deepEqual(reads.filter((n) => !covered.includes(n)), [], "a memory read with no row in this test");
});

for (const cap of Object.keys(INPUTS)) {
  test(`${cap}: in a chat with Maya, the agent working for Dana gets none of Dana's own memory`, async () => {
    const w = await danasWorld();
    const h = agentInShared(w.raw);
    const fn = (handlers as Record<string, (ctx: MemCtx, input: unknown) => Promise<unknown>>)[cap]!;
    let out: unknown;
    try { out = await fn(h.ctx, INPUTS[cap]!(w)); } catch (e) { out = { refused: (e as { error?: { code?: string } }).error?.code ?? String(e) }; }
    assert.equal(JSON.stringify(out).toLowerCase().includes(SECRET), false, `${cap} answered ${JSON.stringify(out).slice(0, 400)}`);
  });
}

test("alone with Dana, the same reads still reach her memory (the check is the chat's audience, not a blanket refusal)", async () => {
  const w = await danasWorld();
  const h = harness({ raw: w.raw, principal: { kind: "agent", id: AGENT }, actingFor: DANA, respond: { "files.read": () => ({ text: `my ${SECRET} notes` }) } });
  (h.ctx as MemCtx & { thread?: string }).thread = "thr_dana";
  for (const cap of ["memory.facts_as_of", "memory.fact.get", "memory.read_note", "memory.page.get", "memory.search"]) {
    const out = await (handlers as Record<string, (ctx: MemCtx, input: unknown) => Promise<unknown>>)[cap]!(h.ctx, INPUTS[cap]!(w));
    assert.ok(JSON.stringify(out).toLowerCase().includes(SECRET), `${cap} in Dana's own chat: ${JSON.stringify(out).slice(0, 300)}`);
  }
});

test("shared memory in a mixed chat: a project fact Dana may open but the guest may not stays out of every read", async () => {
  const raw = openRaw();
  const seed = harness({ raw });
  seedFact(seed, { id: "fct_proj", layer: "project", projectId: "prj_harlow", agentId: null, text: `Harlow settlement ${SECRET} figure` });
  seedFact(seed, { id: "fct_space", layer: "space", text: `Office closes at five, ${SECRET} rule` });
  const respond = { "threads.get": () => chatOf(DANA, GUEST) };
  // the guest cannot open the project's folder; Dana can
  const h = agentInShared(raw, { respond, denyFor: { [GUEST]: ["folder:fld_harlow"] } });
  const text = async (p: Promise<unknown>): Promise<string> => JSON.stringify(await p);
  const searched = await text(search(h.ctx, { q: SECRET, mode: "keyword" }));
  assert.ok(!searched.includes("Harlow"), searched);
  assert.ok(searched.includes("Office closes"), "what everyone here may open still comes back");
  assert.ok(!(await text(pointer(h.ctx, { threadId: "thr_shared", agentId: AGENT, text: `Harlow settlement ${SECRET} figure` }))).includes("Harlow"));
  assert.ok(!(await text(handlers["memory.facts_as_of"](h.ctx as never, { date: NOW } as never))).includes("Harlow"));
  assert.ok(!(await text(handlers["memory.fact.get"](h.ctx as never, { factId: "fct_proj" } as never).catch(() => ({})))).includes("Harlow"));
  // the same chat with only Dana and Maya, who may both open the project: it comes back
  const both = agentInShared(raw, { respond: { "threads.get": () => chatOf(DANA, MAYA) } });
  assert.ok((await text(search(both.ctx, { q: SECRET, mode: "keyword" }))).includes("Harlow"));
});

test("what an agent learns in an invite-only channel is kept for that channel's people", async () => {
  const raw = openRaw();
  const channel = { thread: { threadId: "thr_ch", kind: "channel", channelId: "chn_deals", starter: DANA, members: [person(DANA), person(MAYA)], agents: [{ agentId: AGENT, mode: "listen" }] } };
  const channelGet = { channel: { channelId: "chn_deals", visibility: "invite", members: [person(DANA), person(MAYA)] } };
  const said = [{ messageId: "msg_1", threadId: "thr_ch", author: person(DANA), body: `We decided the ${SECRET} merger closes in May.`, createdAt: NOW }];
  const capturing = harness({ raw, principal: { kind: "service", id: "svc_memory" }, respond: { "threads.get": () => channel, "channels.get": () => channelGet, "chat.messages.list": () => ({ messages: said }), "agents.get": () => ({ agent: { captureMode: "auto", folderId: "fld_intake" } }) } });
  const out = await capture(capturing.ctx, { threadId: "thr_ch", reason: "closed" });
  assert.ok(out.merged >= 1, JSON.stringify(out));
  const ask = `the ${SECRET} merger closes in May`;
  const lines = async (who: string, threadId: string, respond: Record<string, (b: Record<string, unknown>) => unknown>): Promise<string> => {
    const h = harness({ raw, principal: { kind: "person", id: who }, respond: { "agents.get": () => ({ agent: { folderId: "fld_intake" } }), ...respond } });
    return JSON.stringify(await pointer(h.ctx, { threadId, agentId: AGENT, text: ask }));
  };
  // in the channel itself, and in Maya's own chat with the agent (she is in the channel): it comes back
  assert.match(await lines(MAYA, "thr_ch", { "threads.get": () => channel, "channels.get": () => channelGet }), /merger/);
  assert.match(await lines(MAYA, "thr_maya", { "threads.get": () => chatOf(MAYA) }), /merger/);
  // Leo was never in the channel: not in his own chat with the agent
  assert.doesNotMatch(await lines("usr_leo", "thr_leo", { "threads.get": () => chatOf("usr_leo") }), /merger/);
  // nor in a chat of Maya's that Leo is in
  assert.doesNotMatch(await lines(MAYA, "thr_mix", { "threads.get": () => chatOf(MAYA, "usr_leo") }), /merger/);
  // and an agent's own search outside any chat, for Leo, does not find it either
  const leo = harness({ raw, principal: { kind: "agent", id: AGENT }, actingFor: "usr_leo", respond: { "agents.get": () => ({ agent: { folderId: "fld_intake" } }) } });
  assert.doesNotMatch(JSON.stringify(await search(leo.ctx, { q: "merger", mode: "keyword" })), /merger/);
});

test("a fact an agent saves for its own memory from a mixed chat is kept for that chat's people", async () => {
  const raw = openRaw();
  const h = agentInShared(raw, { respond: { "agents.get": () => ({ agent: { folderId: "fld_intake", captureMode: "auto", ownerId: DANA } }) } });
  const saved = await remember(h.ctx, { text: `Maya's ${SECRET} budget is tight`, layer: "agent", agentId: AGENT, threadId: "thr_shared" });
  assert.equal(saved.fact.layer, "agent");
  const leo = harness({ raw, principal: { kind: "person", id: "usr_leo" }, respond: { "threads.get": () => chatOf("usr_leo"), "agents.get": () => ({ agent: { folderId: "fld_intake" } }) } });
  assert.doesNotMatch(JSON.stringify(await pointer(leo.ctx, { threadId: "thr_leo", agentId: AGENT, text: `Maya ${SECRET} budget tight` })), /budget/);
  const maya = harness({ raw, principal: { kind: "person", id: MAYA }, respond: { "threads.get": () => chatOf(MAYA), "agents.get": () => ({ agent: { folderId: "fld_intake" } }) } });
  assert.match(JSON.stringify(await pointer(maya.ctx, { threadId: "thr_maya", agentId: AGENT, text: `Maya ${SECRET} budget tight` })), /budget/);
});

test("memory.quote by ref: a line asked for by its ref is held to the same rule", async () => {
  const w = await danasWorld();
  const h = agentInShared(w.raw);
  const out = await handlers["memory.quote"](h.ctx as never, { ref: "thr_dana#1" } as never);
  assert.equal(JSON.stringify(out).includes(SECRET), false, JSON.stringify(out));
  // in Dana's own chat the same ref answers
  const alone = agentInShared(w.raw, { respond: { "threads.get": () => chatOf(DANA) } });
  (alone.ctx as MemCtx & { thread?: string }).thread = "thr_dana";
  assert.ok(JSON.stringify(await handlers["memory.quote"](alone.ctx as never, { ref: "thr_dana#1" } as never)).includes(SECRET));
});

test("a record comment's Ask posts its answer on the record: Dana's own memory stays out of it; her private Ask pane on the same record keeps it", async () => {
  const w = await danasWorld();
  const ask = (recordId: boolean) => agentInShared(w.raw, { respond: { "threads.get": () => ({ thread: { kind: "ask", starter: DANA, scopeType: "record", scopeId: "rec_1", ...(recordId ? { recordId: "rec_1" } : {}), members: [person(DANA), { kind: "agent", id: AGENT }] } }) } });
  const said = async (h: Harness): Promise<string> => JSON.stringify(await pointer(h.ctx, { threadId: "thr_shared", agentId: AGENT, text: `the ${SECRET} plan for the knee` }));
  assert.ok(!(await said(ask(true))).includes(SECRET), "the comment's Ask is read by the record's readers");
  assert.ok((await said(ask(false))).includes(SECRET), "the Ask pane Dana opened on the record is hers alone");
});
