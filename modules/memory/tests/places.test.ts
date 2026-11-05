// Memory in shared places (MEMORY-RULES 1 to 9): where a memory lives, who reads it, how a newer statement replaces an older one, how a clash becomes a question, the "Noted" line, and what
// deleting a message or a place does. The leakage matrix at the bottom needs no model and runs every person against every place.
import test from "node:test";
import assert from "node:assert/strict";
import { capture, factCorrect, factsList, pointer, search, factsAsOf } from "../handlers/facts.ts";
import { remember } from "../handlers/tools.ts";
import { promote } from "../handlers/facts.ts";
import { placeArchive, placeList, sourceRemoved } from "../handlers/places.ts";
import { questionResolve } from "../handlers/upkeep.ts";
import { quote } from "../handlers/quotes.ts";
import { harness, openRaw, NOW, DAY } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { kindOf, sameSubject, disagree, placeOf } from "../place.ts";

const AGENT = "agt_helper", DANA = "usr_dana", MAYA = "usr_maya", OMAR = "usr_omar", LEO = "usr_leo";
const person = (id: string) => ({ kind: "person", id });

interface World { channelMembers: string[]; visibility: "invite" | "public"; sharedAt?: number; said: Record<string, Array<{ messageId: string; author: { kind: string; id: string }; body: string; createdAt: number }>> }

/** threads.get as the host answers it: a place the caller can open answers with its own threadId, any other is refused. */
function threadsFor(me: string, w: World, mine: string[] = []): (b: Record<string, unknown>) => unknown {
  const channel = () => ({ thread: { threadId: "thr_chan", kind: "channel", channelId: "chn_deals", starter: DANA, members: w.channelMembers.map(person), agents: [{ agentId: AGENT, mode: "lead" }] } });
  return (b) => {
    const id = String(b["threadId"]);
    if (id === "thr_chan") { if (w.visibility === "invite" && !w.channelMembers.includes(me)) throw new Error("not found"); return channel(); }
    if (id === "thr_sub" || id === "thr_sub2") { if (w.visibility === "invite" && !w.channelMembers.includes(me)) throw new Error("not found"); return { thread: { threadId: id, kind: "thread", parentThreadId: "thr_chan", starter: DANA, members: w.channelMembers.map(person), agents: [] } }; }
    if (id === "thr_priv") {
      if (me !== DANA && !mine.includes("thr_priv")) throw new Error("not found");
      return { thread: { threadId: "thr_priv", kind: "chat", starter: DANA, members: [person(DANA), ...mine.filter((m) => m !== "thr_priv").map(person)], agents: [{ agentId: AGENT, mode: "lead" }], ...(w.sharedAt ? { sharedAt: w.sharedAt } : {}) } };
    }
    if (mine.includes(id)) return { thread: { threadId: id, kind: "chat", starter: me, members: [person(me)], agents: [{ agentId: AGENT, mode: "lead" }] } };
    throw new Error("not found");
  };
}

function setup() {
  const raw = openRaw();
  const w: World = { channelMembers: [DANA, MAYA], visibility: "invite", said: {} };
  const noted: Array<Record<string, unknown>> = [];
  const as = (who: string, mine: string[] = [], extra: Record<string, (b: Record<string, unknown>) => unknown> = {}): Harness =>
    harness({ raw, principal: { kind: "person", id: who }, respond: {
      "threads.get": threadsFor(who, w, mine), "channels.get": () => ({ channel: { visibility: w.visibility, members: w.channelMembers.map(person) } }),
      "agents.get": () => ({ agent: { folderId: "fld_helper", captureMode: "auto", ownerId: DANA } }), "chat.noted": (b) => { noted.push(b); return { posted: true }; },
      "chat.messages.list": (b) => ({ messages: w.said[String(b["threadId"])] ?? [] }), ...extra,
    } });
  const svc = (): Harness => harness({ raw, principal: { kind: "service", id: "svc_memory" }, respond: {
    "threads.get": threadsFor(DANA, w, ["thr_priv"]), "channels.get": () => ({ channel: { visibility: w.visibility, members: w.channelMembers.map(person) } }),
    "agents.get": () => ({ agent: { folderId: "fld_helper", captureMode: "auto", ownerId: DANA } }), "chat.noted": (b) => { noted.push(b); return { posted: true }; },
    "chat.messages.list": (b) => ({ messages: w.said[String(b["threadId"])] ?? [] }),
  } });
  return { raw, w, noted, as, svc };
}
const msg = (id: string, who: string, body: string, at = NOW) => ({ messageId: id, author: person(who), body, createdAt: at });
const ask = (h: Harness, threadId: string, text: string): Promise<string> => pointer(h.ctx, { threadId, agentId: AGENT, text }).then((o) => JSON.stringify(o));

