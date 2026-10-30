// @reads ../../../../../../scripts/shots/mounts/P-L9e_05.tsx
// Files > Knowledge > Page (the living page): the markup in both states (an open question about two facts, and after it is answered), the pure helpers (the [[ autocomplete, the Notes pieces, who a fact
// credits, which layers a fact can be promoted to), and every write the page makes through the capability door over the Northwind sample: edit a fact, restore an earlier version, answer the question,
// save the Notes (and refuse a stale write), restore a Notes version, move the page to Trash and back, change who can see it, promote a fact and export. Each is re-read through the live query.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryDataProvider } from "../memory/data.tsx";
import { KnowPage, caretSpot, choiceText, completeLink, isStale, neighbours, notePieces, pageCrumbs, questionFor, radial, sharedStart, shownFacts, stepIndex, subtitleOf, visibleChoices } from "../memory/KnowPage.tsx";
import type { KPageRow } from "../memory/KnowPage.tsx";
import { promoteTargets, whoText } from "../memory/KnowFactLine.tsx";
import { createKnowSample, pageIdOf } from "../memory/sample-know.ts";
import type { KnowSample } from "../memory/sample-know.ts";
import { errorText, correctFact, putNotes, resolveQuestion, restoreFact, restoreNotesVersion, restorePage, trashPage, undoFact } from "../memory/actions.ts";
import { openLinkAt } from "../memory/know.ts";
import type { KFact } from "../memory/know.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { LiveCap } from "../memory/data.tsx";

const IAN = pageIdOf("ian");
const page = (s: KnowSample, id = IAN, hl?: string): string => renderToStaticMarkup(<MemoryDataProvider value={s.data}><KnowPage pageId={id} {...(hl ? { hl } : {})} /></MemoryDataProvider>).replaceAll("<!-- -->", "");
function read<C extends LiveCap>(s: KnowSample, cap: C, input: CapMap[C]["in"]): CapMap[C]["out"] {
  const snap = s.data.live(cap, input).getSnapshot();
  assert.equal(snap.status, "ready", cap);
  return (snap as { data: CapMap[C]["out"] }).data;
}
const get = (s: KnowSample, id = IAN): CapMap["memory.page.get"]["out"] => read(s, "memory.page.get", { pageId: id });
const factOf = (s: KnowSample, text: string, id = IAN): KFact => (get(s, id).facts as KFact[]).find((f) => f.text === text)!;
const has = (m: string, x: string): boolean => m.includes(x);

// ---------------------------------------------------------------- the markup

test("the page of Ian Brooks: breadcrumb, header, facts, the question card, Notes, mentions, the map and the footer", () => {
  const m = page(createKnowSample());
  for (const w of ["Knowledge", "Clients", "Ian Brooks", "Client at Brooks Logistics", "Space", "Visible to", "Everyone in Northwind", "Client contact at Brooks Logistics. Signed on Sep 3, Growth plan."]) assert.ok(has(m, w), w);
  assert.ok(has(m, "Facts") && has(m, "6 current"));
  assert.ok(has(m, "Which is right for “Send updates to”?"), "one question card");
  assert.ok(has(m, "ian@brooks-logistics.example") && has(m, "ops@brooks-logistics.example") && has(m, "Assistant in #brooks"));
  assert.ok(has(m, "Keep both") && has(m, "Neither"));
  assert.ok(has(m, "The two facts in question are held back until you pick one."));
  assert.ok(has(m, "Prefers updates on Fridays.") && has(m, "Brooks weekly update") && has(m, "2 versions"));
  assert.ok(!has(m, ">Send updates to ian@brooks-logistics.example.<"), "the two facts in question are not in the list");
  assert.ok(has(m, "Last edited by Assistant, Oct 22") && has(m, "Brooks onboarding") && has(m, "Edit"));
  assert.ok(has(m, "Mentioned in") && has(m, "chats, runs and records") && has(m, "Ian told me today he prefers updates on Fridays. Hold it until then."));
  assert.ok(has(m, "Related") && has(m, "one hop out") && has(m, "Open in Graph") && has(m, "Omar Haddad") && has(m, "Brooks Logistics"));
  assert.ok(has(m, "History") && has(m, "Trash · 1") && has(m, "6 facts · 4 mentions"));
  assert.ok(has(m, 'aria-label="More"'), "the ... button");
});

