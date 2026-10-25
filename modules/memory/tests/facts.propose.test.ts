// Facts: proposing, accepting, rejecting, correcting, removing and erasing; lists, facts as of a date, counts and layers (spec 2.15, 4.15).
// Real SQLite behind the host's ctx.db guard, the host's real ctx.seal, events and outputs checked against the frozen contract.
import test from "node:test";
import assert from "node:assert/strict";
import {
  counts, erase, factAccept, factCorrect, factGet, factReject, factsAsOf, factsList, factsRemove, layersList, proposeFact,
} from "../handlers/facts.ts";
import { assertEventsConform, asPerson, codeOf, contractErrors, DAY, harness, NOW, seedFact } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const agentGet = { "agents.get": () => ({ agent: { folderId: "fld_intake", ownerId: "usr_boss" } }), "projects.get": () => ({ project: { folderId: "fld_harlow", lead: "usr_lead" } }) };
const dana = (): Harness => harness({ respond: agentGet });

const prefer = { text: "Dana prefers short answers", kind: "preference", sourceKind: "chat" as const, sourceRef: "thr_one", agentId: "agt_intake" };

test("a preference from a chat merges into the person's own layer on its own, sealed under their key", async () => {
  const h = dana();
  const out = await proposeFact(h.ctx, prefer);
  assert.equal(out.merged, true);
  assert.equal(out.fact.status, "current");
  assert.equal(out.fact.layer, "person");
  assert.equal(out.fact.ownerRef, "usr_dana");
  assert.equal(out.fact.text, "Dana prefers short answers");
  assert.deepEqual(contractErrors("memory.propose_fact", "out", out), []);
  const row = h.rows("SELECT text, sealed, enc FROM memory_facts")[0]!;
  assert.equal(row["text"], "");
  assert.equal(row["enc"], 2);
  assert.ok(!String(row["sealed"]).includes("short answers"));
  assert.deepEqual(h.named("memory.fact_proposed").map((e) => e.payload["factId"]), [out.fact.factId]);
  assert.equal(h.named("memory.fact_accepted")[0]?.payload["auto"], true);
  assert.deepEqual(assertEventsConform(h), []);
  for (const e of h.emitted) assert.ok(!JSON.stringify(e.payload).includes("short answers"), "events carry ids, never the text");
});

test("a fact of another kind waits as proposed, and saving it twice does nothing", async () => {
  const h = dana();
  const a = await proposeFact(h.ctx, { ...prefer, kind: "note", text: "Dana keeps Fridays free" });
  const b = await proposeFact(h.ctx, { ...prefer, kind: "note", text: "dana keeps  fridays free" });
  assert.equal(a.merged, false);
  assert.equal(a.fact.status, "proposed");
  assert.equal(b.fact.factId, a.fact.factId);
  assert.equal(h.rows("SELECT id FROM memory_facts").length, 1);
  assert.equal(h.named("memory.fact_accepted").length, 0);
});

test("the setting memory.auto_merge_kinds decides which kinds merge", async () => {
  const h = harness({ respond: agentGet, settings: { "memory.auto_merge_kinds": ["note"] } });
  const note = await proposeFact(h.ctx, { ...prefer, kind: "note", text: "Dana likes agendas a day ahead" });
  const pref = await proposeFact(h.ctx, { ...prefer, text: "Dana prefers email to calls" });
  assert.equal(note.merged, true);
  assert.equal(pref.merged, false);
});

test("what the person types themselves is current, what an agent saves from a task waits", async () => {
  const h = dana();
  const own = await proposeFact(h.ctx, { text: "My dentist is on Elm Street", sourceKind: "manual", sourceRef: "me", agentId: "agt_intake" });
  assert.equal(own.fact.status, "current");
  const agent = harness({ respond: agentGet, principal: { kind: "agent", id: "agt_intake" }, actingFor: "usr_dana" });
  const task = await proposeFact(agent.ctx, { text: "Dana's invoice is overdue", sourceKind: "task", sourceRef: "tsk_a", agentId: "agt_intake" });
  assert.equal(task.fact.status, "proposed");
  assert.equal(task.fact.ownerRef, "usr_dana");
});