test("a memory learned in a channel keeps its place, its message and the words as written, and the room is told", async () => {
  const s = setup();
  s.w.said["thr_chan"] = [msg("msg_1", MAYA, "We decided to go with Harbor for the freight contract.")];
  const out = await capture(s.svc().ctx, { threadId: "thr_chan", reason: "closed" });
  assert.equal(out.merged, 1);
  const row = s.raw.all("SELECT place_kind, place_id, msg_id, span, source_person, kind, audience, layer FROM memory_facts")[0] as Record<string, string>;
  assert.deepEqual([row.place_kind, row.place_id, row.msg_id, row.span, row.source_person, row.kind, row.layer], ["channel", "chn_deals", "msg_1", "We decided to go with Harbor for the freight contract.", MAYA, "decision", "agent"]);
  assert.deepEqual({ ...JSON.parse(row.audience), at: undefined }, { people: [DANA, MAYA], live: "thr_chan", at: undefined });
  assert.equal(s.noted.length, 1);
  assert.equal(s.noted[0]!["kind"], "decision");
  assert.match(String(s.noted[0]!["text"]), /Harbor/);
});

test("the room's own \"Noted\" line is never learned back as something a person said", async () => {
  const s = setup();
  s.w.said["thr_chan"] = [
    msg("msg_1", MAYA, "We decided to go with Harbor for freight shipping."),
    { ...msg("msg_2", MAYA, "Noted: decision, We decided to go with Harbor for freight shipping."), kind: "system" } as never,
  ];
  const out = await capture(s.svc().ctx, { threadId: "thr_chan", reason: "closed" });
  assert.equal(out.merged, 1);
  assert.equal((s.raw.all("SELECT COUNT(*) AS n FROM memory_facts")[0] as { n: number }).n, 1);
});

test("exact recall of a fact quotes the words as written, to people who may open its place and nobody else", async () => {
  const s = setup();
  s.w.said["thr_chan"] = [msg("msg_1", MAYA, "We decided to go with Harbor for the freight contract.")];
  await capture(s.svc().ctx, { threadId: "thr_chan", reason: "closed" });
  const id = (s.raw.all("SELECT id FROM memory_facts")[0] as { id: string }).id;
  const got = await quote(s.as(DANA, ["thr_d"]).ctx, { ref: id });
  assert.equal(got.quotes.length, 1);
  assert.equal(got.quotes[0]!.text, "We decided to go with Harbor for the freight contract.");
  assert.equal(got.quotes[0]!.author.id, MAYA);
  assert.deepEqual((await quote(s.as(LEO, ["thr_leo"]).ctx, { ref: id })).quotes, []);
});

test("recall finds the room's own decision when the question shares almost none of its words", async () => {
  const s = setup();
  s.w.said["thr_chan"] = [
    msg("msg_1", MAYA, "We decided to go with Meridian for freight shipping."), msg("msg_2", MAYA, "We decided the Atlas launch is on March nineteenth."),
    msg("msg_3", MAYA, "We decided Atlas uses SQLite for storage."), msg("msg_4", MAYA, "The audit report is due on Monday."),
  ];
  await capture(s.svc().ctx, { threadId: "thr_chan", reason: "closed" });
  const dana = s.as(DANA, ["thr_d"]);
  assert.match(await ask(dana, "thr_sub", "I just joined. Which freight carrier are we using?"), /Meridian/);
  // nothing in particular asked: nothing offered
  assert.doesNotMatch(await ask(dana, "thr_sub", "what a lovely afternoon outside today"), /Meridian|Atlas|audit/);
});

test("asked about a value that was replaced, recall answers with what replaced it and never the old value as current", async () => {
  const s = setup();
  const svc = s.svc();
  s.w.said["thr_chan"] = [msg("msg_1", MAYA, "We decided Atlas uses Postgres for storage.")];
  await capture(svc.ctx, { threadId: "thr_chan", reason: "closed" });
  s.w.said["thr_chan"] = [msg("msg_2", MAYA, "We decided Atlas uses SQLite for storage instead.")];
  await capture(svc.ctx, { threadId: "thr_chan", reason: "closed" });
  const dana = s.as(DANA, ["thr_d"]);
  const said = await ask(dana, "thr_sub", "Are we still on Postgres?");
  assert.match(said, /SQLite/);
  assert.match(said, /no longer true/);
  // asked about the new value, the old one comes only as what the new one replaced
  const lines = (JSON.parse(await ask(s.as(DANA, ["thr_d2"]), "thr_sub", "Which storage does Atlas use?")) as { lines: Array<{ fact: string }> }).lines;
  assert.ok(lines.length >= 1 && lines.every((l) => /SQLite/.test(l.fact) && !/^We decided Atlas uses Postgres/.test(l.fact)), JSON.stringify(lines));
  // and the search tool finds the history by the old word
  assert.match(JSON.stringify(await search(dana.ctx, { q: "Postgres", agentId: AGENT, mode: "keyword" })), /SQLite/);
});

test("a thread keeps its parent's place, a task its project, a project chat its project", async () => {
  const s = setup();
  const h = s.as(DANA, ["thr_t"], {
    "threads.get": (b) => b["threadId"] === "thr_t" ? { thread: { threadId: "thr_t", kind: "chat", scopeType: "task", scopeId: "tsk_1", members: [person(DANA), person(MAYA)] } } : threadsFor(DANA, s.w, [])(b),
    "tasks.get": () => ({ task: { projectId: "prj_x" } }),
  });
  assert.deepEqual(await placeOf(h.ctx, "thr_sub"), { kind: "channel", id: "chn_deals", thread: "thr_chan" });
  assert.deepEqual(await placeOf(h.ctx, "thr_t"), { kind: "task", id: "tsk_1", thread: "thr_t", parent: { kind: "project", id: "prj_x" } });
});

