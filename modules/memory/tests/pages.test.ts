// Living pages (owner design 30 Oct 2026, ruling 4): a page per subject with versioned Notes, [[links]] that become labelled edges with the line they were written in, backlinks from chats and records,
// the graph with typed nodes, evidence, a date and filters, a Markdown export of the whole brain, and a personal page that stays sealed to its owner everywhere.
import test from "node:test";
import assert from "node:assert/strict";
import { erase, factsRemove, search } from "../handlers/facts.ts";
import { graph, indexGraph } from "../handlers/graph.ts";
import { archiveSweep, restore, trailRead, trashSearch } from "../handlers/lifecycle.ts";
import { backlinks, exportMarkdown, pageDelete, pageGet, pageList, pagePut, pageRestoreVersion, pageVersions } from "../handlers/pages.ts";
import { parseLinks } from "../pages.ts";
import { asPerson, codeOf, contractErrors, DAY, harness, NOW, seedFact } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const put = (h: Harness, title: string, notes: string, extra: Record<string, unknown> = {}) => pagePut(h.ctx, { title, notes, layer: "space", ...extra });
const dana = { kind: "person", id: "usr_dana" } as const;

test("a page is made with its first Notes as version 1; each save adds a version and keeps the old ones; a stale writer is refused", async () => {
  const h = harness();
  const made = await put(h, "Harlow Dental", "Retainer client since March.", { kind: "client" });
  assert.deepEqual(contractErrors("memory.page.put", "out", made), []);
  assert.deepEqual([made.created, made.page.version, made.page.kind, made.page.layer], [true, 1, "client", "space"]);
  const again = await put(h, "harlow  dental", "Retainer client since March. Wants Friday updates.", { baseVersion: 1 });
  assert.deepEqual([again.created, again.page.pageId === made.page.pageId, again.page.version], [false, true, 2], "the same title finds the same page");
  await assert.rejects(() => pagePut(h.ctx, { pageId: made.page.pageId, notes: "late edit", baseVersion: 1 }), (e) => codeOf(e) === "validation.precondition_failed");
  const same = await pagePut(h.ctx, { pageId: made.page.pageId, notes: "Retainer client since March. Wants Friday updates." });
  assert.equal(same.page.version, 2, "saving the same Notes is not a new version");
  const v = await pageVersions(h.ctx, { pageId: made.page.pageId });
  assert.deepEqual(contractErrors("memory.page.versions", "out", v), []);
  assert.deepEqual(v.versions.map((x) => [x.version, x.notes]), [[2, "Retainer client since March. Wants Friday updates."], [1, "Retainer client since March."]]);
  const back = await pageRestoreVersion(h.ctx, { pageId: made.page.pageId, version: 1 });
  assert.equal(back.page.version, 3);
  assert.equal((await pageGet(h.ctx, { pageId: made.page.pageId })).notes, "Retainer client since March.");
  assert.equal((await pageVersions(h.ctx, { pageId: made.page.pageId })).versions.length, 3, "nothing was overwritten");
  assert.deepEqual(h.rows("SELECT action, actor_kind FROM memory_trail WHERE page_id = ? ORDER BY rowid", made.page.pageId).map((r) => r["action"]), ["create", "edit", "edit"]);
});