test("after the question is answered the card and the held-back line are gone and all six facts show", async () => {
  const s = createKnowSample();
  const q = read(s, "memory.questions.list", { status: "open" }).questions[0]!;
  await resolveQuestion(s.data, q.questionId, "keep_b");
  const m = page(s);
  assert.ok(!has(m, "Which is right for"));
  assert.ok(!has(m, "held back"));
  assert.ok(has(m, "Send updates to ops@brooks-logistics.example."));
  assert.ok(!has(m, "Send updates to ian@brooks-logistics.example."), "the loser is in Trash");
  assert.ok(has(m, "Trash · 2"));
});

test("a fact with versions has an underlined age, a source chip and who wrote it; keyboard: every control is a button that can take focus", () => {
  const m = page(createKnowSample());
  assert.ok(has(m, "19 days ago") && has(m, "Billing") && has(m, "Intake"));
  assert.ok(has(m, 'aria-label="Edit this fact: Prefers updates on Fridays."'), "the words are a button");
  assert.ok(/aria-label="History of this fact, 19 days ago, 2 versions"/.test(m), "the age opens the history");
  assert.ok(has(m, 'aria-label="Open the source: Brooks weekly update"'));
  assert.ok(has(m, 'aria-label="Keep this one: Send updates to ian@brooks-logistics.example."'));
  assert.ok(has(m, 'data-testid="notes-edit"') && has(m, 'data-testid="page-visible"') && has(m, 'data-testid="page-history"') && has(m, 'data-testid="page-trash"'));
  assert.ok(has(m, 'aria-label="Open the page Brooks onboarding"') && has(m, 'tabindex="0"'), "a [[link]] in the Notes is a focusable link");
});

test("the fact the page opened for (hl) flashes", () => {
  const s = createKnowSample();
  const f = factOf(s, "Prefers updates on Fridays.");
  assert.notEqual(page(s, IAN, f.factId), page(s), "the fact's row carries the highlight style");
  assert.equal(page(s, IAN, "fct_nothing"), page(s), "an id that is not on the page changes nothing");
});

test("a page with no facts or Notes says so, a page of another kind has its own crumb and subtitle", () => {
  const s = createKnowSample();
  const m = page(s, pageIdOf("cadence"));
  assert.ok(has(m, "Topics") && has(m, "Client update cadence") && has(m, "Topic"));
  assert.ok(has(m, "Maya set this rule in #intake."));
  const a = page(s, pageIdOf("ag-assistant"));
  assert.ok(has(a, "Agents") && has(a, "Agent"), "an agent's page");
});

test("a page that does not exist is gone, with no Restore; a page in Trash is gone with Restore", async () => {
  const s = createKnowSample();
  const m = page(s, "pg_nope");
  assert.ok(has(m, "This page is gone") && !has(m, 'data-testid="page-restore"'));
  await trashPage(s.data, IAN);
  const t = page(s);
  assert.ok(has(t, "This page is gone") && has(t, "It is in Trash") && has(t, 'data-testid="page-restore"'));
  await restorePage(s.data, IAN);
  assert.ok(has(page(s), "Client at Brooks Logistics"));
});