test("a channel of one person still keeps its memory for that channel: a stranger never reads it (L1)", async () => {
  const s = setup();
  s.w.channelMembers = [DANA];
  s.w.said["thr_chan"] = [msg("msg_1", DANA, "We decided to hold the zebra budget at 40k.")];
  await capture(s.svc().ctx, { threadId: "thr_chan", reason: "closed" });
  const leo = s.as(LEO, ["thr_leo"]);
  assert.doesNotMatch(await ask(leo, "thr_leo", "zebra budget 40k"), /zebra/);
  assert.doesNotMatch(JSON.stringify(await search(leo.ctx, { q: "zebra", mode: "keyword" })), /zebra/);
  assert.match(await ask(s.as(DANA, ["thr_d"]), "thr_d", "zebra budget 40k"), /zebra/);
});

test("who reads a memory is who may open its place now: a late joiner reads it, a removed member and an outsider after it narrows do not (L2, L3)", async () => {
  const s = setup();
  s.w.said["thr_chan"] = [msg("msg_1", MAYA, "We decided to ship the quartz release on Friday.")];
  await capture(s.svc().ctx, { threadId: "thr_chan", reason: "closed" });
  const q = "quartz release Friday";
  assert.doesNotMatch(await ask(s.as(OMAR, ["thr_o"]), "thr_o", q), /quartz/);
  s.w.channelMembers = [DANA, MAYA, OMAR];   // Omar joins late
  assert.match(await ask(s.as(OMAR, ["thr_o"]), "thr_o", q), /quartz/);
  s.w.channelMembers = [DANA, MAYA];          // and is removed again
  assert.doesNotMatch(await ask(s.as(OMAR, ["thr_o"]), "thr_o", q), /quartz/);
  // a public channel that turns invite-only narrows its memory with it
  s.w.visibility = "public";
  assert.match(await ask(s.as(LEO, ["thr_leo"]), "thr_leo", q), /quartz/);
  s.w.visibility = "invite";
  assert.doesNotMatch(await ask(s.as(LEO, ["thr_leo"]), "thr_leo", q), /quartz/);
});

test("a place that cannot be opened (deleted or refused) answers nobody", async () => {
  const s = setup();
  s.w.said["thr_chan"] = [msg("msg_1", MAYA, "We decided to retire the cobalt pricing sheet.")];
  await capture(s.svc().ctx, { threadId: "thr_chan", reason: "closed" });
  const h = s.as(MAYA, ["thr_m"], { "threads.get": (b) => { if (b["threadId"] === "thr_chan") throw new Error("gone"); return threadsFor(MAYA, s.w, ["thr_m"])(b); } });
  assert.doesNotMatch(await ask(h, "thr_m", "cobalt pricing sheet"), /cobalt/);
});

test("a newer statement by the same person replaces the older one; history keeps it marked replaced", async () => {
  const s = setup();
  s.w.said["thr_chan"] = [msg("msg_1", MAYA, "We decided to go with Harbor for freight shipping.", NOW)];
  const svc = s.svc();
  await capture(svc.ctx, { threadId: "thr_chan", reason: "closed" });
  svc.advance(DAY);
  s.w.said["thr_chan"] = [msg("msg_2", MAYA, "We decided to go with Meridian for freight shipping instead.", NOW + DAY)];
  await capture(svc.ctx, { threadId: "thr_chan", reason: "closed" });
  const dana = s.as(DANA, ["thr_d"]);
  const said = await ask(dana, "thr_sub", "which freight shipping carrier");
  assert.match(said, /Meridian/);
  // the old value is never offered as if it held: where it appears at all, the line says it is no longer true
  for (const l of (JSON.parse(said) as { lines: Array<{ fact: string }> }).lines) assert.ok(!/Harbor/.test(l.fact) || /no longer true/.test(l.fact), l.fact);
  const list = await placeList(dana.ctx, { placeKind: "channel", placeId: "chn_deals", history: true });
  const states = Object.fromEntries(list.facts.map((f) => [String(f["text"]).includes("Harbor") ? "old" : "new", f["state"]]));
  assert.deepEqual(states, { old: "replaced", new: "current" });
  assert.equal(s.noted.at(-1)!["replaces"] !== undefined, true);
});