test("[[links]] in the Notes become labelled edges with the line as evidence, and a link to a page that does not exist yet resolves when it does", async () => {
  assert.deepEqual(parseLinks("Plain [[Alpha]] mention.\nworks with:: [[Beta|Bee]] and [[Gamma#part]]\n- owner:: [[Alpha]]"), [
    { target: "Alpha", label: "", evidence: "Plain [[Alpha]] mention." },
    { target: "Beta", label: "works with", evidence: "works with:: [[Beta|Bee]] and [[Gamma#part]]" },
    { target: "Gamma", label: "works with", evidence: "works with:: [[Beta|Bee]] and [[Gamma#part]]" },
    { target: "Alpha", label: "owner", evidence: "- owner:: [[Alpha]]" },
  ]);
  const h = harness();
  const dentist = await put(h, "Dr Harlow", "Runs Harlow Dental.\nemployer:: [[Harlow Dental]]\nnext step:: [[Intake form]]");
  let page = await pageGet(h.ctx, { pageId: dentist.page.pageId });
  assert.deepEqual(contractErrors("memory.page.get", "out", page), []);
  assert.deepEqual(page.links.map((l) => [l.label, l.title, l.pageId ?? null]), [["employer", "Harlow Dental", null], ["next step", "Intake form", null]], "neither page exists yet");
  const firm = await put(h, "Harlow Dental", "A dental practice.", { kind: "client" });
  page = await pageGet(h.ctx, { pageId: dentist.page.pageId });
  assert.deepEqual(page.links.map((l) => [l.label, l.title, l.pageId ?? null]), [["employer", "Harlow Dental", firm.page.pageId], ["next step", "Intake form", null]]);
  assert.equal(page.links[0]!.evidence, "employer:: [[Harlow Dental]]");
  const inbound = await pageGet(h.ctx, { pageId: firm.page.pageId });
  assert.deepEqual(inbound.backlinks.map((b) => [b.kind, b.title, b.label, b.quote]), [["page", "Dr Harlow", "employer", "employer:: [[Harlow Dental]]"]]);
  assert.deepEqual((await backlinks(h.ctx, { pageId: firm.page.pageId })).backlinks.length, 1);
  // an edit that drops the link drops the edge, and the version history still shows it
  await pagePut(h.ctx, { pageId: dentist.page.pageId, notes: "Runs Harlow Dental." });
  assert.equal((await pageGet(h.ctx, { pageId: firm.page.pageId })).backlinks.length, 0);
});

test("a fact that names a subject is on its page; a page is found by search, and listed by words, kind and layer", async () => {
  const h = harness();
  seedFact(h, { id: "fct_a", layer: "space", text: "Harlow Dental pays by wire transfer.", kind: "note" });
  seedFact(h, { id: "fct_b", layer: "space", text: "The office closes at five.", kind: "note" });
  seedFact(h, { id: "fct_c", layer: "project", projectId: "prj_x", text: "Harlow Dental asked for a quote.", kind: "note" });
  await put(h, "Harlow Dental", "Retainer client. Prefers a Friday summary.", { kind: "client" });
  await put(h, "Pine Street Office", "Opens at nine.", { kind: "site" });
  const page = await pageGet(h.ctx, { title: "harlow dental" });
  assert.deepEqual(page.facts.map((f) => f.factId).sort(), ["fct_a", "fct_c"]);
  const hits = await search(h.ctx, { q: "Friday summary" });
  assert.equal(hits.hits[0]?.kind, "page");
  assert.equal(hits.hits[0]?.pageId, page.page.pageId);
  assert.deepEqual(contractErrors("memory.search", "out", hits), []);
  assert.deepEqual((await pageList(h.ctx, { kind: "site" })).pages.map((p) => p.title), ["Pine Street Office"]);
  assert.deepEqual((await pageList(h.ctx, { q: "friday" })).pages.map((p) => p.title), ["Harlow Dental"]);
  assert.equal((await pageList(h.ctx, {})).total, 2);
  await assert.rejects(() => pageGet(h.ctx, { title: "Nobody" }), (e) => codeOf(e) === "validation.not_found");
});

