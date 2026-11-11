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

/** threads.get as the host answers it: a chat the caller can open answers with its own threadId; any other is refused (a place is not readable through some other chat). */
const threadsById = (known: Record<string, unknown>) => (b: Record<string, unknown>): unknown => {
  const t = known[String(b["threadId"])] as { thread?: Record<string, unknown> } | undefined;
  if (!t) throw new Error("not found");
  return { thread: { threadId: b["threadId"], ...t.thread } };
};

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
  "memory.profile.get": () => ({}),
  "memory.place.list": () => ({ placeKind: "chat", placeId: "thr_dana", history: true }),
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
  const lines = async (who: string, threadId: string, known: Record<string, unknown>): Promise<string> => {
    const h = harness({ raw, principal: { kind: "person", id: who }, respond: { "agents.get": () => ({ agent: { folderId: "fld_intake" } }), "threads.get": threadsById(known), "channels.get": () => channelGet } });
    return JSON.stringify(await pointer(h.ctx, { threadId, agentId: AGENT, text: ask }));
  };
  // in the channel itself, and in Maya's own chat with the agent (she is in the channel): it comes back
  assert.match(await lines(MAYA, "thr_ch", { thr_ch: channel }), /merger/);
  assert.match(await lines(MAYA, "thr_maya", { thr_maya: chatOf(MAYA), thr_ch: channel }), /merger/);
  // Leo was never in the channel: he cannot open it, so not in his own chat with the agent
  assert.doesNotMatch(await lines("usr_leo", "thr_leo", { thr_leo: chatOf("usr_leo") }), /merger/);
  // nor in a chat of Maya's that Leo is in
  assert.doesNotMatch(await lines(MAYA, "thr_mix", { thr_mix: chatOf(MAYA, "usr_leo"), thr_ch: channel }), /merger/);
  // and an agent's own search outside any chat, for Leo, does not find it either
  const leo = harness({ raw, principal: { kind: "agent", id: AGENT }, actingFor: "usr_leo", respond: { "agents.get": () => ({ agent: { folderId: "fld_intake" } }) } });
  assert.doesNotMatch(JSON.stringify(await search(leo.ctx, { q: "merger", mode: "keyword" })), /merger/);
});