test("two people disagree on one subject: both stay, flagged disputed, and one question names both; the agent is told not to state either as settled", async () => {
  const s = setup();
  s.w.said["thr_chan"] = [msg("msg_1", MAYA, "We decided the launch review is on Thursday morning.", NOW), msg("msg_2", OMAR, "We decided the launch review is on Friday morning.", NOW + 1000)];
  s.w.channelMembers = [DANA, MAYA, OMAR];
  await capture(s.svc().ctx, { threadId: "thr_chan", reason: "closed" });
  const rows = s.raw.all("SELECT source_person, state, status FROM memory_facts ORDER BY learned_at, source_person") as Array<Record<string, string>>;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.state === "disputed" && r.status === "current"), JSON.stringify(rows));
  const qs = s.raw.all("SELECT kind, fact_a, fact_b, status FROM memory_questions") as Array<Record<string, string>>;
  assert.equal(qs.length, 1);
  assert.equal(qs[0]!.kind, "contradiction");
  const said = await ask(s.as(DANA, ["thr_d"]), "thr_d", "launch review on Thursday or Friday morning");
  assert.match(said, /DISPUTED/);
  assert.match(said, new RegExp(MAYA));
  assert.match(said, new RegExp(OMAR));
  assert.equal(s.noted.some((n) => n["disputed"] === true), true);
  // answering the question ends the dispute
  const dana = s.as(DANA, [], { "access.shares_of": () => ({ shares: [{ grant: { subject: { kind: "person", id: DANA }, level: "manage" }, through: "direct" }] }) });
  const qid = (s.raw.all("SELECT id FROM memory_questions")[0] as { id: string }).id;
  await questionResolve(dana.ctx, { questionId: qid, resolution: "keep_b" });
  assert.equal((s.raw.all("SELECT COUNT(*) AS n FROM memory_facts WHERE state = 'disputed'")[0] as { n: number }).n, 0);
});

test("a message deleted drops what was derived from it, and the statement it replaced holds again", async () => {
  const s = setup();
  const svc = s.svc();
  s.w.said["thr_chan"] = [msg("msg_1", MAYA, "We decided to bill the onyx account monthly.", NOW)];
  await capture(svc.ctx, { threadId: "thr_chan", reason: "closed" });
  svc.advance(DAY);
  s.w.said["thr_chan"] = [msg("msg_2", MAYA, "We decided to bill the onyx account quarterly instead.", NOW + DAY)];
  await capture(svc.ctx, { threadId: "thr_chan", reason: "closed" });
  const maya = s.as(MAYA, ["thr_m"]);
  assert.match(await ask(maya, "thr_sub", "bill the onyx account"), /quarterly/);
  assert.deepEqual(await sourceRemoved(maya.ctx, { threadId: "thr_chan", messageId: "msg_2" }), { dropped: 1 });
  const after = await ask(s.as(MAYA, ["thr_m2"]), "thr_sub2", "bill the onyx account");
  // the dropped statement is gone from every line, and the one it replaced holds again
  for (const l of (JSON.parse(after) as { lines: Array<{ fact: string }> }).lines) assert.ok(!/quarterly/.test(l.fact), l.fact);
  assert.match(after, /monthly/);
});

test("only the person the words came from, someone who may edit, or an admin removes what a message derived", async () => {
  const s = setup();
  s.w.said["thr_chan"] = [msg("msg_1", MAYA, "We decided to keep the topaz archive open.")];
  await capture(s.svc().ctx, { threadId: "thr_chan", reason: "closed" });
  const readOnly = harness({ raw: s.raw, principal: person(DANA), readOnly: ["folder:fld_helper"], respond: { "agents.get": () => ({ agent: { folderId: "fld_helper", ownerId: "usr_boss" } }), "access.shares_of": () => ({ shares: [] }) } });
  assert.deepEqual(await sourceRemoved(readOnly.ctx, { threadId: "thr_chan", messageId: "msg_1" }), { dropped: 0 });
});

test("archiving a place archives its memory; deleting it deletes it", async () => {
  const s = setup();
  s.w.said["thr_chan"] = [msg("msg_1", MAYA, "We decided to keep the jade ledger monthly.")];
  await capture(s.svc().ctx, { threadId: "thr_chan", reason: "closed" });
  const dana = s.as(DANA, ["thr_d"], { "access.shares_of": () => ({ shares: [{ grant: { subject: { kind: "person", id: DANA }, level: "manage" }, through: "direct" }] }) });
  assert.deepEqual(await placeArchive(dana.ctx, { placeKind: "channel", placeId: "chn_deals", action: "archive" }), { facts: 1 });
  assert.doesNotMatch(await ask(dana, "thr_d", "jade ledger monthly"), /jade/);
  assert.equal((s.raw.all("SELECT COUNT(*) AS n FROM memory_facts WHERE archived_at IS NOT NULL")[0] as { n: number }).n, 1);
  assert.deepEqual(await placeArchive(dana.ctx, { placeKind: "channel", placeId: "chn_deals", action: "delete" }), { facts: 1 });
  assert.equal((s.raw.all("SELECT COUNT(*) AS n FROM memory_facts")[0] as { n: number }).n, 0);
});