test("backlinks from chats, runs and records, shown only to a reader who can open the place", async () => {
  const messages = [
    { messageId: "msg_1", author: { kind: "person", id: "usr_dana" }, body: "Call [[Harlow Dental]] before Friday.\nNothing else." },
    { messageId: "msg_2", author: { kind: "agent", id: "agt_intake" }, body: "Done: reached [[Harlow Dental]]." },
  ];
  const h = harness({
    respond: {
      "threads.get": () => ({ thread: { title: "Intake Monday", createdAt: NOW - DAY, kind: "chat" } }),
      "chat.messages.list": () => ({ messages }),
      "records.get": () => ({ record: { id: "rec_1", type: "client", fields: { name: "Acme", notes: "Related to [[Harlow Dental]] since June." }, createdAt: NOW - 2 * DAY } }),
    },
  });
  const firm = await put(h, "Harlow Dental", "A dental practice.");
  assert.deepEqual(await indexGraph(h.ctx, { entity: "chat", id: "thr_a", seq: 1 }), { nodes: 1, edges: 2 });
  await indexGraph(h.ctx, { entity: "record:client", id: "rec_1", seq: 1 });
  const got = await backlinks(h.ctx, { pageId: firm.page.pageId });
  assert.deepEqual(contractErrors("memory.backlinks", "out", got), []);
  assert.deepEqual(got.backlinks.map((b) => [b.kind, b.title, b.quote]).sort(), [
    ["chat", "Intake Monday", "Call [[Harlow Dental]] before Friday."], ["record", "Acme", "Related to [[Harlow Dental]] since June."],
  ]);
  const omar = asPerson(h, { kind: "person", id: "usr_omar" }, { deny: ["thread:thr_a"] });
  assert.deepEqual((await backlinks(omar.ctx, { pageId: firm.page.pageId })).backlinks.map((b) => b.kind), ["record"], "a chat the reader cannot open is not a backlink for them");
  // a mention that came before its page resolves when the page is made
  await indexGraph(h.ctx, { entity: "chat", id: "thr_b", seq: 1 });
  assert.ok(h.rows("SELECT page_id FROM memory_mentions WHERE source_ref = 'thr_b'").every((r) => String(r["page_id"]) === firm.page.pageId));
  const later = harness({ respond: { "threads.get": () => ({ thread: { title: "T", createdAt: NOW } }), "chat.messages.list": () => ({ messages: [{ messageId: "m", author: { kind: "person", id: "usr_dana" }, body: "See [[New Subject]]." }] }) } });
  await indexGraph(later.ctx, { entity: "chat", id: "thr_c", seq: 1 });
  assert.equal(String(later.rows("SELECT page_id FROM memory_mentions")[0]!["page_id"]), "~new subject");
  const made = await put(later, "New Subject", "Now it exists.");
  assert.equal(String(later.rows("SELECT page_id FROM memory_mentions")[0]!["page_id"]), made.page.pageId);
});

test("the graph: typed nodes including chats and pages, labelled edges with evidence, layer and type filters, a local view and an as-of date", async () => {
  const h = harness({
    clock: { t: NOW },
    respond: {
      "threads.get": () => ({ thread: { title: "Intake Monday", createdAt: NOW - 5 * DAY, kind: "chat" } }),
      "chat.messages.list": () => ({ messages: [{ messageId: "msg_1", author: { kind: "person", id: "usr_dana" }, body: "Call [[Harlow Dental]] today." }] }),
    },
  });
  h.clock.t = NOW - 10 * DAY;
  const firm = await put(h, "Harlow Dental", "A practice.", { kind: "client" });
  const dr = await put(h, "Dr Harlow", "employer:: [[Harlow Dental]]", { kind: "person" });
  h.clock.t = NOW - 6 * DAY;
  await put(h, "Pine Street", "Office. site of:: [[Harlow Dental]]", { kind: "site" });
  await pagePut(h.ctx, { pageId: firm.page.pageId, notes: "A practice.\npartner:: [[Dr Harlow]]" });
  h.clock.t = NOW - 5 * DAY;
  await indexGraph(h.ctx, { entity: "chat", id: "thr_a", seq: 1 });
  h.clock.t = NOW - 2 * DAY;
  await pagePut(h.ctx, { pageId: firm.page.pageId, notes: "A practice." });   // the partner link is dropped later
  h.clock.t = NOW;
  const g = await graph(h.ctx, { scope: "space" });
  assert.deepEqual(contractErrors("memory.graph", "out", g), []);
  const kind = (id: string) => g.nodes.find((n) => n.nodeId === id)?.kind;
  assert.deepEqual([kind(`page:${firm.page.pageId}`), kind(`page:${dr.page.pageId}`), kind("chat:thr_a")], ["client", "person", "chat"]);
  const link = g.edges.find((e) => e.kind === "link" && e.from === `page:${dr.page.pageId}`)!;
  assert.deepEqual([link.to, link.label, link.evidence], [`page:${firm.page.pageId}`, "employer", "employer:: [[Harlow Dental]]"]);
  const mention = g.edges.find((e) => e.kind === "mention")!;
  assert.deepEqual([mention.from, mention.to, mention.evidence], ["chat:thr_a", `page:${firm.page.pageId}`, "Call [[Harlow Dental]] today."]);
  assert.equal(g.edges.some((e) => e.label === "partner"), false, "the dropped link is not in the graph now");
  // filters
  assert.deepEqual((await graph(h.ctx, { scope: "space", kinds: ["site", "client"] })).nodes.map((n) => n.kind).sort(), ["client", "site"]);
  assert.equal((await graph(h.ctx, { scope: "space", layers: ["project"] })).nodes.filter((n) => n.nodeId.startsWith("page:")).length, 0);
  // a local graph: the subject and one hop
  const local = await graph(h.ctx, { scope: "space", focus: `page:${dr.page.pageId}`, hops: 1 });
  assert.deepEqual(local.nodes.map((n) => n.nodeId).sort(), [`page:${dr.page.pageId}`, `page:${firm.page.pageId}`].sort());
  const two = await graph(h.ctx, { scope: "space", focus: `page:${dr.page.pageId}` });
  assert.equal(two.nodes.length >= 4, true, "two hops reach the chat and the other page");
  // what we knew on a date: 4 days ago the partner link existed, the chat was already there, the third page did too
  const then = await graph(h.ctx, { scope: "space", asOf: NOW - 4 * DAY });
  assert.equal(then.edges.some((e) => e.label === "partner"), true);
  assert.equal(then.edges.find((e) => e.label === "partner")!.evidence, "partner:: [[Dr Harlow]]");
  const earlier = await graph(h.ctx, { scope: "space", asOf: NOW - 9 * DAY });
  assert.deepEqual(earlier.nodes.filter((n) => n.nodeId.startsWith("page:")).length, 2, "Pine Street did not exist yet");
  assert.equal(earlier.edges.some((e) => e.label === "partner"), false);
  assert.equal(earlier.edges.some((e) => e.label === "employer"), true);
  // a reader who cannot see the Space layer sees no page
  const blind = asPerson(h, { kind: "person", id: "usr_omar" }, { deny: [`space:${h.ctx.space}`] });
  assert.equal((await graph(blind.ctx, { scope: "space" })).nodes.filter((n) => n.nodeId.startsWith("page:")).length, 0);
});