test("a fact an agent saves for its own memory from a mixed chat is kept for that chat's people", async () => {
  const raw = openRaw();
  const h = agentInShared(raw, { respond: { "agents.get": () => ({ agent: { folderId: "fld_intake", captureMode: "auto", ownerId: DANA } }) } });
  const saved = await remember(h.ctx, { text: `Maya's ${SECRET} budget is tight`, layer: "agent", agentId: AGENT, threadId: "thr_shared" });
  assert.equal(saved.fact.layer, "agent");
  const leo = harness({ raw, principal: { kind: "person", id: "usr_leo" }, respond: { "threads.get": threadsById({ thr_leo: chatOf("usr_leo") }), "agents.get": () => ({ agent: { folderId: "fld_intake" } }) } });
  assert.doesNotMatch(JSON.stringify(await pointer(leo.ctx, { threadId: "thr_leo", agentId: AGENT, text: `Maya ${SECRET} budget tight` })), /budget/);
  const maya = harness({ raw, principal: { kind: "person", id: MAYA }, respond: { "threads.get": threadsById({ thr_maya: chatOf(MAYA), thr_shared: chatOf(DANA, MAYA) }), "agents.get": () => ({ agent: { folderId: "fld_intake" } }) } });
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

test("D5: an agent learns from a private channel, and those facts stay with its members: recalled and readable only where every reader is a member", async () => {
  const raw = openRaw();
  const channel = { thread: { threadId: "thr_ch", kind: "channel", channelId: "chn_deals", starter: DANA, members: [person(DANA), person(MAYA)], agents: [{ agentId: AGENT, mode: "listen" }] } };
  const channelGet = { channel: { channelId: "chn_deals", visibility: "invite", members: [person(DANA), person(MAYA)] } };
  const said = [{ messageId: "msg_1", threadId: "thr_ch", author: person(MAYA), body: `We agreed the ${SECRET} vendor gets paid net 60.`, createdAt: NOW }];
  const cap = harness({ raw, principal: { kind: "service", id: "svc_memory" }, respond: { "threads.get": () => channel, "channels.get": () => channelGet, "chat.messages.list": () => ({ messages: said }), "agents.get": () => ({ agent: { captureMode: "auto", folderId: "fld_intake" } }) } });
  assert.ok((await capture(cap.ctx, { threadId: "thr_ch", reason: "idle" })).merged >= 1, "the agent learned it");
  const row = raw.all("SELECT layer, audience FROM memory_facts WHERE agent_id = ?", AGENT)[0] as { layer: string; audience: string };
  assert.equal(row.layer, "agent");
  assert.deepEqual({ ...JSON.parse(row.audience), at: undefined }, { people: [DANA, MAYA], live: "thr_ch", at: undefined }, "tagged with the channel's people, the place it is read against now, and when it was learned");
  // every memory read an agent can make, as Dana's agent in a chat Leo is also in: none returns it
  const mixed = harness({ raw, principal: { kind: "agent", id: AGENT }, actingFor: DANA, respond: { "threads.get": () => chatOf(DANA, "usr_leo"), "agents.get": () => ({ agent: { folderId: "fld_intake" } }) } });
  (mixed.ctx as MemCtx & { thread?: string }).thread = "thr_mix";
  for (const c of ["memory.search", "memory.facts_as_of", "memory.facts.list", "memory.learned"]) {
    const out = await (handlers as Record<string, (ctx: MemCtx, input: unknown) => Promise<unknown>>)[c]!(mixed.ctx, c === "memory.search" ? { q: "vendor", mode: "keyword" } : c === "memory.facts_as_of" ? { date: NOW + 1000 } : {});
    assert.ok(!JSON.stringify(out).includes("net 60"), `${c}: ${JSON.stringify(out).slice(0, 300)}`);
  }
  // in the channel itself, where every reader is a member, it comes back
  const inside = harness({ raw, principal: { kind: "agent", id: AGENT }, actingFor: DANA, respond: { "threads.get": () => channel, "channels.get": () => channelGet, "agents.get": () => ({ agent: { folderId: "fld_intake" } }) } });
  (inside.ctx as MemCtx & { thread?: string }).thread = "thr_ch";
  assert.ok(JSON.stringify(await handlers["memory.facts_as_of"](inside.ctx as never, { date: NOW + 1000 } as never)).includes("net 60"));
});

test("D7: one agent reads another agent's memory when the asker can open that agent's folder, and not otherwise", async () => {
  const raw = openRaw();
  const seed = harness({ raw });
  seedFact(seed, { id: "fct_other", layer: "agent", agentId: "agt_billing", text: `Billing's ${SECRET} rule: invoices go out on the 1st` });
  const asks = (deny: string[]) => {
    const h = harness({ raw, principal: { kind: "agent", id: AGENT }, actingFor: DANA, deny, respond: { "threads.get": () => chatOf(DANA), "agents.get": (b) => ({ agent: { folderId: `fld_${String(b["agentId"]).replace(/^agt_/, "")}` } }) } });
    (h.ctx as MemCtx & { thread?: string }).thread = "thr_dana";
    return h;
  };
  const read = async (h: Harness) => JSON.stringify([
    await search(h.ctx, { q: "invoices", agentId: "agt_billing", mode: "keyword" }),
    await handlers["memory.fact.get"](h.ctx as never, { factId: "fct_other" } as never).catch(() => ({})),
    await handlers["memory.facts.list"](h.ctx as never, { agentId: "agt_billing" } as never),
  ]);
  assert.match(await read(asks([])), /invoices go out/, "Dana may open Billing's folder: Intake, working for her, reads Billing's memory");
  assert.doesNotMatch(await read(asks(["folder:fld_billing"])), /invoices go out/, "without Billing's folder, nothing of it");
});

// ---- rc.22 bug 34: what an agent learns talking with a teammate as itself stays that teammate's ----

test("an agent that wrote to Maya as itself keeps what Maya says in her own chat with it for Maya: Dana's later chats with the same agent never recall it", async () => {
  const raw = openRaw();
  // the agent's own chat with Maya: Maya and the agent, nobody else (Dana, who asked it to write, is not in it)
  const selfChat = chatOf(MAYA);
  const inSelf = harness({ raw, principal: { kind: "agent", id: AGENT }, actingFor: MAYA, respond: {
    "threads.get": (b: Record<string, unknown>) => ({ thread: { threadId: b["threadId"], ...selfChat.thread } }),
    "agents.get": () => ({ agent: { folderId: "fld_intake", captureMode: "auto", ownerId: DANA } }),
    "chat.message.get": () => ({ message: { createdAt: NOW + 1 } }),
  } });
  (inSelf.ctx as MemCtx & { thread?: string }).thread = "thr_self";
  // the agent saves what Maya said, even into its own (agent) layer, which Dana can read in her chats
  const saved = await remember(inSelf.ctx, { text: `Maya's ${SECRET} reply: she cannot do Friday`, layer: "agent", agentId: AGENT, threadId: "thr_self" });
  // an accepted fact is the strongest case: it is current in the agent's layer, which any chat with this agent reads
  inSelf.db.run("UPDATE memory_facts SET status = 'current' WHERE id = ?", saved.fact.factId);
  // Dana, in her own chat with the same agent
  const dana = harness({ raw, principal: { kind: "person", id: DANA }, respond: { "threads.get": threadsById({ thr_dana: chatOf(DANA), thr_self: selfChat }), "agents.get": () => ({ agent: { folderId: "fld_intake" } }) } });
  assert.doesNotMatch(JSON.stringify(await pointer(dana.ctx, { threadId: "thr_dana", agentId: AGENT, text: `Maya ${SECRET} reply Friday` })), /cannot do Friday/, `saved as ${saved.fact.layer}`);
  assert.doesNotMatch(JSON.stringify(await search(dana.ctx, { q: SECRET, mode: "keyword" })), /cannot do Friday/);
  // and Maya herself still gets it back
  const maya = harness({ raw, principal: { kind: "person", id: MAYA }, respond: { "threads.get": threadsById({ thr_maya2: chatOf(MAYA), thr_self: selfChat }), "agents.get": () => ({ agent: { folderId: "fld_intake" } }) } });
  assert.match(JSON.stringify(await pointer(maya.ctx, { threadId: "thr_maya2", agentId: AGENT, text: `Maya ${SECRET} reply Friday` })), /cannot do Friday/);
});
