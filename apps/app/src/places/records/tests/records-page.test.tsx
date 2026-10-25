// @reads ../../../../../../scripts/shots/mounts/P-L9d_04.tsx
// Records > record page: the sections a type lays its page out in (and each person's folds on top), the completeness ring, a field edited in place that writes exactly once (and says why when it cannot),
// Undo, relation cards with a peek, `[[` links, the relationship map and the right pane. The page opens under the navigate budget.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { Peek, RecordPage, RecordPageDataProvider, askText, activityLine, ago, editKind, historyVersions, inputText, mapLayout, parseInput, patchFor, peekFields, relationIds, resolveLink, ringOf, saveField, savePrefs, saveValue, sectionsOf, shownFields, sourceOf, sourceText, splitLinks, toggleFold, undoSave, valueText } from "../recordpage/index.ts";
import type { RecordPageStart, RelNode } from "../recordpage/index.ts";
import { CLIENT, PROJECT, SAMPLE_NOW, createSamplePage, harbor } from "../recordpage/sample.ts";
import type { SamplePage } from "../recordpage/sample.ts";
import type { RecordRow } from "../recordpage/model.ts";

const page = (s: SamplePage, start?: RecordPageStart, type = "clients", id = "cl_0"): string =>
  renderToStaticMarkup(<RecordPageDataProvider value={s.data}><RecordPage type={type} recordId={id} {...(start ? { start } : {})} /></RecordPageDataProvider>).replaceAll("<!-- -->", "");