test("a private chat that gains people: what was said before stays private, in memory and in quotes", async () => {
  const s = setup();
  s.w.sharedAt = NOW + 1000;
  s.w.said["thr_priv"] = [msg("msg_a", DANA, "We decided to sell the opal building before anyone knows.", NOW), msg("msg_b", MAYA, "We decided to hire two analysts in March.", NOW + 2000)];
  const svc = s.svc();
  // thr_priv is now a chat of two people: Dana and Maya
  const svcShared = harness({ raw: s.raw, principal: { kind: "service", id: "svc_memory" }, respond: {
    "threads.get": (b) => ({ thread: { threadId: b["threadId"], kind: "chat", starter: DANA, members: [person(DANA), person(MAYA)], agents: [{ agentId: AGENT, mode: "lead" }], sharedAt: s.w.sharedAt } }),
    "agents.get": () => ({ agent: { folderId: "fld_helper", captureMode: "auto", ownerId: DANA } }), "chat.noted": () => ({ posted: true }), "chat.messages.list": () => ({ messages: s.w.said["thr_priv"] }),
  } });
  void svc;
  await capture(svcShared.ctx, { threadId: "thr_priv", reason: "closed" });
  const texts = (s.raw.all("SELECT text FROM memory_facts WHERE layer <> 'person'") as Array<{ text: string }>).map((r) => r.text).join(" | ");
  assert.doesNotMatch(texts, /opal/);
  assert.match(texts, /analysts/);
  // quotes: the earlier line goes to a chat nobody else reads and to no shared one
  const hit = (at: number, text: string, ref: string) => ({ source: "message", ref, threadId: "thr_priv", threadKind: "chat", seq: 1, role: "user", author: person(DANA), text, at, link: "/x", score: 1 });
  const respond = {
    "chat.history.search": () => ({ hits: [hit(NOW, "We decided to sell the opal building.", "r1"), hit(NOW + 2000, "We decided to hire two analysts.", "r2")] }), "search.resolve": () => ({}),
    "threads.get": (b: Record<string, unknown>) => b["threadId"] === "thr_priv"
      ? { thread: { threadId: "thr_priv", kind: "chat", starter: DANA, members: [person(DANA), person(MAYA)], sharedAt: s.w.sharedAt } }
      : b["threadId"] === "thr_group" ? { thread: { threadId: "thr_group", kind: "chat", starter: DANA, members: [person(DANA), person(MAYA)] } } : { thread: { threadId: b["threadId"], kind: "chat", starter: DANA, members: [person(DANA)] } },
  };
  const inGroup = harness({ raw: s.raw, principal: person(DANA), respond });
  const g = await quote(inGroup.ctx, { q: "decided", excludeThreadId: "thr_group" });
  assert.deepEqual(g.quotes.map((x) => x.ref), ["r2"]);
  // an agent's own tool call carries its chat in ctx.thread, not in the input: the earlier line stays out of it too
  const asAgent = harness({ raw: s.raw, principal: { kind: "agent", id: AGENT }, actingFor: DANA, respond });
  (asAgent.ctx as { thread?: string }).thread = "thr_group";
  assert.deepEqual((await quote(asAgent.ctx, { q: "decided" })).quotes.map((x) => x.ref), ["r2"]);
  const alone = harness({ raw: s.raw, principal: person(DANA), respond });
  const a = await quote(alone.ctx, { q: "decided", excludeThreadId: "thr_dana_alone" });
  assert.deepEqual(a.quotes.map((x) => x.ref).sort(), ["r1", "r2"]);
});

test("remember this and an agent's save in a shared place say so, with Undo; a private chat gets no line", async () => {
  const s = setup();
  const agent = harness({ raw: s.raw, principal: { kind: "agent", id: AGENT }, actingFor: DANA, respond: {
    "threads.get": threadsFor(DANA, s.w, []), "channels.get": () => ({ channel: { visibility: "invite", members: s.w.channelMembers.map(person) } }),
    "agents.get": () => ({ agent: { folderId: "fld_helper", captureMode: "auto", ownerId: DANA } }), "chat.noted": (b) => { s.noted.push(b); return { posted: true }; },
  } });
  const out = await remember(agent.ctx, { text: "Maya owns the onyx renewal, due next Friday.", layer: "agent", agentId: AGENT, kind: "commitment", threadId: "thr_chan" });
  assert.equal(out.merged, true);
  assert.equal(s.noted.length, 1);
  assert.equal(s.noted[0]!["kind"], "commitment");
  assert.equal(s.raw.all("SELECT place_kind FROM memory_facts")[0]!["place_kind" as never], "channel");
});

test("kinds and subjects", () => {
  assert.equal(kindOf("deadline"), "commitment");
  assert.equal(kindOf("profile"), "fact");
  assert.equal(kindOf("decision"), "decision");
  assert.equal(sameSubject("We decided to go with Harbor for freight shipping", "We decided to go with Meridian for freight shipping instead"), true);
  assert.equal(sameSubject("Billing runs on the first", "Billing contact is Sam"), false);
  // a shared name is not a shared subject (found by the eval: this pair was flagged as a dispute)
  assert.equal(sameSubject("We decided the Atlas launch is on March nineteenth.", "We decided the Atlas launch announcement goes out at noon."), false);
  assert.equal(sameSubject("We decided Atlas uses Postgres for storage.", "We decided Atlas uses SQLite for storage instead."), true);
  assert.equal(sameSubject("We decided the pilot goal is ten signed pilots by July.", "We decided the pilot goal is twelve signed pilots by July instead."), true);
  assert.equal(sameSubject("The kitchen needs paint", "Billing runs on the first"), false);
  assert.equal(disagree("review is on Thursday morning", "review is on Friday morning"), true);
});

