// Learned feed, Undo, Trash, Archive, Erase and the trail (owner design 30 Oct 2026, rulings 2 and 5): every rule is proven on a real SQLite behind the host's ctx.db guard.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { capture, erase, factGet, factsList, factsRemove, search } from "../handlers/facts.ts";
import { archiveSweep, learned, restore, trailRead, trashSearch, undo } from "../handlers/lifecycle.ts";
import { assertEventsConform, asPerson, codeOf, contractErrors, DAY, harness, NOW, seedFact } from "../fixtures/harness.ts";
import type { Harness, Responder } from "../fixtures/harness.ts";

const person = (id: string) => ({ kind: "person", id });
const SPEECH = "I prefer short answers. Remember that invoices go out on Monday.";

function chat(kind: string, mode: string | undefined, extra: Record<string, unknown> = {}, messages?: unknown[]): Record<string, Responder> {
  return {
    "agents.get": () => ({ agent: { folderId: "fld_intake", ownerId: "usr_boss", ...(mode ? { captureMode: mode } : {}) } }),
    "threads.get": () => ({ thread: { kind, starter: "usr_dana", agents: [{ agentId: "agt_intake", mode: "lead" }], ...extra } }),
    "chat.messages.list": () => ({ messages: messages ?? [{ messageId: "msg_1", author: person("usr_dana"), body: SPEECH }] }),
  };
}
const svc = { kind: "service", id: "svc_engine" } as const;

test("capture mode auto saves every kind, tells the Learned feed who learned it and from where, and Undo moves it to Trash", async () => {
  const h = harness({ principal: svc, respond: chat("chat", "auto") });
  const out = await capture(h.ctx, { threadId: "thr_one", reason: "closed" });
  assert.deepEqual(out, { proposed: 2, merged: 2 }, "a preference and a note both save: not only the low-risk kind");
  assert.deepEqual(h.rows("SELECT status FROM memory_facts").map((r) => r["status"]), ["current", "current"]);
  const ev = h.named("memory.learned");
  assert.equal(ev.length, 2);
  assert.deepEqual(ev.map((e) => [e.payload["actor"], e.payload["actorKind"], e.payload["sourceKind"], e.payload["sourceRef"], e.payload["from"], e.payload["saved"]]), Array(2).fill(["agt_intake", "agent", "chat", "thr_one", "usr_dana", true]));
  assert.ok(ev.every((e) => !JSON.stringify(e.payload).includes("short answers")), "the event never carries the words");
  assert.deepEqual(assertEventsConform(h), []);

  const dana = asPerson(h, person("usr_dana"));
  const feed = await learned(dana.ctx, {});
  assert.deepEqual(contractErrors("memory.learned", "out", feed), []);
  assert.equal(feed.items.length, 2);
  assert.ok(feed.items.every((i) => i.actor === "agt_intake" && i.actorKind === "agent" && i.sourceKind === "chat" && i.sourceRef === "thr_one" && i.sourceLink === "/chats/thr_one" && !i.undone));
  assert.ok(feed.items.some((i) => i.fact.text === "I prefer short answers."));
  assert.equal((await learned(asPerson(h, person("usr_omar")).ctx, {})).items.length, 0, "personal memory is the owner's alone, in the feed too");

  const first = feed.items[0]!.fact.factId;
  const undone = await undo(dana.ctx, { factId: first });
  assert.deepEqual(contractErrors("memory.undo", "out", undone), []);
  assert.equal(undone.trashed, true);
  assert.equal(h.rows("SELECT status, trash_reason FROM memory_facts WHERE id = ?", first)[0]!["trash_reason"], "undone");
  assert.equal((await learned(dana.ctx, {})).items.find((i) => i.fact.factId === first)?.undone, true);
  assert.equal((await factsList(dana.ctx, {})).facts.length, 1, "an undone fact is out of the normal list");
  const back = await restore(dana.ctx, { factId: first });
  assert.equal(back.fact.status, "current");
  assert.equal((await factsList(dana.ctx, {})).facts.length, 2);
  assert.deepEqual(h.rows("SELECT action FROM memory_trail WHERE fact_id = ? ORDER BY at, rowid", first).map((r) => r["action"]), ["learn", "undo", "restore"]);
  await assert.rejects(() => undo(asPerson(h, person("usr_omar")).ctx, { factId: first }), (e) => codeOf(e) === "validation.not_found");
});