test("a personal page is sealed to its owner in every table, and never in the graph, a list, a backlink or the export", async () => {
  const h = harness({ principal: dana });
  const mine = await pagePut(h.ctx, { title: "My health notes", layer: "person", notes: "Blood pressure is fine.\nsees:: [[Dr Osei]]" });
  await pagePut(h.ctx, { title: "Dr Osei", layer: "person", notes: "Cardiologist." });
  await put(h, "Shared Topic", "Public notes.\nsee also:: [[My health notes]]");
  const personal = JSON.stringify([
    h.rows("SELECT * FROM memory_pages WHERE layer = 'person'"), h.rows("SELECT * FROM memory_page_versions WHERE page_id IN (SELECT page_id FROM memory_pages WHERE layer = 'person')"),
    h.rows("SELECT * FROM memory_page_links WHERE from_page IN (SELECT page_id FROM memory_pages WHERE layer = 'person')"), h.rows("SELECT * FROM memory_trail WHERE layer = 'person'"),
    h.rows("SELECT * FROM memory_graph_nodes WHERE layer = 'person'"), h.rows("SELECT * FROM memory_vectors"),
  ]);
  for (const word of ["Blood pressure", "Cardiologist", "sees::", "health notes", "My health", "Dr Osei", "osei"]) assert.ok(!personal.toLowerCase().includes(word.toLowerCase()), `no plain ${word} in any table`);
  assert.deepEqual(h.rows("SELECT notes, enc FROM memory_pages WHERE layer = 'person'").map((r) => [r["notes"], r["enc"]]), [["", 2], ["", 2]]);
  const links = h.rows("SELECT label, evidence, target, sealed FROM memory_page_links WHERE from_page = ?", mine.page.pageId);
  assert.deepEqual(links.map((l) => [l["label"], l["evidence"], l["target"], typeof l["sealed"]]), [["#0", "", "", "string"]]);
  const own = await pageGet(h.ctx, { pageId: mine.page.pageId });
  assert.equal(own.notes, "Blood pressure is fine.\nsees:: [[Dr Osei]]");
  assert.deepEqual(own.links.map((l) => [l.label, l.title, l.evidence]), [["sees", "Dr Osei", "sees:: [[Dr Osei]]"]]);

  const omar = asPerson(h, { kind: "person", id: "usr_omar" });
  await assert.rejects(() => pageGet(omar.ctx, { pageId: mine.page.pageId }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(() => pageGet(omar.ctx, { title: "My health notes" }), (e) => codeOf(e) === "validation.not_found");
  assert.deepEqual((await pageList(omar.ctx, {})).pages.map((p) => p.title), ["Shared Topic"]);
  assert.equal((await search(omar.ctx, { q: "Blood pressure" })).hits.length, 0);
  const g = await graph(omar.ctx, { scope: "space" });
  assert.ok(g.nodes.every((n) => !n.title.includes("health") && n.layer !== "person"));
  assert.ok(!JSON.stringify((await graph(h.ctx, { scope: "space" }))).includes("health"), "not even for the owner: a personal layer is never in the graph");
  const theirs = (await exportMarkdown(omar.ctx, { includePersonal: true })).markdown;
  assert.ok(!theirs.includes("Blood pressure") && !theirs.includes("Cardiologist") && !theirs.includes("### My health"), "another person's export never holds it (a shared page that names it in its own Notes is shared text)");
  const withoutAsk = (await exportMarkdown(h.ctx, {})).markdown;
  assert.ok(!withoutAsk.includes("Blood pressure"), "and the owner's own export leaves it out unless asked");
  const withAsk = (await exportMarkdown(h.ctx, { includePersonal: true })).markdown;
  assert.ok(withAsk.includes("Blood pressure is fine.") && withAsk.includes("[[Dr Osei]]"));
  // the shared page's link to a personal page leaves no edge to it
  assert.equal(h.rows("SELECT to_page FROM memory_page_links WHERE from_page IN (SELECT page_id FROM memory_pages WHERE layer = 'space')").every((r) => String(r["to_page"]).startsWith("~")), true);
});

test("the Markdown export holds pages with their facts, Notes and links, then the facts no page names; Trash and other people's personal text stay out", async () => {
  const h = harness();
  seedFact(h, { id: "fct_a", layer: "space", text: "Harlow Dental pays by wire transfer.", kind: "note" });
  seedFact(h, { id: "fct_b", layer: "space", text: "The office closes at five.", kind: "note" });
  seedFact(h, { id: "fct_gone", layer: "space", text: "A removed secret fact", kind: "note" });
  seedFact(h, { id: "fct_priv", layer: "person", owner: "usr_omar", text: "Omar private fact", kind: "note" });
  await put(h, "Harlow Dental", "Retainer client.\nowner:: [[Dr Harlow]]", { kind: "client" });
  const dead = await put(h, "Old Page", "Should not be exported.");
  await pageDelete(h.ctx, { pageId: dead.page.pageId });
  await factsRemove(h.ctx, { factIds: ["fct_gone"] });
  const out = await exportMarkdown(h.ctx, {});
  assert.deepEqual(contractErrors("memory.export_markdown", "out", out), []);
  assert.deepEqual([out.pages, out.facts], [1, 2]);
  const md = out.markdown;
  assert.match(md, /^# Memory export/);
  assert.ok(md.includes("### Harlow Dental") && md.includes("- Harlow Dental pays by wire transfer. (since") && md.includes("Retainer client.") && md.includes("owner: [[Dr Harlow]] (owner:: [[Dr Harlow]])"));
  assert.ok(md.includes("## Facts no page names") && md.includes("The office closes at five."));
  for (const word of ["Old Page", "Should not be exported", "removed secret", "Omar private"]) assert.ok(!md.includes(word), `not exported: ${word}`);
  assert.equal(out.bytes, Buffer.byteLength(md));
});

test("a page deleted goes to Trash and comes back; untouched it moves to Archive and an admin brings it back; an erase leaves a contentless line", async () => {
  const h = harness({ admin: true });
  const p = await put(h, "Secret Subject", "Clara Obermeyer pays by wire.\nrelated:: [[Other]]");
  const out = await pageDelete(h.ctx, { pageId: p.page.pageId });
  assert.equal(out.trashed, true);
  assert.equal((await pageList(h.ctx, {})).total, 0);
  await assert.rejects(() => pagePut(h.ctx, { pageId: p.page.pageId, notes: "x" }), (e) => codeOf(e) === "validation.precondition_failed");
  const found = await trashSearch(h.ctx, { q: "Obermeyer" });
  assert.deepEqual(found.pages?.map((x) => x.pageId), [p.page.pageId]);
  assert.deepEqual(contractErrors("memory.trash.search", "out", found), []);
  const back = await restore(h.ctx, { pageId: p.page.pageId });
  assert.deepEqual([back.restoredFrom, back.page?.trashedAt], ["trash", undefined]);
  assert.equal((await pageList(h.ctx, {})).total, 1);
  await pageDelete(h.ctx, { pageId: p.page.pageId });
  h.advance(61 * DAY);
  assert.equal((await archiveSweep(h.ctx)).archived, 1);
  assert.equal((await trashSearch(h.ctx, { q: "Obermeyer" })).pages?.length, 0);
  const archived = await trashSearch(h.ctx, { q: "Obermeyer", area: "archive" });
  assert.equal(archived.pages?.length, 1);
  await assert.rejects(() => restore(asPerson(h, { kind: "person", id: "usr_omar" }, { admin: false }).ctx, { pageId: p.page.pageId }), (e) => codeOf(e) === "permission.role_lacks_permission");
  assert.equal((await restore(h.ctx, { pageId: p.page.pageId })).restoredFrom, "archive");
  assert.deepEqual(h.rows("SELECT action FROM memory_trail WHERE page_id = ? ORDER BY rowid", p.page.pageId).map((r) => r["action"]), ["create", "delete", "restore", "delete", "archive", "restore"]);
  await erase(h.ctx, { pageIds: [p.page.pageId], reason: "asked by the person" });
  assert.equal(h.rows("SELECT page_id FROM memory_pages").length + h.rows("SELECT page_id FROM memory_page_versions").length + h.rows("SELECT from_page FROM memory_page_links").length, 0);
  const dump = JSON.stringify(h.rows("SELECT * FROM memory_trail"));
  assert.ok(!dump.includes("Obermeyer") && !dump.includes("Secret Subject"), "the trail holds no words");
  assert.equal(h.rows("SELECT action, reason FROM memory_trail WHERE action = 'erase' AND page_id = ?", p.page.pageId)[0]!["reason"], "asked by the person");
  assert.equal((await trailRead(h.ctx, { pageId: p.page.pageId })).rows.at(0)?.["action"], "erase");
});

test("a reader who may only view a page cannot change it, and a page in an agent or project layer follows that layer's access", async () => {
  const h = harness({ readOnly: [`space:spc_memorytest`] });
  await assert.rejects(() => put(h, "Nope", "x"), (e) => codeOf(e) === "permission.no_grant");
  const open = harness();
  const made = await put(open, "Team Handbook", "Rules.");
  const ro = asPerson(open, { kind: "person", id: "usr_omar" }, { readOnly: ["space:spc_memorytest"] });
  assert.equal((await pageGet(ro.ctx, { pageId: made.page.pageId })).notes, "Rules.");
  await assert.rejects(() => pagePut(ro.ctx, { pageId: made.page.pageId, notes: "defaced" }), (e) => codeOf(e) === "permission.no_grant");
  await assert.rejects(() => pageDelete(ro.ctx, { pageId: made.page.pageId }), (e) => codeOf(e) === "permission.no_grant");
  const proj = await pagePut(open.ctx, { title: "Harlow Plan", layer: "project", projectId: "prj_harlow", notes: "Steps." });
  const out = asPerson(open, { kind: "person", id: "usr_omar" }, { deny: ["folder:fld_harlow"] });
  await assert.rejects(() => pageGet(out.ctx, { pageId: proj.page.pageId }), (e) => codeOf(e) === "validation.not_found");
  assert.deepEqual((await pageList(out.ctx, {})).pages.map((p) => p.title), ["Team Handbook"]);
});