test("the loading frame draws no content", () => {
  const s = createKnowSample();
  const loading = { ...s.data, live: () => ({ subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" as const }) }) } as typeof s.data;
  const m = renderToStaticMarkup(<MemoryDataProvider value={loading}><KnowPage pageId={IAN} /></MemoryDataProvider>);
  assert.ok(has(m, "Loading") && !has(m, "Facts"));
});

// ---------------------------------------------------------------- the pure helpers

test("the [[ autocomplete: what is typed after [[ is the query, a picked title closes the link and the caret lands after it", () => {
  assert.deepEqual(openLinkAt("See [[Bro", 9), { start: 4, query: "Bro" });
  assert.equal(openLinkAt("See [[Brooks]] and", 18), null);
  assert.equal(openLinkAt("no link", 3), null);
  assert.equal(openLinkAt("[[a\nb", 5), null);
  assert.deepEqual(completeLink("See [[Bro and more", 9, "Brooks onboarding"), { text: "See [[Brooks onboarding]] and more", caret: 25 });
  assert.deepEqual(completeLink("See [[Bro]] x", 9, "Brooks onboarding"), { text: "See [[Brooks onboarding]] x", caret: 25 });
  assert.equal(completeLink("plain", 3, "X"), null);
  assert.equal(stepIndex(0, 3, "ArrowDown"), 1);
  assert.equal(stepIndex(2, 3, "ArrowDown"), 0);
  assert.equal(stepIndex(0, 3, "ArrowUp"), 2);
  assert.equal(stepIndex(0, 0, "ArrowUp"), 0);
  assert.ok(caretSpot("a\nb\nc", 5).top > caretSpot("a", 1).top, "a later line sits lower");
});

test("Notes pieces: [[links]] with a page are links, a link to a title with no page is dead", async () => {
  const p = notePieces("Hi [[Maya]] and [[Nobody]].", [{ label: "links to", title: "Maya", pageId: "pg_maya", evidence: "" }, { label: "links to", title: "Nobody", evidence: "" }]);
  assert.deepEqual(p, [{ text: "Hi " }, { text: "Maya", link: true, pageId: "pg_maya" }, { text: " and " }, { text: "Nobody", link: true }, { text: "." }]);
  assert.deepEqual(notePieces("plain", []), [{ text: "plain" }]);
  const s = createKnowSample();
  await putNotes(s.data, IAN, "Ask [[Nobody Here]] and [[Maya Chen]].", 1);
  const m = page(s);
  assert.ok(has(m, "Nobody Here. No page yet. It is created when you press Done."), "a dead link says why");
  assert.ok(has(m, 'aria-label="Open the page Maya Chen"') && !has(m, "Open the page Nobody Here"));
});

test("who a fact credits, the words under a name, the Visible to choices, the crumbs", () => {
  const f = { by: "usr_irfad", byKind: "person" } as KFact;
  assert.equal(whoText(f, { id: "usr_irfad" }, () => "x"), "you");
  assert.equal(whoText({ by: "agt_billing", byKind: "agent" } as KFact, { id: "usr_irfad" }, (id) => (id === "agt_billing" ? "Billing" : id)), "Billing");
  assert.equal(whoText({ byKind: "upkeep" } as KFact, undefined, () => "x"), "Upkeep");
  assert.equal(whoText({} as KFact, undefined, () => "x"), "");
  const pg = { layer: "space", kind: "client", visibleTo: "Everyone in Northwind" } as KPageRow;
  assert.deepEqual(visibleChoices(pg).map((c) => [c.text, c.checked]), [["Everyone in Northwind", true], ["People on this project", false], ["Only you", false], ["This agent and admins", false]]);
  assert.equal(subtitleOf(pg), "Client");
  assert.deepEqual(pageCrumbs("client", "Ian").map((c) => c.t), ["Knowledge", "Clients", "Ian"]);
  assert.deepEqual(pageCrumbs("client", "Ian")[1]!.route, { v: "list", kind: "client" });
  assert.equal(pageCrumbs("agent", "Intake")[1]!.route, undefined, "agents have no list");
});

test("the question: its two facts are held back, a choice shows only what differs", () => {
  const s = createKnowSample();
  const qs = read(s, "memory.questions.list", { status: "open" }).questions;
  const facts = get(s).facts as KFact[];
  const q = questionFor(qs, new Set(facts.map((f) => f.factId)))!;
  assert.ok(q && q.facts.length === 2);
  assert.equal(questionFor(qs, new Set(["nothing"])), undefined);
  assert.equal(shownFacts(facts, q).length, facts.length - 2);
  assert.equal(shownFacts(facts, undefined).length, facts.length);
  assert.equal(sharedStart("Send updates to a.", "Send updates to b."), "Send updates to ");
  assert.equal(sharedStart("a b", "c d"), "");
  assert.equal(choiceText("Send updates to a@x.", "Send updates to b@x."), "a@x");
  assert.equal(choiceText("Same", "Same"), "Same");
});

test("promotion offers only the layers wider than the fact's, and only the ones that can be named", () => {
  assert.deepEqual(promoteTargets({ layer: "person" }, { layer: "space" }), [{ toLayer: "space" }]);
  assert.deepEqual(promoteTargets({ layer: "person" }, { layer: "agent", agentId: "agt_x" }).map((t) => t.toLayer), ["agent", "space"]);
  assert.deepEqual(promoteTargets({ layer: "agent", agentId: "agt_x" }, { layer: "project", ownerRef: "prj_a" }), [{ toLayer: "project", projectId: "prj_a" }, { toLayer: "space" }]);
  assert.deepEqual(promoteTargets({ layer: "space" }, { layer: "space" }), []);
});

test("the map: neighbours come from the one-hop graph, the first sits at the top", () => {
  const s = createKnowSample();
  const g = read(s, "memory.graph", { scope: "space", focus: IAN, hops: 1 });
  const out = get(s);
  const near = neighbours(IAN, g, out.links, out.backlinks);
  assert.ok(near.length >= 5 && near.every((n) => n.id !== IAN));
  assert.ok(near.some((n) => n.title === "Omar Haddad" && n.pageId === pageIdOf("omar")));
  assert.ok(near.some((n) => n.kind === "chat" && n.link), "a chat opens as a chat");
  assert.ok(neighbours(IAN, null, out.links, out.backlinks).length > 0, "falls back to links and mentions");
  const r = radial(4);
  assert.equal(Math.round(r[0]!.x), 350);
  assert.ok(r[0]!.y < 115);
  assert.equal(isStale(new Error("validation.precondition_failed")), true);
  assert.equal(isStale(new Error("other")), false);
});

// ---------------------------------------------------------------- the writes

test("edit a fact: the new wording is current with one more version, and the old one is in its history", async () => {
  const s = createKnowSample();
  const f = factOf(s, "Prefers updates on Fridays.");
  assert.equal(f.versions, 1);
  await correctFact(s.data, f.factId, "Prefers updates on Thursdays.");
  const now = factOf(s, "Prefers updates on Thursdays.");
  assert.equal(now.versions, 2);
  assert.ok(!(get(s).facts as KFact[]).some((x) => x.text === "Prefers updates on Fridays."));
  const hist = read(s, "memory.fact.get", { factId: now.factId }).history;
  assert.ok(hist.some((h) => h.text === "Prefers updates on Fridays."));
  assert.ok(has(page(s), "Prefers updates on Thursdays.") && has(page(s), "2 versions"));
  assert.ok(read(s, "memory.trail", { factId: now.factId }).rows.some((r) => r.action === "edit"));
});

test("the history popover lists the earlier wordings, and Restore this version writes the old text back as a new version", async () => {
  const s = createKnowSample();
  const f = factOf(s, "Brooks Logistics is on the Growth plan, $2,400 a month, since Sep 3.");
  assert.equal(f.versions, 2);
  const h = read(s, "memory.fact.get", { factId: f.factId }).history;
  assert.equal(h.length, 1);
  const old = h[0]!;
  assert.notEqual(old.text, f.text);
  await correctFact(s.data, f.factId, old.text);
  const back = factOf(s, old.text);
  assert.equal(back.versions, 3);
  assert.equal(read(s, "memory.fact.get", { factId: back.factId }).history.length, 2);
});

test("a fact moves to Trash with Undo and comes back with Restore (the Flash's Undo)", async () => {
  const s = createKnowSample();
  const f = factOf(s, "Prefers updates on Fridays.");
  await undoFact(s.data, f.factId);
  assert.ok(!(get(s).facts as KFact[]).some((x) => x.factId === f.factId));
  assert.ok(has(page(s), "5 current") || has(page(s), "Trash · 2"));
  await restoreFact(s.data, f.factId);
  assert.ok((get(s).facts as KFact[]).some((x) => x.factId === f.factId));
});

test("answering the question: keep_a keeps the first and sends the second to Trash; Undo restores it; keep_both and drop close it", async () => {
  const s = createKnowSample();
  const q = read(s, "memory.questions.list", { status: "open" }).questions[0]!;
  await resolveQuestion(s.data, q.questionId, "keep_a");
  assert.equal(read(s, "memory.questions.list", { status: "open" }).questions.length, 0);
  const inTrash = (): string[] => read(s, "memory.trash.search", { area: "trash" }).facts.map((f) => f.factId);
  assert.ok(inTrash().includes(q.facts[1]!.factId) && !inTrash().includes(q.facts[0]!.factId));
  await restoreFact(s.data, q.facts[1]!.factId);
  assert.ok(!inTrash().includes(q.facts[1]!.factId));
  const b = createKnowSample();
  const qb = read(b, "memory.questions.list", { status: "open" }).questions[0]!;
  await resolveQuestion(b.data, qb.questionId, "keep_both");
  assert.equal(read(b, "memory.trash.search", { area: "trash" }).facts.length, 4, "nothing moved");
  const d = createKnowSample();
  const qd = read(d, "memory.questions.list", { status: "open" }).questions[0]!;
  await resolveQuestion(d.data, qd.questionId, "drop");
  assert.equal(read(d, "memory.trash.search", { area: "trash" }).facts.length, 6, "neither kept: both in Trash");
});

test("Notes: Done saves with the version that was read and the page shows the new text; a stale write is refused", async () => {
  const s = createKnowSample();
  const out = get(s);
  assert.equal(out.versions, 1);
  await putNotes(s.data, IAN, `${out.notes} Also see [[Maya Chen]].`, out.versions);
  assert.equal(get(s).versions, 2);
  assert.ok(has(page(s), "Also see") && has(page(s), "Maya Chen"));
  await assert.rejects(() => putNotes(s.data, IAN, "someone else's old copy", out.versions), (e: unknown) => isStale(e));
  assert.equal(get(s).notes.includes("old copy"), false, "the stale write changed nothing");
  assert.ok(get(s).links.some((l) => l.title === "Maya Chen" && l.pageId === pageIdOf("maya")), "the link feeds the graph");
});

test("Notes history lists the versions, and Restore this version writes an old one back as a new version", async () => {
  const s = createKnowSample();
  const first = get(s).notes;
  await putNotes(s.data, IAN, "A new draft.", 1);
  const vers = read(s, "memory.page.versions", { pageId: IAN }).versions;
  assert.deepEqual(vers.map((v) => v.version), [2, 1]);
  await restoreNotesVersion(s.data, IAN, 1);
  assert.equal(get(s).notes, first);
  assert.equal(get(s).versions, 3);
});

test("Move page to Trash: the page is gone with Restore, Undo (restore) brings it back whole", async () => {
  const s = createKnowSample();
  await trashPage(s.data, IAN);
  assert.ok(get(s).page.trashedAt !== undefined);
  assert.ok(read(s, "memory.trash.search", { area: "trash" }).pages.some((p) => p.pageId === IAN));
  await restorePage(s.data, IAN);
  assert.equal(get(s).page.trashedAt, undefined);
  assert.equal(get(s).facts.length, 6);
});

test("Visible to: a choice calls memory.page.set_visibility and the page says so; a refusal comes back as an error to show", async () => {
  const s = createKnowSample();
  await s.data.call("memory.page.set_visibility", { pageId: IAN, layer: "person" });
  const m = page(s);
  assert.ok(has(m, "Visible to") && has(m, "Only you") && has(m, "Private to you"));
  assert.ok(s.calls.some((c) => c.cap === "memory.page.set_visibility"));
  const bad = createKnowSample({ fail: "permission.role_lacks_permission" });
  await assert.rejects(() => bad.data.call("memory.page.set_visibility", { pageId: IAN, layer: "person" }), /role_lacks_permission/);
  assert.equal(errorText(new Error("permission.role_lacks_permission"), "Could not change who can see this page"), "Could not change who can see this page: permission.role_lacks_permission");
});

test("promote a fact to a wider layer, and export the Markdown", async () => {
  const s = createKnowSample();
  const elena = pageIdOf("elena");
  const f = (get(s, elena).facts as KFact[]).find((x) => x.layer !== "space")!;
  assert.ok(f, "the page has a fact below Space");
  assert.deepEqual(promoteTargets(f, { layer: "project", ownerRef: "prj_elena" }).map((t) => t.toLayer), f.layer === "project" ? ["space"] : ["project", "space"]);
  const out = (await s.data.call("memory.promote", { factId: f.factId, toLayer: "space" })) as { promoted: boolean };
  assert.equal(out.promoted, true);
  assert.equal((get(s, elena).facts as KFact[]).find((x) => x.factId === f.factId)!.layer, "space");
  const md = (await s.data.call("memory.export_markdown", {})) as { markdown: string; pages: number; facts: number };
  assert.ok(md.markdown.includes("# Ian Brooks") && md.pages > 5 && md.facts > 10);
});

test("a call that fails shows its text: the sample's refusal reaches the screen's error line", async () => {
  const s = createKnowSample({ fail: "permission.role_lacks_permission" });
  await assert.rejects(() => correctFact(s.data, "x", "y"), /role_lacks_permission/);
  await assert.rejects(() => trashPage(s.data, IAN), /role_lacks_permission/);
});