test("an agent with no captureMode answer, or on propose, still waits for a person", async () => {
  const none = harness({ principal: svc, respond: chat("chat", undefined) });
  assert.deepEqual(await capture(none.ctx, { threadId: "thr_one", reason: "closed" }), { proposed: 2, merged: 1 });
  const prop = harness({ principal: svc, respond: chat("chat", "propose") });
  assert.deepEqual(await capture(prop.ctx, { threadId: "thr_one", reason: "closed" }), { proposed: 2, merged: 0 });
  assert.equal(prop.named("memory.learned").length, 2, "proposed facts are in the feed too");
});

test("require review for shared memory holds Space and project facts in Proposed, never the personal ones", async () => {
  const msgs = [{ messageId: "msg_9", author: person("usr_lead"), body: "We decided to ship the teal version first." }];
  const open = harness({ principal: svc, respond: chat("channel", "auto", { scopeType: "project", scopeId: "prj_harlow" }, msgs) });
  assert.deepEqual(await capture(open.ctx, { threadId: "thr_chan", reason: "idle" }), { proposed: 1, merged: 1 });
  const on = harness({ principal: svc, respond: chat("channel", "auto", { scopeType: "project", scopeId: "prj_harlow" }, msgs), settings: { "memory.require_review": true } });
  assert.deepEqual(await capture(on.ctx, { threadId: "thr_chan", reason: "idle" }), { proposed: 1, merged: 0 });
  assert.equal(on.rows("SELECT layer, status FROM memory_facts")[0]!["status"], "proposed");
  const onlyThis = harness({ principal: svc, respond: chat("channel", "auto", { scopeType: "project", scopeId: "prj_harlow" }, msgs), settings: { "memory.review_projects": ["prj_harlow"] } });
  assert.deepEqual(await capture(onlyThis.ctx, { threadId: "thr_chan", reason: "idle" }), { proposed: 1, merged: 0 });
  const otherProject = harness({ principal: svc, respond: chat("channel", "auto", { scopeType: "project", scopeId: "prj_other" }, msgs), settings: { "memory.review_projects": ["prj_harlow"] } });
  assert.deepEqual(await capture(otherProject.ctx, { threadId: "thr_chan", reason: "idle" }), { proposed: 1, merged: 1 }, "a project that is not named is not held back");
  const personal = harness({ principal: svc, respond: chat("chat", "auto"), settings: { "memory.require_review": true } });
  assert.deepEqual(await capture(personal.ctx, { threadId: "thr_one", reason: "closed" }), { proposed: 2, merged: 2 });
  const space = harness({ principal: svc, respond: { ...chat("channel", "auto", {}, msgs), "threads.get": () => ({ thread: { kind: "channel", agents: [] } }) }, settings: { "memory.require_review": true } });
  assert.deepEqual(await capture(space.ctx, { threadId: "thr_chan", reason: "idle" }), { proposed: 1, merged: 0 }, "a Space fact waits");
  assert.equal(space.rows("SELECT layer, status FROM memory_facts")[0]!["layer"], "space");
});

test("an agent that saves a fact follows its capture mode and the review setting", async () => {
  const agent = { kind: "agent", id: "agt_intake" } as const;
  const respond = { "agents.get": () => ({ agent: { folderId: "fld_intake", ownerId: "usr_boss", captureMode: "auto" } }) };
  const h = harness({ principal: agent, actingFor: "usr_dana", respond });
  const mine = await (await import("../handlers/facts.ts")).proposeFact(h.ctx, { text: "Dana wants Friday updates.", sourceKind: "chat", sourceRef: "thr_a" });
  assert.equal(mine.merged, true, "auto saves what the agent learns");
  assert.equal(h.named("memory.learned").length, 1);
  const review = harness({ principal: agent, actingFor: "usr_dana", respond, settings: { "memory.require_review": true } });
  const shared = await (await import("../handlers/facts.ts")).proposeFact(review.ctx, { layer: "space", text: "Invoices go out on Monday.", sourceKind: "chat", sourceRef: "thr_a" });
  assert.equal(shared.merged, false, "a Space fact waits when review is required");
  const propose = harness({ principal: agent, actingFor: "usr_dana", respond: { "agents.get": () => ({ agent: { folderId: "fld_intake", ownerId: "usr_boss", captureMode: "propose" } }) } });
  assert.equal((await (await import("../handlers/facts.ts")).proposeFact(propose.ctx, { text: "Dana wants Friday updates.", sourceKind: "chat", sourceRef: "thr_a" })).merged, false);
});

