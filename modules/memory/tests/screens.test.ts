// What the memory screens read beyond the basics: facts that carry their subject, source title, author and versions; the Learned feed filtered by chat and showing upkeep lines; pages with a subtitle,
// description and "visible to", moved between layers; graph edges that say where their evidence is; and spend per night.
import test from "node:test";
import assert from "node:assert/strict";
import { search } from "../handlers/facts.ts";
import { graph, indexGraph } from "../handlers/graph.ts";
import { learned, trashSearch } from "../handlers/lifecycle.ts";
import { pageGet, pageList, pagePut, pageSetVisibility, pageVersions } from "../handlers/pages.ts";
import { maintain, questionsList, setUpkeepModel, upkeepStatus } from "../handlers/upkeep.ts";
import { capture, factCorrect, factsRemove } from "../handlers/facts.ts";
import { asPerson, codeOf, contractErrors, DAY, harness, NOW, seedFact } from "../fixtures/harness.ts";

const svc = { kind: "service", id: "svc_engine" } as const;
const chat = (mode = "auto") => ({
  "agents.get": () => ({ agent: { folderId: "fld_intake", ownerId: "usr_boss", captureMode: mode } }),
  "threads.get": () => ({ thread: { kind: "channel", title: "Brooks weekly update", createdAt: NOW - DAY, agents: [{ agentId: "agt_intake", mode: "lead" }], scopeType: "project", scopeId: "prj_brooks" } }),
  "chat.messages.list": () => ({ messages: [{ messageId: "msg_7", author: { kind: "person", id: "usr_dana" }, body: "We decided to bill Brooks Logistics monthly.", createdAt: NOW - DAY }] }),
});

test("a fact row carries its subject page, source title, author and versions, and the Learned feed filters by chat and lists upkeep lines", async () => {
  const h = harness({ admin: true, principal: svc, respond: chat() });
  const page = await pagePut(asPerson(h, { kind: "person", id: "usr_dana" }).ctx, { title: "Brooks Logistics", kind: "client", layer: "space", notes: "Freight client.", subtitle: "Client at Brooks Logistics" });
  await indexGraph(h.ctx, { entity: "chat", id: "thr_wk", seq: 1 });
  await capture(h.ctx, { threadId: "thr_wk", reason: "idle" });
  const dana = asPerson(h, { kind: "person", id: "usr_dana" }, { admin: true, respond: chat() });
  const feed = await learned(dana.ctx, { threadId: "thr_wk" });
  assert.deepEqual(contractErrors("memory.learned", "out", feed), []);
  assert.equal(feed.items.length, 1);
  const f = feed.items[0]!.fact;
  assert.deepEqual(f.subject, { pageId: page.page.pageId, title: "Brooks Logistics", kind: "client" });
  assert.equal(f.sourceTitle, "Brooks weekly update");
  assert.deepEqual([f.by, f.byKind, f.versions], ["agt_intake", "agent", 1]);
  assert.equal((await learned(dana.ctx, { threadId: "thr_other" })).items.length, 0);
  assert.equal((await learned(dana.ctx, { actorKind: "person" })).items.length, 0);
  assert.equal((await learned(dana.ctx, { actorKind: "agent" })).items.length, 1);
  // a correction makes version 2
  const fixed = await factCorrect(dana.ctx, { factId: f.factId, text: "We decided to bill Brooks Logistics quarterly." });
  assert.equal((await pageGet(dana.ctx, { pageId: page.page.pageId })).facts.find((x) => x.factId === fixed.fact.factId)?.versions, 2);
  // upkeep lines: two near-duplicate facts merge, a contradiction is flagged
  seedFact(dana, { id: "fct_x1", layer: "space", text: "Brooks Logistics pays on the first", kind: "note", learnedAt: NOW - 5 * DAY });
  seedFact(dana, { id: "fct_x2", layer: "space", text: "Brooks Logistics pays on the first.", kind: "note", learnedAt: NOW - 4 * DAY });
  seedFact(dana, { id: "fct_t1", layer: "space", text: "Brooks's timezone is Pacific", learnedAt: NOW - 5 * DAY });
  seedFact(dana, { id: "fct_t2", layer: "space", text: "Brooks's timezone is Eastern", learnedAt: NOW - 4 * DAY });
  await maintain(dana.ctx, {});
  const all = await learned(dana.ctx, {});
  assert.deepEqual(all.items.map((i) => i.what).sort(), ["flagged", "learned", "merged"]);
  const merged = all.items.find((i) => i.what === "merged")!;
  assert.deepEqual([merged.actorKind, merged.mergedInto, merged.undone], ["upkeep", "fct_x1", false]);
  assert.match(merged.note ?? "", /Merged into fct_x1/);
  assert.equal(all.items.find((i) => i.what === "flagged")!.actorKind, "upkeep");
  assert.deepEqual((await learned(dana.ctx, { what: ["merged"] })).items.map((i) => i.what), ["merged"]);
  const q = await questionsList(dana.ctx, {});
  assert.deepEqual(q.questions[0]!.facts.map((x) => x.versions), [1, 1], "the question's facts carry the same extras");
  // trash search and search hits carry the same
  await factsRemove(dana.ctx, { factIds: [f.factId] });
  assert.equal((await trashSearch(dana.ctx, { q: "bill Brooks" })).facts[0]?.sourceTitle, "Brooks weekly update");
  const hit = (await search(dana.ctx, { q: "Brooks Logistics pays" })).hits.find((x) => x.factId === "fct_x1")!;
  assert.deepEqual(hit.subject, { pageId: page.page.pageId, title: "Brooks Logistics", kind: "client" });
});