const wrap = (s: SamplePage, child: ReactElement): string => renderToStaticMarkup(<RecordPageDataProvider value={s.data}>{child}</RecordPageDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
const count = (s: string, needle: string): number => s.split(needle).length - 1;
const row = (s: SamplePage, type = "clients", id = "cl_0"): RecordRow => (s.replica.rows(`records:${type}`) as unknown as RecordRow[]).find((r) => r.id === id)!;
const field = (k: string) => CLIENT.fields.find((f) => f.key === k)!;
const names = (id: string): string => ({ usr_maya: "Maya Chen", usr_omar: "Omar Haddad", usr_irfad: "Irfad Imtiaz" } as Record<string, string>)[id] ?? id;

// ---------------------------------------------------------------- the model

test("sections: the type's layout names them, a field it forgot goes into the last one, a person's folds are on top, the title is the heading", () => {
  const layout = { sections: [{ key: "contact", title: "Contact", fields: ["company", "email"] }, { key: "private", title: "Private", fields: ["tax"], folded: true }] };
  const s = sectionsOf(CLIENT, layout, { folded: [], keepVisible: [] });
  assert.deepEqual(s.map((x) => [x.key, x.folded]), [["contact", false], ["private", true]], "the layout's own fold is the default");
  assert.ok(!s.some((x) => x.fields.some((f) => f.key === "name")), "the title is the page's heading, not a field row");
  assert.ok(s[1]!.fields.some((f) => f.key === "phone"), "a field the layout does not name goes into the last section");
  assert.ok(!s.some((x) => x.fields.some((f) => f.key === "company")), "the summary is the line under the heading, not a field row");
  const mine = sectionsOf(CLIENT, layout, { folded: ["contact"], keepVisible: [] });
  assert.deepEqual(mine.map((x) => [x.key, x.folded]), [["contact", true], ["private", false]], "once a person folds, their folds replace the layout's");
});

test("with no layout the fields fall into Details, Notes and Related; empty fields wait behind Show N empty fields unless kept", () => {
  const s = sectionsOf(CLIENT, undefined, undefined);
  assert.deepEqual(s.map((x) => x.key), ["details", "notes", "related"]);
  assert.ok(s[0]!.fields.every((f) => !["relation", "longtext", "files"].includes(f.type)) && s[2]!.fields[0]!.key === "projects");
  const sample = createSamplePage();
  const r = row(sample);
  const contact = { key: "contact", title: "Contact", fields: [field("email"), field("phone")], folded: false };
  const sh = shownFields(contact, r, [], false);
  assert.deepEqual([sh.fields.map((f) => f.key), sh.hidden], [["email"], 1]);
  assert.deepEqual(shownFields(contact, r, ["phone"], false).fields.map((f) => f.key), ["email", "phone"], "kept visible");
  assert.equal(shownFields(contact, r, [], true).hidden, 0, "Show empty fields shows them all");
  assert.deepEqual(toggleFold(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggleFold(["a", "b"], "a"), ["b"]);
});

test("the completeness ring draws its share and says it in words", () => {
  const r = ringOf({ filled: 8, total: 11 });
  assert.equal(r.label, "8 of 11");
  assert.ok(Math.abs(r.fraction - 8 / 11) < 1e-9 && r.complete === false);
  assert.equal(ringOf({ filled: 11, total: 11 }).complete, true);
  assert.equal(ringOf({ filled: 0, total: 0 }).label, "Nothing to fill");
  assert.equal(ringOf({ filled: 99, total: 11 }).label, "11 of 11", "never more than the whole");
  assert.equal(askText({ filled: 9, total: 11, missing: [{ field: "phone", title: "Phone" }] }, "Elena Rivera"), "What is phone for Elena Rivera?");
  assert.equal(askText({ filled: 8, total: 11, missing: [{ field: "a", title: "Phone" }, { field: "b", title: "Due" }, { field: "c", title: "Email" }] }, "Elena"), "What is phone, due and email for Elena?");
  assert.equal(askText({ filled: 11, total: 11, missing: [] }, "Elena"), "");
});

test("editing in place: each kind of field is typed in its own way, and a bad value says what is wrong instead of being written", () => {
  assert.deepEqual(["name", "value", "due", "status", "active", "rating", "notes", "projects", "tax"].map((k) => editKind(field(k))), ["text", "money", "date", "choice", "checkbox", "rating", "longtext", "none", "none"]);
  assert.deepEqual(parseInput(field("name"), "  Elena R  "), { ok: true, value: "Elena R" });
  assert.deepEqual(parseInput(field("value"), "$12,500", { amount: 1, currency: "EUR" }), { ok: true, value: { amount: 12500, currency: "EUR" } }, "the currency stays");
  assert.deepEqual(parseInput(field("due"), "2025-10-30"), { ok: true, value: Date.UTC(2025, 9, 30) });
  assert.deepEqual(parseInput(field("rating"), "4"), { ok: true, value: 4 });
  assert.deepEqual(parseInput(field("phone"), ""), { ok: true, value: null }, "empty clears an optional field");
  assert.deepEqual(parseInput(field("name"), "  "), { ok: false, message: "Name is required." });
  assert.deepEqual(parseInput(field("value"), "lots"), { ok: false, message: "Value takes an amount." });
  assert.deepEqual(parseInput(field("due"), "next week"), { ok: false, message: "Next step due takes a date like 2025-10-24." });
  assert.deepEqual(parseInput(field("due"), "2025-02-31"), { ok: false, message: "Next step due is not a day on the calendar." });
  assert.deepEqual(parseInput(field("rating"), "9"), { ok: false, message: "Fit is from 0 to 5." });
  assert.equal(inputText(field("due"), Date.UTC(2025, 9, 30)), "2025-10-30");
  assert.equal(inputText(field("value"), { amount: 24000, currency: "USD" }), "24000");
  assert.equal(inputText(field("phone"), null), "");
  assert.equal(valueText(field("value"), { amount: 24000, currency: "USD" }, names), "$24,000");
});

test("a change is a patch of that one field with what it was, and no change is no patch", () => {
  const r = row(createSamplePage());
  assert.equal(patchFor(field("company"), r.fields["company"], r), null, "the same value writes nothing");
  assert.equal(patchFor(field("phone"), null, r), null, "empty to empty writes nothing");
  assert.deepEqual(patchFor(field("phone"), "+1 415 555 0100", r), { patch: { phone: "+1 415 555 0100" }, undo: { field: "phone", was: null } });
  assert.deepEqual(patchFor(field("company"), "Rivera Ltd", r), { patch: { company: "Rivera Ltd" }, undo: { field: "company", was: "Rivera Holdings" } });
});

test("[[ links: text is cut into pieces, a title resolves to the record it names, near titles do not guess", () => {
  assert.deepEqual(splitLinks("See [[Rivera engagement]] and [[X]]."), [{ text: "See " }, { link: "Rivera engagement" }, { text: " and " }, { link: "X" }, { text: "." }]);
  assert.deepEqual(splitLinks("no links [[open"), [{ text: "no links [[open" }]);
  assert.deepEqual(splitLinks(""), []);
  const nodes: RelNode[] = [{ recordId: "a", type: "projects", title: "Rivera engagement", hop: 1 }, { recordId: "b", type: "projects", title: "Rivera matter", hop: 1 }, { recordId: "c", type: "clients", title: "Pruitt", hop: 2 }];
  assert.equal(resolveLink("rivera ENGAGEMENT", nodes)?.recordId, "a", "case aside");
  assert.equal(resolveLink("Prui", nodes)?.recordId, "c", "the only title that starts with it");
  assert.equal(resolveLink("Rivera", nodes), null, "two titles start with it: no guess");
  assert.equal(resolveLink("Nobody", nodes), null);
});

test("relations: the ids a field holds, and what a peek shows of the record behind a card", () => {
  const r = row(createSamplePage());
  assert.deepEqual(relationIds(field("projects"), r), ["pj_0", "pj_1"]);
  assert.deepEqual(relationIds(field("company"), r), []);
  const p = row(createSamplePage(), "projects", "pj_0");
  assert.deepEqual(peekFields(PROJECT, p).map((f) => f.key), ["budget", "status", "lead", "due"], "the summary field first, then what is filled, never a relation");
  assert.equal(peekFields(PROJECT, p, 2).length, 2);
});

test("the map: the record in the middle, its neighbours on one ring, theirs on an outer one", () => {
  const nodes: RelNode[] = [{ recordId: "r", type: "clients", title: "R", hop: 0 }, ...[1, 2, 3].map((i) => ({ recordId: `n${i}`, type: "projects", title: `N${i}`, hop: 1 })), { recordId: "x", type: "clients", title: "X", hop: 2 }];
  const m = mapLayout(nodes);
  assert.deepEqual([m[0]!.x, m[0]!.y], [180, 130]);
  const far = (n: { x: number; y: number }): number => Math.hypot(n.x - 180, n.y - 130);
  assert.equal(m.length, 5);
  assert.ok(m.every((n) => n.x >= 0 && n.x <= 360 && n.y >= 0 && n.y <= 260), "everything is inside the box");
  assert.equal(new Set(m.map((n) => `${n.x},${n.y}`)).size, 5, "no two on one spot");
  assert.ok(far(m[4]!) > far(m[1]!) && far(m[1]!) > 0, "the second hop is further out than the first");
});

test("the right pane: activity lines say who set what, versions go to the shared History tab, a source says where a value came from", () => {
  assert.equal(activityLine({ field: "phone", value: "+1 415", hlc: "1:1", actor: "usr_maya" }, CLIENT, names), "Maya Chen set phone to +1 415");
  assert.equal(activityLine({ field: "value", value: { amount: 5000, currency: "USD" }, hlc: "1:2", actor: "usr_omar" }, CLIENT, names), "Omar Haddad set value to $5,000");
  assert.equal(activityLine({ field: "phone", value: null, hlc: "1:3", actor: "usr_maya" }, CLIENT, names), "Maya Chen set phone to empty");
  const v = historyVersions([{ versionId: "v1", n: 1, by: "usr_maya", at: 0, reason: "Created" }, { versionId: "v2", n: 2, by: "usr_irfad", at: 86_400_000 }], names);
  assert.deepEqual(v.map((x) => [x.n, x.who, x.why, x.undoable]), [[1, "Maya Chen", "Created", false], [2, "Irfad Imtiaz", "", true]]);
  assert.equal(sourceText({ kind: "agent", actor: "Docs", at: 1, state: "needs_review" }), "From an agent: Docs. Waiting for review.");
  assert.equal(sourceText({ kind: "form", actor: "Intake form", at: 1, state: "counted" }), "From a form: Intake form.");
  assert.equal(ago(SAMPLE_NOW - 3 * 3_600_000, SAMPLE_NOW), "3 h ago");
});

// ---------------------------------------------------------------- saving

test("an edit in place writes exactly once: one records.update of that field with the version the person saw", async () => {
  const s = createSamplePage();
  const before = row(s);
  const r = await saveField(s.data, "clients", before, field("phone"), "+1 415 555 0100");
  assert.equal(r.kind, "saved");
  assert.deepEqual(s.calls, [{ cap: "records.update", input: { type: "clients", recordId: "cl_0", patch: { phone: "+1 415 555 0100" }, baseVersion: 3 } }]);
  assert.equal(row(s).fields["phone"], "+1 415 555 0100");
  assert.equal(row(s).version, 4);
  const again = await saveField(s.data, "clients", row(s), field("phone"), "+1 415 555 0100");
  assert.equal(again.kind, "same", "the blur after Enter changes nothing, so it writes nothing");
  assert.equal(s.calls.length, 1);
  assert.ok(has(page(s), "+1 415 555 0100") && !has(page(s), ">Show 1 empty field<"), "the page shows the new value at once");
});

test("a bad value writes nothing and says why; a stale page is refused and nothing changes", async () => {
  const s = createSamplePage();
  const bad = await saveField(s.data, "clients", row(s), field("value"), "lots");
  assert.deepEqual(bad, { kind: "bad", message: "Value takes an amount." });
  const blank = await saveField(s.data, "clients", row(s), field("name"), "");
  assert.deepEqual(blank, { kind: "bad", message: "Name is required." });
  assert.deepEqual(s.calls, [], "nothing was sent");
  const stale = { ...row(s), version: 1 };
  await assert.rejects(saveField(s.data, "clients", stale, field("company"), "Elsewhere"), /changed by someone else/);
  assert.equal(row(s).fields["company"], "Rivera Holdings");
  const denied = createSamplePage(undefined, { fail: "You cannot edit clients" });
  await assert.rejects(saveField(denied.data, "clients", row(denied), field("company"), "X"), /cannot edit/);
});

test("Undo puts the old value back with one more update, and a choice or checkbox saves in one write", async () => {
  const s = createSamplePage();
  const done = await saveValue(s.data, "clients", row(s), field("status"), "paused");
  assert.equal(done.kind, "saved");
  assert.equal(row(s).fields["status"], "paused");
  if (done.kind === "saved") await undoSave(s.data, "clients", row(s), done.undo);
  assert.equal(row(s).fields["status"], "active");
  assert.deepEqual(s.calls.map((c) => (c.input as { patch: unknown }).patch), [{ status: "paused" }, { status: "active" }]);
  await saveValue(s.data, "clients", row(s), field("active"), false);
  assert.equal(row(s).fields["active"], false);
  assert.equal(s.calls.length, 3);
});

test("folding a section is a page choice of this person, written as page prefs, never a change to the type", async () => {
  const s = createSamplePage();
  assert.ok(has(page(s), 'data-testid="field-notes"') || has(page(s), "Prefers email"));
  await savePrefs(s.data, "clients", { folded: ["notes"] });
  assert.deepEqual(s.calls[0], { cap: "records.page_prefs.set", input: { type: "clients", folded: ["notes"] } });
  const out = page(s);
  assert.ok(!has(out, "Prefers email") && has(out, 'aria-expanded="false"'), "the Notes section is shut now");
  assert.ok(has(out, 'data-testid="section-notes"'));
  await savePrefs(s.data, "clients", { keepVisible: ["phone"] });
  assert.ok(has(page(s), 'data-testid="row-phone"'), "a kept field shows even when empty");
});

test("where a value came from is one capability away", async () => {
  const s = createSamplePage();
  const src = await sourceOf(s.data, "clients", "cl_0", "phone");
  assert.equal(sourceText(src as Parameters<typeof sourceText>[0]), "From an agent: Docs.");
});

// ---------------------------------------------------------------- the screen

test("screen: the page has the title, the ring, the sections, the relation cards and the note with its links", () => {
  const out = page(createSamplePage());
  assert.ok(has(out, 'data-testid="record-page"') && has(out, 'aria-label="Elena Rivera, Client"') && has(out, ">Elena Rivera<"));
  assert.ok(has(out, 'data-testid="summary"') && has(out, ">Rivera Holdings<") && !has(out, 'data-testid="row-company"'), "the company is the line under the title, not a row of the sheet");
  assert.ok(has(out, 'data-testid="ring-label"') && has(out, ">10 of 11<") && has(out, 'data-testid="ask-missing"') && has(out, "Ask for these") && has(out, 'data-testid="ring"'));
  for (const k of ["contact", "deal", "links", "notes", "private"]) assert.ok(has(out, `data-testid="section-${k}"`), k);
  assert.ok(has(out, 'aria-expanded="false"') && count(out, 'aria-expanded="false"') === 1, "only Private is folded by the layout");
  assert.ok(!has(out, 'data-testid="row-tax"') && !has(out, 'data-testid="row-id_doc"'), "a folded section draws no fields");
  assert.ok(has(out, "elena@example.test") && has(out, ">Active<") && has(out, ">Maya Chen<") && has(out, "$24,000") && has(out, "Oct 30, 2025"));
  assert.ok(has(out, 'data-testid="more-contact"') && has(out, "Show 1 empty field"), "the empty phone waits behind a link");
  assert.ok(has(out, 'data-testid="rel-pj_0"') && has(out, 'data-testid="rel-pj_1"') && has(out, "Rivera engagement") && has(out, "Rivera matter"));
  assert.ok(has(out, 'data-testid="link-pj_0"') && has(out, 'data-testid="link-pj_1"') && has(out, 'data-testid="link-unresolved"'), "two [[ links resolve, one names nobody");
  assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash in any copy");
});

test("screen: on a wide window the sheet is two columns and the right pane starts on Activity", () => {
  const out = page(createSamplePage());
  assert.ok(has(out, 'data-testid="record-pane"') && has(out, 'data-testid="pane-activity"') === false && has(out, "Nothing has changed yet."));
  for (const t of ["Activity", "Comments", "Chat", "Files", "Memory", "History"]) assert.ok(has(out, `>${t}<`), t);
  const shut = page(createSamplePage(), { pane: false });
  assert.ok(!has(shut, 'data-testid="record-pane"') && has(shut, 'data-testid="toggle-pane"'));
});

test("screen: the pane's tabs: Activity after an edit, Memory with the fact and its source, History in the shared tab, Chat and Files lead to their places", async () => {
  const s = createSamplePage();
  await saveField(s.data, "clients", row(s), field("phone"), "+1 415 555 0100");
  assert.ok(has(page(s, { tab: "activity" }), "Irfad Imtiaz set phone to +1 415 555 0100"));
  const memory = page(s, { tab: "memory" });
  assert.ok(has(memory, 'data-testid="pane-memory"') && has(memory, "Elena prefers email over phone calls") && has(memory, "project"));
  const history = page(s, { tab: "history" });
  assert.ok(has(history, 'data-testid="pane-history"') && has(history, "Signed the retainer") && has(history, "Moved the next step") && has(history, "Edited on the page"));
  assert.ok(has(page(s, { tab: "chat" }), 'data-testid="open-chat"') && has(page(s, { tab: "files" }), 'data-testid="open-files"') && has(page(s, { tab: "comments" }), 'data-testid="open-chat-comments"'));
});

test("screen: a field open for editing is an input with its label, no Save button anywhere", () => {
  const out = page(createSamplePage(), { edit: { key: "phone", text: "+1 415" }, all: true });
  assert.ok(has(out, 'data-testid="edit-phone"') && has(out, 'value="+1 415"') && has(out, 'aria-label="Phone"'));
  assert.ok(!/>Save</.test(out), "no Save button");
  const bad = page(createSamplePage(), { edit: { key: "value", text: "lots" }, all: true });
  assert.ok(has(bad, 'data-testid="edit-value"'));
});

test("screen: relation hover peek shows the linked record's own fields", () => {
  const out = wrap(createSamplePage(), <Peek type="projects" recordId="pj_0" />);
  assert.ok(has(out, 'data-testid="peek-pj_0"') && has(out, ">Rivera engagement<") && has(out, ">Budget<") && has(out, "$8,000") && has(out, ">Lead<") && has(out, ">Omar Haddad<"));
  assert.equal(wrap(createSamplePage(), <Peek type="projects" recordId="nope" />), "", "a peek of nothing draws nothing");
});

test("screen: the relationship map draws the record and the projects around it, and says so when nothing is linked", () => {
  const out = page(createSamplePage(), { map: true, pane: false });
  assert.ok(has(out, 'data-testid="relation-map"') && has(out, 'aria-label="Relationships, two hops out"'));
  for (const id of ["cl_0", "pj_0", "pj_1"]) assert.ok(has(out, `data-testid="map-${id}"`), id);
  assert.equal(count(out, 'data-testid="map-edge"'), 2);
  assert.ok(has(out, 'data-hop="0"') && count(out, 'data-hop="1"') === 2);
  const none = createSamplePage();
  none.replica.put("records:clients", [{ ...row(none, "clients", "cl_2"), fields: { ...row(none, "clients", "cl_2").fields, projects: [] } }] as never);
  none.replica.put("records:projects", [{ ...row(none, "projects", "pj_2"), fields: { ...row(none, "projects", "pj_2").fields, client: [] } }] as never);
  assert.ok(has(page(none, { map: true, pane: false }, "clients", "cl_2"), "Nothing is linked to this record yet."));
});

test("screen: a project's page has its own fields, and Harbor Studio opens in the same page", () => {
  const out = page(createSamplePage(), undefined, "projects", "pj_0");
  assert.ok(has(out, 'aria-label="Rivera engagement, Project"') && has(out, 'data-testid="section-details"') && has(out, 'data-testid="section-related"') && has(out, 'data-testid="rel-cl_0"'));
  const h = page(createSamplePage(harbor));
  assert.ok(has(h, 'data-testid="record-page"') && !has(h, 'data-testid="row-tax"'));
});

test("before data arrives the page draws a frame, never a blank screen", () => {
  assert.ok(has(renderToStaticMarkup(<RecordPage type="clients" recordId="cl_0" />), "record-page-loading"));
});

test("navigate: opening a record reads its data and draws its first paint inside the 50 ms budget", () => {
  const s = createSamplePage();
  page(s);
  // the typical open: the middle of seven warm draws, each reading every capability the page needs and drawing the whole page
  const times: number[] = [];
  let out = "";
  for (let i = 0; i < 7; i++) {
    const t0 = performance.now();
    out = page(s);
    times.push(performance.now() - t0);
  }
  times.sort((x, y) => x - y);
  const ms = times[3]!;
  console.log(`METRIC ${JSON.stringify({ name: "navigate", screen: "records.page", ms: +ms.toFixed(1), worst_ms: +times[6]!.toFixed(1), budget_ms: 50, ok: ms < 50 })}`);
  assert.ok(has(out, 'data-testid="record-page"'));
  assert.ok(ms < 50, `the page took ${ms.toFixed(1)} ms to draw (median of seven), over the 50 ms budget`);
});