function seeded(): Harness {
  const h = harness();
  seedFact(h, { id: "fct_shared", layer: "project", projectId: "prj_harlow", text: "The Harlow retainer is 4000 a month.", status: "current", kind: "decision" });
  seedFact(h, { id: "fct_mine", layer: "person", text: "I keep my invoices in the teal folder.", status: "current" });
  return h;
}

test("delete moves a fact to Trash: out of recall and search, found by Trash search, restored by a person and by an agent", async () => {
  const h = seeded();
  const out = await factsRemove(h.ctx, { factIds: ["fct_shared", "fct_mine"] });
  assert.equal(out.removed, 2);
  const row = h.rows("SELECT status, trashed_at, trash_reason, prev_status, text FROM memory_facts WHERE id = 'fct_shared'")[0]!;
  assert.deepEqual([row["status"], row["trashed_at"], row["trash_reason"], row["prev_status"], row["text"]], ["removed", NOW, "removed", "current", "The Harlow retainer is 4000 a month."], "the row and its words are kept");
  assert.equal((await search(h.ctx, { q: "Harlow retainer" })).hits.length, 0, "normal search does not see Trash");
  assert.equal((await factsList(h.ctx, {})).facts.length, 0);
  const found = await trashSearch(h.ctx, { q: "Harlow retainer" });
  assert.deepEqual(contractErrors("memory.trash.search", "out", found), []);
  assert.deepEqual(found.facts.map((f) => f.factId), ["fct_shared"]);
  assert.equal(found.facts[0]!.trashReason, "removed");
  assert.deepEqual((await trashSearch(h.ctx, { q: "teal folder" })).facts.map((f) => f.factId), ["fct_mine"], "the owner finds their own personal fact in Trash");
  assert.equal((await trashSearch(asPerson(h, person("usr_omar")).ctx, { q: "teal folder" })).facts.length, 0, "and nobody else does");

  // an agent acting for Dana can restore both: it sees what she sees
  const agent = asPerson(h, { kind: "agent", id: "agt_intake" }, { actingFor: "usr_dana" });
  const r1 = await restore(agent.ctx, { factId: "fct_mine" });
  assert.deepEqual(contractErrors("memory.restore", "out", r1), []);
  assert.deepEqual([r1.fact.status, r1.restoredFrom], ["current", "trash"]);
  // a person restores the shared one
  const r2 = await restore(h.ctx, { factId: "fct_shared" });
  assert.equal(r2.fact.status, "current");
  assert.equal((await search(h.ctx, { q: "Harlow retainer" })).hits.length, 1, "recall sees it again");
  const rows = h.rows("SELECT fact_id, action, actor, actor_kind, acting_for FROM memory_trail WHERE action IN ('delete', 'restore') ORDER BY at, rowid");
  assert.deepEqual(rows.map((r) => `${r["fact_id"]}:${r["action"]}:${r["actor_kind"]}`), ["fct_shared:delete:person", "fct_mine:delete:person", "fct_mine:restore:agent", "fct_shared:restore:person"]);
  assert.equal(rows[2]!["acting_for"], "usr_dana");
  await assert.rejects(() => restore(h.ctx, { factId: "fct_shared" }), (e) => codeOf(e) === "validation.precondition_failed", "a live fact is not in Trash");
  await factsRemove(h.ctx, { factIds: ["fct_mine"] });
  await assert.rejects(() => restore(asPerson(h, person("usr_omar")).ctx, { factId: "fct_mine" }), (e) => codeOf(e) === "validation.not_found", "someone who cannot see it cannot restore it");
  assert.deepEqual(assertEventsConform(h), []);
});