test("corrections are logged with who made them", async () => {
  const s = setup();
  s.w.said["thr_chan"] = [msg("msg_1", MAYA, "We decided to keep the ruby retainer at 5k.")];
  await capture(s.svc().ctx, { threadId: "thr_chan", reason: "closed" });
  const dana = s.as(DANA, ["thr_d"], { "access.shares_of": () => ({ shares: [{ grant: { subject: { kind: "person", id: DANA }, level: "manage" }, through: "direct" }] }) });
  const id = (s.raw.all("SELECT id FROM memory_facts")[0] as { id: string }).id;
  await factCorrect(dana.ctx, { factId: id, text: "The ruby retainer is 6k." });
  const trail = s.raw.all("SELECT action, actor FROM memory_trail WHERE action = 'edit'") as Array<{ action: string; actor: string }>;
  assert.ok(trail.some((t) => t.actor === DANA), JSON.stringify(trail));
});

// ---- the leakage matrix: no model, every person in every place

test("LEAKAGE: nobody reads, through any memory read, a memory whose place they cannot open", async () => {
  const s = setup();
  // place A: the invite-only channel (Dana, Maya). place B: Dana's private chat (shared later with nobody). place C: a project thread Omar leads
  s.w.said["thr_chan"] = [msg("msg_1", MAYA, "We decided the amber pipeline owns the Q3 target.")];
  await capture(s.svc().ctx, { threadId: "thr_chan", reason: "closed" });
  const dana = s.as(DANA, ["thr_d"]);
  await remember(dana.ctx, { text: "My amber passport hint is the year of the flood.", agentId: AGENT, threadId: "thr_d" });
  const secrets: Record<string, string> = { channel: "amber pipeline", personal: "amber passport" };
  const people = [DANA, MAYA, OMAR, LEO];
  const contexts: Record<string, string[]> = { own: ["thr_x"], shared: ["thr_x", "thr_chan"] };
  for (const who of people) {
    const mine = ["thr_x", ...(who === DANA ? ["thr_d"] : [])];
    const h = s.as(who, mine);
    const sweep = JSON.stringify([
      await pointer(h.ctx, { threadId: "thr_x", agentId: AGENT, text: "amber pipeline Q3 target passport flood" }),
      await search(h.ctx, { q: "amber", agentId: AGENT, mode: "keyword" }),
      await factsList(h.ctx, {}),
      await factsAsOf(h.ctx, { date: NOW + 1000 }),
      await placeList(h.ctx, { placeKind: "channel", placeId: "chn_deals", history: true }),
    ]);
    const inChannel = s.w.channelMembers.includes(who);
    assert.equal(sweep.includes(secrets.channel!), inChannel, `${who}: channel memory ${inChannel ? "must" : "must not"} show`);
    // Dana's own memory shows in her own chat and for no one else
    assert.equal(sweep.includes(secrets.personal!), who === DANA, `${who}: Dana's personal memory is Dana's alone`);
  }
  // and not even Dana hears it in a place other people read
  const inRoom = s.as(DANA, ["thr_x"]);
  const agentInRoom = harness({ raw: s.raw, principal: { kind: "agent", id: AGENT }, actingFor: DANA, respond: {
    "threads.get": threadsFor(DANA, s.w, ["thr_x"]), "channels.get": () => ({ channel: { visibility: "invite", members: s.w.channelMembers.map(person) } }), "agents.get": () => ({ agent: { folderId: "fld_helper", ownerId: DANA } }),
  } });
  (agentInRoom.ctx as { thread?: string }).thread = "thr_chan";
  const room = JSON.stringify([await pointer(inRoom.ctx, { threadId: "thr_chan", agentId: AGENT, text: "amber passport flood" }), await search(agentInRoom.ctx, { q: "passport", agentId: AGENT, mode: "keyword" }), await factsList(agentInRoom.ctx, {})]);
  assert.equal(room.includes(secrets.personal!), false, "personal memory never goes into a room");
  void contexts;
});

test("promoting a place's decision to the Space is a marker pointing back: no second copy of the words, it follows a replacement and dies with its source", async () => {
  const s = setup();
  const svc = s.svc();
  s.w.said["thr_chan"] = [msg("msg_1", MAYA, "We decided to go with Harbor for freight shipping.")];
  await capture(svc.ctx, { threadId: "thr_chan", reason: "closed" });
  const src = (s.raw.all("SELECT id FROM memory_facts")[0] as { id: string }).id;
  const dana = s.as(DANA, ["thr_d"], { "access.shares_of": () => ({ shares: [{ grant: { subject: { kind: "person", id: DANA }, level: "manage" }, through: "direct" }] }) });
  const out = await promote(dana.ctx, { factId: src, toLayer: "space" });
  assert.equal(out.promoted, true);
  const row = () => s.raw.all("SELECT id, text, state, promoted_from FROM memory_facts WHERE layer = 'space'")[0] as { id: string; text: string; state: string; promoted_from: string };
  assert.equal(row().text, "", "the words are not copied");
  assert.equal(row().state, "marker");
  const read = (await factsList(dana.ctx, { layer: "space" })) as { facts: Array<{ text: string }> };
  assert.equal(read.facts[0]!.text, "We decided to go with Harbor for freight shipping.");
  // the source is replaced: the marker follows
  s.w.said["thr_chan"] = [msg("msg_2", MAYA, "We decided to go with Meridian for freight shipping instead.")];
  await capture(svc.ctx, { threadId: "thr_chan", reason: "closed" });
  const now = (await factsList(dana.ctx, { layer: "space" })) as { facts: Array<{ text: string }> };
  assert.match(now.facts[0]!.text, /Meridian/);
  // the message is deleted: the marker goes with it
  await sourceRemoved(s.as(MAYA, ["thr_m"]).ctx, { threadId: "thr_chan", messageId: "msg_2" });
  assert.equal(((await factsList(dana.ctx, { layer: "space" })) as { facts: unknown[] }).facts.filter((f) => (f as { text: string }).text !== "").length, 0);
});