test("a page has a subtitle, a description and who it is visible to, and can be moved between layers with its versions, sealed or opened as needed", async () => {
  const h = harness({ principal: { kind: "person", id: "usr_dana" } });
  const made = await pagePut(h.ctx, { title: "Brooks Logistics", kind: "client", layer: "space", notes: "# Brooks\n\nFreight forwarder in Houston.\nowner:: [[Mia Chen]]" });
  assert.deepEqual(contractErrors("memory.page.put", "out", made), []);
  assert.deepEqual([made.page.subtitle, made.page.blurb, made.page.visibleTo], ["Client", "Freight forwarder in Houston.", "Everyone in this Space"]);
  const edited = await pagePut(h.ctx, { pageId: made.page.pageId, notes: "# Brooks\n\nFreight forwarder in Houston, three offices.", subtitle: "Client at Houston", blurb: "Our largest freight client." });
  assert.deepEqual([edited.page.subtitle, edited.page.blurb, edited.page.version], ["Client at Houston", "Our largest freight client.", 2]);
  // to a personal page: sealed everywhere, versions kept
  const mine = await pageSetVisibility(h.ctx, { pageId: made.page.pageId, layer: "person" });
  assert.deepEqual([mine.moved, mine.page.layer, mine.page.visibleTo, mine.page.subtitle], [true, "person", "Only you", "Client at Houston"]);
  const sealed = JSON.stringify([h.rows("SELECT * FROM memory_pages"), h.rows("SELECT * FROM memory_page_versions"), h.rows("SELECT * FROM memory_page_links")]).toLowerCase();
  for (const w of ["brooks", "houston", "freight", "mia chen"]) assert.ok(!sealed.includes(w), `no plain ${w} after the move`);
  assert.equal((await pageVersions(h.ctx, { pageId: made.page.pageId })).versions.length, 2);
  assert.equal((await pageGet(h.ctx, { pageId: made.page.pageId })).notes.includes("three offices"), true);
  await assert.rejects(() => pageGet(asPerson(h, { kind: "person", id: "usr_omar" }).ctx, { pageId: made.page.pageId }), (e) => codeOf(e) === "validation.not_found");
  // and out again, to a project
  const proj = await pageSetVisibility(h.ctx, { pageId: made.page.pageId, layer: "project", projectId: "prj_harlow" });
  assert.deepEqual([proj.page.layer, proj.page.projectId, proj.page.visibleTo], ["project", "prj_harlow", "People on the project"]);
  assert.equal(h.rows("SELECT title, enc FROM memory_pages")[0]!["title"], "Brooks Logistics");
  assert.equal((await pageVersions(h.ctx, { pageId: made.page.pageId })).versions[1]!.notes.includes("Freight forwarder in Houston."), true);
  assert.equal((await pageSetVisibility(h.ctx, { pageId: made.page.pageId, layer: "project", projectId: "prj_harlow" })).moved, false);
  await pagePut(h.ctx, { title: "Brooks Logistics", layer: "space", notes: "another" });
  await assert.rejects(() => pageSetVisibility(h.ctx, { pageId: made.page.pageId, layer: "space" }), (e) => codeOf(e) === "validation.precondition_failed");
  assert.equal((await pageList(h.ctx, {})).pages.length, 2);
});

test("graph edges say where their evidence is, a chat links to the very message, page nodes carry the page to open, and spend is read per night", async () => {
  const h = harness({
    admin: true,
    respond: {
      "threads.get": () => ({ thread: { title: "Intake Monday", createdAt: NOW - 2 * DAY, kind: "chat" } }),
      "chat.messages.list": () => ({ messages: [{ messageId: "msg_42", author: { kind: "person", id: "usr_dana" }, body: "Call [[Brooks Logistics]] today.", createdAt: NOW - DAY }] }),
    },
  });
  const firm = await pagePut(h.ctx, { title: "Brooks Logistics", layer: "space", notes: "x", kind: "client" });
  const mia = await pagePut(h.ctx, { title: "Mia Chen", layer: "space", notes: "works at:: [[Brooks Logistics]]", kind: "person" });
  await indexGraph(h.ctx, { entity: "chat", id: "thr_a", seq: 1 });
  const g = await graph(h.ctx, { scope: "space" });
  assert.deepEqual(contractErrors("memory.graph", "out", g), []);
  assert.equal(g.nodes.find((n) => n.nodeId === `page:${firm.page.pageId}`)?.pageId, firm.page.pageId);
  const link = g.edges.find((e) => e.kind === "link")!;
  assert.deepEqual(link.source, { title: "Mia Chen", kind: "page", link: `/memory/pages/${mia.page.pageId}` });
  const mention = g.edges.find((e) => e.kind === "mention")!;
  assert.deepEqual(mention.source, { title: "Intake Monday", kind: "chat", link: "vyre://thread/thr_a?m=msg_42" });
  assert.ok(!("message" in mention), "the message id is only in the link");
  // spend per night
  seedFact(h, { id: "fct_a", layer: "space", text: "One fact here", learnedAt: NOW - DAY });
  seedFact(h, { id: "fct_b", layer: "space", text: "Another fact here", learnedAt: NOW - DAY });
  setUpkeepModel(async () => ({ actions: [], usage: { inTokens: 10, outTokens: 1, costMicros: 4_000 } }));
  try {
    await maintain(h.ctx, {});
    h.advance(DAY);
    await maintain(h.ctx, {});
  } finally { setUpkeepModel(null); }
  const st = await upkeepStatus(h.ctx, {});
  assert.deepEqual(contractErrors("memory.upkeep.status", "out", st), []);
  assert.deepEqual(st.nights.map((n) => [n.runs, n.costMicros]), [[1, 4_000], [1, 4_000]]);
  assert.deepEqual([st.lastNight?.costMicros, st.spentMicros], [4_000, 8_000]);
});