test("a channel fact goes straight to the project layer with its source, a run fact waits for the agent owner", async () => {
  const h = dana();
  const chan = await proposeFact(h.ctx, { text: "Harlow wants weekly updates on Tuesday", sourceKind: "channel", sourceRef: "thr_chan", projectId: "prj_harlow" });
  assert.equal(chan.fact.layer, "project");
  assert.equal(chan.fact.status, "current");
  assert.equal(chan.fact.sourceLink, "/chats/thr_chan");
  assert.equal(h.rows("SELECT text, enc FROM memory_facts")[0]?.["text"], "Harlow wants weekly updates on Tuesday");
  const run = await proposeFact(h.ctx, { text: "The nightly sync takes about ten minutes", sourceKind: "run", sourceRef: "run_x", agentId: "agt_intake" });
  assert.equal(run.fact.layer, "agent");
  assert.equal(run.fact.status, "proposed");
  assert.equal(h.rows("SELECT subject FROM memory_facts WHERE id = ?", run.fact.factId)[0]?.["subject"], null);
  const rec = await proposeFact(h.ctx, { text: "Acme renews in March", sourceKind: "record", sourceRef: "rec_acme", agentId: "agt_intake" });
  assert.equal(h.rows("SELECT subject FROM memory_facts WHERE id = ?", rec.fact.factId)[0]?.["subject"], "rec_acme");
});