test("untouched Trash moves to Archive after the Space setting; an admin restores from Archive", async () => {
  const h = seeded();
  await factsRemove(h.ctx, { factIds: ["fct_shared"] });
  h.advance(59 * DAY);
  assert.deepEqual(await archiveSweep(h.ctx), { archived: 0, days: 60 });
  // reading it counts as touching it: its days start again
  await factGet(h.ctx, { factId: "fct_shared" });
  h.advance(2 * DAY);
  assert.equal((await archiveSweep(h.ctx)).archived, 0, "61 days after the delete, but touched at day 59");
  h.advance(58 * DAY);
  const swept = await archiveSweep(h.ctx);
  assert.equal(swept.archived, 1);
  assert.equal((await trashSearch(h.ctx, { q: "Harlow" })).facts.length, 0, "Archive is out of Trash search");
  assert.equal((await search(h.ctx, { q: "Harlow retainer" })).hits.length, 0, "and out of all search");
  await assert.rejects(() => trashSearch(h.ctx, { q: "Harlow", area: "archive" }), (e) => codeOf(e) === "permission.role_lacks_permission");
  await assert.rejects(() => restore(h.ctx, { factId: "fct_shared" }), (e) => codeOf(e) === "permission.role_lacks_permission");
  const admin = asPerson(h, person("usr_admin"), { admin: true });
  assert.deepEqual((await trashSearch(admin.ctx, { q: "Harlow", area: "archive" })).facts.map((f) => f.factId), ["fct_shared"]);
  const back = await restore(admin.ctx, { factId: "fct_shared" });
  assert.deepEqual([back.fact.status, back.restoredFrom], ["current", "archive"]);
  assert.deepEqual(h.rows("SELECT action, actor_kind FROM memory_trail WHERE fact_id = 'fct_shared' ORDER BY at, rowid").map((r) => `${r["action"]}:${r["actor_kind"]}`), ["delete:person", "archive:upkeep", "restore:person"]);
  assert.equal(h.named("memory.archived").length, 1);
  assert.deepEqual(assertEventsConform(h), []);
});

test("the period is the Space setting held between 30 and 90 days", async () => {
  for (const [set, days] of [[10, 30], [45, 45], [200, 90], [undefined, 60]] as const) {
    const h = harness({ settings: set === undefined ? {} : { "memory.trash_days": set } });
    seedFact(h, { id: "fct_a", layer: "space", text: "Office closes at five.", status: "current" });
    await factsRemove(h.ctx, { factIds: ["fct_a"] });
    h.advance(days * DAY - 1);
    assert.equal((await archiveSweep(h.ctx)).archived, 0, `not at ${days} days minus a moment`);
    h.advance(1);
    assert.deepEqual(await archiveSweep(h.ctx), { archived: 1, days });
  }
});

test("an erase removes the content and leaves a contentless line on the trail", async () => {
  const h = harness({ admin: true });
  seedFact(h, { id: "fct_gone", layer: "space", text: "Clara Obermeyer pays by wire transfer.", status: "current", sourcePerson: "usr_dana" });
  seedFact(h, { id: "fct_priv", layer: "person", text: "I take medication at nine.", status: "current", owner: "usr_dana" });
  await factsRemove(h.ctx, { factIds: ["fct_gone"] });
  const out = await erase(h.ctx, { factIds: ["fct_gone", "fct_priv"], reason: "asked by the person" });
  assert.equal(out.erased, 2);
  assert.equal(h.rows("SELECT id FROM memory_facts").length, 0);
  const lines = h.rows("SELECT * FROM memory_trail WHERE action = 'erase' ORDER BY fact_id");
  assert.deepEqual(lines.map((r) => r["fact_id"]), ["fct_gone", "fct_priv"]);
  assert.equal(lines[0]!["reason"], "asked by the person");
  assert.equal(lines[0]!["layer"], "space");
  const dump = JSON.stringify(h.rows("SELECT * FROM memory_trail"));
  for (const word of ["Obermeyer", "wire transfer", "medication"]) assert.ok(!dump.includes(word), `the trail holds no content: ${word}`);
  assert.equal(h.rows("SELECT * FROM memory_trail WHERE fact_id = 'fct_gone'").length, 2, "the delete line stays beside the erase line");
  const seen = await trailRead(h.ctx, { factId: "fct_gone" });
  assert.deepEqual(contractErrors("memory.trail", "out", seen), []);
  assert.deepEqual(seen.rows.map((r) => r["action"]), ["erase", "delete"]);
});

test("the trail is only ever added to, and a reader sees only the lines for what they can see", async () => {
  for (const f of ["facts.ts", "lifecycle.ts", "purge.ts", "graph.ts", "pages.ts", "upkeep.ts"]) {
    const url = new URL(`../handlers/${f}`, import.meta.url);
    const src = fs.existsSync(url) ? fs.readFileSync(url, "utf8") : "";
    assert.ok(!/DELETE FROM memory_trail|UPDATE memory_trail|DROP TABLE memory_trail/i.test(src), `${f} never deletes or edits a trail line`);
  }
  const h = seeded();
  await factsRemove(h.ctx, { factIds: ["fct_mine", "fct_shared"] });
  const dana = await trailRead(h.ctx, {});
  assert.equal(dana.rows.length, 2);
  const omar = await trailRead(asPerson(h, person("usr_omar")).ctx, {});
  assert.deepEqual(omar.rows.map((r) => r["factId"]), ["fct_shared"], "the personal line is the owner's alone");
});