test("the Knows list comes with linked places and Space markers, each only where the reader may open them", async () => {
  const s = setup();
  const svc = s.svc();
  s.w.said["thr_chan"] = [msg("msg_1", MAYA, "We decided to go with Harbor for freight shipping.")];
  await capture(svc.ctx, { threadId: "thr_chan", reason: "closed" });
  const src = (s.raw.all("SELECT id FROM memory_facts")[0] as { id: string }).id;
  // a fact learned in a task under the same project, and a marker in Space memory pointing at the channel's fact
  s.raw.run("UPDATE memory_facts SET parent_kind = 'project', parent_id = 'prj_x' WHERE id = ?", src);
  s.raw.run("INSERT INTO memory_facts (id, layer, owner_ref, kind, text, enc, valid_from, learned_at, source_kind, source_ref, source_person, proposed_by, status, low_risk, place_kind, place_id, parent_kind, parent_id, agent_id) VALUES ('fct_task1', 'agent', 'agt_helper', 'decision', 'Waves of fifty', 0, 1, 2, 'chat', 'thr_t', ?, ?, 'current', 0, 'task', 'tsk_1', 'project', 'prj_x', 'agt_helper')", MAYA, MAYA);
  const dana = s.as(DANA, ["thr_d"], { "access.shares_of": () => ({ shares: [{ grant: { subject: { kind: "person", id: DANA }, level: "manage" }, through: "direct" }] }) });
  await promote(dana.ctx, { factId: src, toLayer: "space" });
  const out = (await placeList(dana.ctx, { placeKind: "channel", placeId: "chn_deals" })).facts;
  const by = (scope: string) => out.filter((f) => f["scope"] === scope);
  assert.equal(by("here").length, 1);
  assert.deepEqual(by("linked").map((f) => [f["text"], f["placeKind"], f["placeId"]]), [["Waves of fifty", "task", "tsk_1"]]);
  assert.equal(by("space").length, 1);
  assert.equal(by("space")[0]!["text"], "We decided to go with Harbor for freight shipping.");
  assert.equal(by("linked")[0]!["canEdit"], false);
});

// ---- a private chat that gains a person keeps what it learned before (MEMORY-RULES 8; rc.22 blocker)

test("LEAK: what an agent saved for its memory in a private chat stays the starter's after the chat gains a person; what it learns afterwards is the room's", async () => {
  const raw = openRaw();
  const clock = { t: NOW };
  const sharedAt = NOW + 1000;
  let two = false;
  const threads = (me: string) => (b: Record<string, unknown>) => {
    const id = String(b["threadId"]);
    if (id === "thr_priv") {
      if (!two && me !== DANA) throw new Error("not found");
      if (two && me !== DANA && me !== MAYA) throw new Error("not found");
      return { thread: { threadId: id, kind: "chat", starter: DANA, members: two ? [person(DANA), person(MAYA)] : [person(DANA)], agents: [{ agentId: AGENT, mode: "lead" }], ...(two ? { sharedAt } : {}) } };
    }
    if (id === "thr_own") return { thread: { threadId: id, kind: "chat", starter: DANA, members: [person(DANA)], agents: [{ agentId: AGENT, mode: "lead" }] } };
    throw new Error("not found");
  };
  const as = (who: string, principal: { kind: "person" | "agent"; id: string } = person(who) as never) => harness({ raw, clock, principal, ...(principal.kind === "agent" ? { actingFor: who } : {}), respond: { "threads.get": threads(who), "agents.get": () => ({ agent: { folderId: "fld_helper", captureMode: "auto", ownerId: DANA } }), "chat.noted": () => ({ posted: true }) } });
  // Dana alone: the agent keeps her budget in its own memory, from this chat
  const alone = as(DANA, { kind: "agent", id: AGENT });
  (alone.ctx as { thread?: string }).thread = "thr_priv";
  await remember(alone.ctx, { text: "The cobalt budget is eighty thousand dollars.", layer: "agent", agentId: AGENT, threadId: "thr_priv" });
  clock.t = sharedAt + 1000;
  two = true;   // Maya is added
  const q = "what is the cobalt budget in dollars";
  for (const [who, thread] of [[MAYA, "thr_priv"], [DANA, "thr_priv"]] as const) {
    const h = as(who);
    assert.doesNotMatch(await ask(h, thread, q), /eighty/, `${who} in the chat that gained a person`);
    const tool = as(who, { kind: "agent", id: AGENT });
    (tool.ctx as { thread?: string }).thread = thread;
    assert.doesNotMatch(JSON.stringify([await search(tool.ctx, { q: "cobalt budget", agentId: AGENT, mode: "keyword" }), await factsList(tool.ctx, {}), await factsAsOf(tool.ctx, { date: clock.t })]), /eighty/, `${who}'s agent tools in that chat`);
  }
  // Dana in a chat of her own still has it; and what the agent learns once Maya is in is the room's
  assert.match(await ask(as(DANA), "thr_own", q), /eighty/);
  const room = as(DANA, { kind: "agent", id: AGENT });
  (room.ctx as { thread?: string }).thread = "thr_priv";
  await remember(room.ctx, { text: "The cobalt launch review is on Friday.", layer: "agent", agentId: AGENT, threadId: "thr_priv" });
  assert.match(await ask(as(MAYA), "thr_priv", "cobalt launch review on friday"), /Friday/);
});