test("bad input and missing access are refused with the catalogue codes", async () => {
  const h = dana();
  await assert.rejects(() => proposeFact(h.ctx, { ...prefer, text: "   " }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(() => proposeFact(h.ctx, { text: "x", layer: "agent", sourceKind: "chat", sourceRef: "t" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(() => proposeFact(h.ctx, { text: "x", layer: "project", sourceKind: "chat", sourceRef: "t" }), (e) => codeOf(e) === "validation.bad_input");
  h.deny("folder:fld_intake");
  await assert.rejects(() => proposeFact(h.ctx, { text: "Intake keeps notes", layer: "agent", agentId: "agt_intake", sourceKind: "chat", sourceRef: "t" }), (e) => codeOf(e) === "permission.no_grant");
});

test("accept moves a proposed fact to current; only a proposed fact, and only by someone who can change that layer", async () => {
  const h = dana();
  const p = await proposeFact(h.ctx, { ...prefer, kind: "note", text: "Dana reads on trains" });
  const done = await factAccept(h.ctx, { factId: p.fact.factId });
  assert.equal(done.fact.status, "current");
  assert.equal(h.named("memory.fact_accepted").at(-1)?.payload["auto"], false);
  await assert.rejects(() => factAccept(h.ctx, { factId: p.fact.factId }), (e) => codeOf(e) === "validation.precondition_failed");
  const omar = asPerson(h, { kind: "person", id: "usr_omar" }, { respond: agentGet });
  const q = await proposeFact(h.ctx, { ...prefer, kind: "note", text: "Dana hates stand-ups" });
  await assert.rejects(() => factAccept(omar.ctx, { factId: q.fact.factId }), (e) => codeOf(e) === "permission.no_grant");
  const shared = await proposeFact(h.ctx, { text: "Intake logs every call", layer: "agent", agentId: "agt_intake", sourceKind: "run", sourceRef: "run_a" });
  h.deny("folder:fld_intake");
  await assert.rejects(() => factAccept(h.ctx, { factId: shared.fact.factId }), (e) => codeOf(e) === "permission.no_grant");
  assert.deepEqual(assertEventsConform(h), []);
});

test("reject takes a proposed fact out of the list and keeps the row", async () => {
  const h = dana();
  const p = await proposeFact(h.ctx, { ...prefer, kind: "note", text: "Dana wants a daily digest" });
  const out = await factReject(h.ctx, { factId: p.fact.factId });
  assert.equal(out.fact.status, "removed");
  assert.equal((await factsList(h.ctx, {})).facts.length, 0);
  assert.equal(h.rows("SELECT id FROM memory_facts").length, 1);
  assert.equal(h.named("memory.fact_rejected").length, 1);
  await assert.rejects(() => factReject(h.ctx, { factId: p.fact.factId }), (e) => codeOf(e) === "validation.bad_input");
});

test("correct closes the old fact with today's date, adds the new one and keeps the history", async () => {
  const h = dana();
  const first = await proposeFact(h.ctx, { ...prefer, text: "Dana prefers calls at noon" });
  h.advance(3 * DAY);
  const out = await factCorrect(h.ctx, { factId: first.fact.factId, text: "Dana prefers calls at 2 pm" });
  assert.equal(out.closed.status, "closed");
  assert.equal(out.closed.validTo, NOW + 3 * DAY);
  assert.equal(out.closed.closedAt, NOW + 3 * DAY);
  assert.equal(out.fact.status, "current");
  assert.equal(out.fact.text, "Dana prefers calls at 2 pm");
  assert.equal(out.fact.validFrom, NOW + 3 * DAY);
  assert.deepEqual(contractErrors("memory.fact.correct", "out", out), []);
  const got = await factGet(h.ctx, { factId: out.fact.factId });
  assert.deepEqual(got.history.map((x) => x.text), ["Dana prefers calls at noon"]);
  assert.deepEqual(contractErrors("memory.fact.get", "out", got), []);
  assert.equal(h.named("memory.fact_corrected")[0]?.payload["closedFactId"], first.fact.factId);
  const current = await factsList(h.ctx, {});
  assert.deepEqual(current.facts.map((f) => f.text), ["Dana prefers calls at 2 pm"]);
  await assert.rejects(() => factCorrect(h.ctx, { factId: first.fact.factId, text: "again" }), (e) => codeOf(e) === "validation.bad_input");
});

test("facts as of a date answers with what was true then", async () => {
  const h = dana();
  const first = await proposeFact(h.ctx, { ...prefer, text: "Dana prefers calls at noon" });
  h.advance(10 * DAY);
  await factCorrect(h.ctx, { factId: first.fact.factId, text: "Dana prefers calls at 2 pm" });
  const before = await factsAsOf(h.ctx, { date: NOW + 5 * DAY });
  assert.deepEqual(before.facts.map((f) => f.text), ["Dana prefers calls at noon"]);
  const after = await factsAsOf(h.ctx, { date: NOW + 11 * DAY });
  assert.deepEqual(after.facts.map((f) => f.text), ["Dana prefers calls at 2 pm"]);
  const none = await factsAsOf(h.ctx, { date: NOW - DAY });
  assert.equal(none.facts.length, 0);
  assert.deepEqual(contractErrors("memory.facts_as_of", "out", after), []);
});

test("remove closes facts off from answers one at a time or by layer, and keeps them in history", async () => {
  const h = dana();
  const a = await proposeFact(h.ctx, { ...prefer, text: "Dana likes tea" });
  const b = await proposeFact(h.ctx, { ...prefer, text: "Dana likes jazz" });
  const one = await factsRemove(h.ctx, { factIds: [a.fact.factId] });
  assert.equal(one.removed, 1);
  assert.equal((await factsList(h.ctx, {})).facts.length, 1);
  const got = await factGet(h.ctx, { factId: a.fact.factId });
  assert.equal(got.fact.status, "removed");
  const all = await factsRemove(h.ctx, { scope: { layer: "person", agentId: "agt_intake", fromMe: true } });
  assert.equal(all.removed, 1);
  assert.equal((await factsList(h.ctx, {})).facts.length, 0);
  assert.equal(h.rows("SELECT id FROM memory_facts").length, 2);
  assert.equal(h.named("memory.removed").length, 2);
  assert.deepEqual(h.named("memory.removed")[1]?.payload["factIds"], [b.fact.factId]);
  await assert.rejects(() => factsRemove(h.ctx, {}), (e) => codeOf(e) === "validation.bad_input");
  assert.deepEqual(assertEventsConform(h), []);
});

test("remove by scope never reaches another person's layer", async () => {
  const h = dana();
  seedFact(h, { id: "fct_o1", layer: "person", owner: "usr_omar", agentId: "agt_intake", text: "Omar likes tea" });
  const out = await factsRemove(h.ctx, { scope: { layer: "person" } });
  assert.equal(out.removed, 0);
  assert.equal(h.rows("SELECT status FROM memory_facts WHERE id = 'fct_o1'")[0]?.["status"], "current");
  await assert.rejects(() => factsRemove(h.ctx, { factIds: ["fct_o1"] }), (e) => codeOf(e) === "permission.no_grant");
});

test("erase deletes from history for the source person or an admin, and the event holds no content", async () => {
  const h = dana();
  const a = await proposeFact(h.ctx, { ...prefer, text: "Dana's passport expires in May" });
  const out = await erase(h.ctx, { factIds: [a.fact.factId], reason: "asked to" });
  assert.equal(out.erased, 1);
  assert.equal(h.rows("SELECT id FROM memory_facts").length, 0);
  assert.equal(h.rows("SELECT fact_id FROM memory_fact_links").length, 0);
  assert.deepEqual(Object.keys(h.named("memory.erased")[0]!.payload).sort(), ["by", "count"]);
  // Someone else without the admin permission cannot; an admin can, without ever opening the row.
  const b = await proposeFact(h.ctx, { ...prefer, text: "Dana's lock code is private" });
  const omar = asPerson(h, { kind: "person", id: "usr_omar" }, { respond: agentGet });
  await assert.rejects(() => erase(omar.ctx, { factIds: [b.fact.factId] }), (e) => codeOf(e) === "permission.no_grant");
  const boss = asPerson(h, { kind: "person", id: "usr_boss" }, { admin: true, respond: agentGet });
  assert.equal((await erase(boss.ctx, { factIds: [b.fact.factId] })).erased, 1);
  assert.equal(h.rows("SELECT id FROM memory_facts").length, 0);
  await assert.rejects(() => erase(h.ctx, {}), (e) => codeOf(e) === "validation.bad_input");
  assert.deepEqual(assertEventsConform(h), []);
});

test("erase by scope finds facts by source, subject or layer", async () => {
  const h = dana();
  await proposeFact(h.ctx, { text: "Acme renews in March", sourceKind: "record", sourceRef: "rec_acme", agentId: "agt_intake" });
  await proposeFact(h.ctx, { text: "Beta renews in June", sourceKind: "record", sourceRef: "rec_beta", agentId: "agt_intake" });
  const out = await erase(h.ctx, { scope: { layer: "person", subject: "rec_acme" } });
  assert.equal(out.erased, 1);
  assert.equal(h.rows("SELECT id FROM memory_facts").length, 1);
});

test("lists filter by layer, status, 'From you' and text, and page with a cursor", async () => {
  const h = dana();
  for (let i = 0; i < 5; i++) {
    h.advance(1000);
    await proposeFact(h.ctx, { ...prefer, text: `Dana likes flavour number ${i}` });
  }
  seedFact(h, { id: "fct_agent1", layer: "agent", agentId: "agt_intake", text: "Intake never calls before nine", sourcePerson: "usr_boss" });
  const all = await factsList(h.ctx, { limit: 4 });
  assert.equal(all.total, 6);
  assert.equal(all.facts.length, 4);
  assert.ok(all.next);
  const rest = await factsList(h.ctx, { limit: 4, cursor: all.next as string });
  assert.equal(rest.facts.length, 2);
  assert.equal(rest.next, undefined);
  assert.equal((await factsList(h.ctx, { layer: "agent" })).facts.length, 1);
  assert.equal((await factsList(h.ctx, { fromMe: true })).facts.length, 5);
  assert.equal((await factsList(h.ctx, { q: "NUMBER 3" })).facts.length, 1);
  assert.equal((await factsList(h.ctx, { status: ["proposed"] })).facts.length, 0);
  assert.deepEqual(contractErrors("memory.facts.list", "out", all), []);
  // Newest first.
  assert.equal(all.facts[0]?.text, "Dana likes flavour number 4");
});

test("counts and layers for the agent strip", async () => {
  const h = dana();
  await proposeFact(h.ctx, { ...prefer, text: "Dana likes tea" });
  await proposeFact(h.ctx, { ...prefer, kind: "note", text: "Dana keeps Fridays free" });
  seedFact(h, { id: "fct_agent1", layer: "agent", agentId: "agt_intake", text: "Intake never calls before nine", sourcePerson: "usr_boss" });
  seedFact(h, { id: "fct_other", layer: "person", owner: "usr_omar", agentId: "agt_intake", text: "Omar keeps secrets" });
  const c = await counts(h.ctx, { agentId: "agt_intake" });
  assert.deepEqual(c, { current: 2, proposed: 1, fromMe: 1 });
  assert.deepEqual(contractErrors("memory.counts", "out", c), []);
  const l = await layersList(h.ctx, { agentId: "agt_intake", projectId: "prj_harlow" });
  assert.deepEqual(l.layers.map((x) => x.layer), ["person", "agent", "project", "space"]);
  assert.equal(l.layers[0]?.private, true);
  assert.ok(l.layers.every((x) => x.readable && x.writable));
  h.deny("folder:fld_harlow");
  const denied = await layersList(h.ctx, { agentId: "agt_intake", projectId: "prj_harlow" });
  assert.equal(denied.layers.find((x) => x.layer === "project")?.readable, false);
  assert.deepEqual(contractErrors("memory.layers.list", "out", l), []);
});

test("a shared layer is read through the folder: no view, no fact", async () => {
  const h = dana();
  seedFact(h, { id: "fct_agent1", layer: "agent", agentId: "agt_intake", text: "Intake never calls before nine", sourcePerson: "usr_boss" });
  assert.equal((await factsList(h.ctx, {})).facts.length, 1);
  h.deny("folder:fld_intake");
  assert.equal((await factsList(h.ctx, {})).facts.length, 0);
  await assert.rejects(() => factGet(h.ctx, { factId: "fct_agent1" }), (e) => codeOf(e) === "validation.not_found");
});