test("LEAK: a channel that began with one person keeps what the agent kept before the second person was added; a channel made with its people shows late joiners everything", async () => {
  const raw = openRaw();
  const clock = { t: NOW };
  let added = false;
  const sharedAt = NOW + 1000;
  const threads = (me: string) => (b: Record<string, unknown>) => {
    const id = String(b["threadId"]);
    if (id !== "thr_plans") throw new Error("not found");
    if (me !== MAYA && !(added && me === OMAR)) throw new Error("not found");
    return { thread: { threadId: id, kind: "channel", channelId: "chn_plans", starter: MAYA, members: added ? [person(MAYA), person(OMAR)] : [person(MAYA)], agents: [{ agentId: AGENT, mode: "lead" }], ...(added ? { sharedAt } : {}) } };
  };
  const as = (who: string, principal: { kind: "person" | "agent"; id: string } = person(who) as never) => harness({ raw, clock, principal, ...(principal.kind === "agent" ? { actingFor: who } : {}), respond: {
    "threads.get": threads(who), "channels.get": () => ({ channel: { visibility: "invite", members: added ? [person(MAYA), person(OMAR)] : [person(MAYA)] } }), "agents.get": () => ({ agent: { folderId: "fld_helper", captureMode: "auto", ownerId: MAYA } }), "chat.noted": () => ({ posted: true }) } });
  const agent = as(MAYA, { kind: "agent", id: AGENT });
  (agent.ctx as { thread?: string }).thread = "thr_plans";
  await remember(agent.ctx, { text: "The acme budget ceiling is eighty thousand dollars.", layer: "agent", agentId: AGENT, threadId: "thr_plans" });
  clock.t = sharedAt + 1000;
  added = true;
  for (const who of [OMAR, MAYA]) {
    assert.doesNotMatch(await ask(as(who), "thr_plans", "what is the acme budget ceiling in dollars"), /eighty/, `${who} in the channel that gained a person`);
  }
});

test("a fact the person marks as for them only is kept in their own layer in any kind of place, by the agent's save tool and by capture", async () => {
  const s = setup();
  s.w.channelMembers = [DANA, MAYA, OMAR];
  const said = "Note, private for me only: my budget ceiling for the Acme deal is 80000 dollars, remember it.";
  // the agent's save tool: the model asks for the agent layer, the person's words decide
  const agent = harness({ raw: s.raw, principal: { kind: "agent", id: AGENT }, actingFor: MAYA, respond: {
    "threads.get": threadsFor(MAYA, s.w, []), "channels.get": () => ({ channel: { visibility: "invite", members: s.w.channelMembers.map(person) } }), "agents.get": () => ({ agent: { folderId: "fld_helper", captureMode: "auto", ownerId: DANA } }),
    "chat.noted": (b) => { s.noted.push(b); return { posted: true }; }, "chat.messages.list": () => ({ messages: [{ messageId: "msg_p", author: person(MAYA), body: said }] }),
  } });
  (agent.ctx as { thread?: string }).thread = "thr_chan";
  const out = await remember(agent.ctx, { text: "Maya's acme budget ceiling is 80000 dollars.", layer: "agent", agentId: AGENT, threadId: "thr_chan" });
  assert.equal(out.fact.layer, "person");
  // and capture: the same words said in the channel, read by the rules
  s.w.said["thr_chan"] = [msg("msg_9", MAYA, said)];
  await capture(s.svc().ctx, { threadId: "thr_chan", reason: "closed" });
  assert.deepEqual(s.raw.all("SELECT DISTINCT layer, owner_ref FROM memory_facts").map((r) => `${(r as { layer: string }).layer}:${(r as { owner_ref: string }).owner_ref}`), [`person:${MAYA}`]);
  assert.equal(s.noted.length, 0, "nothing was said in the room: it is not the room's memory");
  // nobody else in the room reads it, through any read
  for (const who of [OMAR, DANA]) {
    const h = s.as(who, []);
    assert.doesNotMatch(await ask(h, "thr_chan", "acme budget ceiling dollars"), /80000/, `${who} asking in the channel`);
    assert.doesNotMatch(JSON.stringify([await search(h.ctx, { q: "acme budget", agentId: AGENT, mode: "keyword" }), await factsList(h.ctx, {})]), /80000/, `${who} reading`);
  }
});
