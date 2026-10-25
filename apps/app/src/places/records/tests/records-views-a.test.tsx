// @reads ../../../../../../scripts/shots/mounts/P-L9d_02.tsx
// Records views, part A: Board, Gallery and List. Lanes from a status field with their own cached counts, a card dropped on a lane written through records.update, a gallery whose every card
// has a fixed box and whose covers load lazily, a list of shared Rows, and the switch between them and the table.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { RecordsDataProvider, RecordsStateProvider, pointOf } from "../sidebar/index.ts";
import type { RecordsState } from "../sidebar/index.ts";
import { PLAIN, countSpec } from "../table/index.ts";
import {
  BODY_H, CARD_GAP, CARD_H, COVER_H, GALLERY_PAD, GALLERY_PAGE, KIND_ORDER, LANE_PAGE, NONE_KEY, RecordViews, badgeFieldOf, cardFields, coverHue, coverOf, galleryLayout, initialsOf, isLaneField, kindOf,
  laneClause, laneCountSpec, laneFieldOf, laneOfRow, laneSpec, lanesOf, moveCard, moveError, movePatch, neighbour, noteOf, pageSpec,
} from "../views-a/index.ts";
import type { RecordRow, TableViewState } from "../views-a/index.ts";
import { SAMPLE_NOW, createViewsSample, harbor, northRich, northwind, project } from "../views-a/sample.ts";
import type { ViewsSample } from "../views-a/sample.ts";

const wrap = (s: ViewsSample, child: ReactElement, initial: Partial<RecordsState> = {}): string =>
  renderToStaticMarkup(<RecordsDataProvider value={s.data}><RecordsStateProvider initial={initial}>{child}</RecordsStateProvider></RecordsDataProvider>).replaceAll("<!-- -->", "");
const views = (kind: string, initial: Partial<RecordsState> = { type: "projects" }, s: ViewsSample = createViewsSample(), view?: Partial<TableViewState>): string =>
  wrap(s, <RecordViews kind={kind} {...(view ? { view } : {})} />, initial);
const has = (s: string, needle: string): boolean => s.includes(needle);
const at = (s: string, needle: string): number => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `expected ${needle}`);
  return i;
};
const count = (s: string, needle: string): number => s.split(needle).length - 1;
const laneCount = (out: string, key: string): number => Number(new RegExp(`data-testid="lane-count-${key}"[^>]*>([^<]*)<`).exec(out)?.[1]?.replaceAll(",", "") ?? Number.NaN);
const cardsIn = (out: string, key: string): string[] => {
  const from = out.indexOf(`data-testid="lane-${key}"`);
  if (from < 0) return [];
  const next = out.indexOf('data-testid="drop-', from + 10);
  const part = out.slice(from, next < 0 ? out.length : next);
  return [...part.matchAll(/data-testid="card-([^"]+)"/g)].map((m) => m[1]!);
};
const status = northwind.types.find((t) => t.key === "projects")!.fields.find((f) => f.key === "status")!;
const projects = (s: ViewsSample): RecordRow[] => s.replica.rows("records:projects") as unknown as RecordRow[];
const projectsDef = northRich.types.find((t) => t.key === "projects")!;
const cardsCount = (out: string): number => count(out, 'data-testid="card-');

// ---------------------------------------------------------------- the kinds

test("kinds: a saved view opens as its own kind, and a kind this part does not draw reads as the table", () => {
  assert.deepEqual(KIND_ORDER, ["table", "board", "gallery", "list"]);
  assert.equal(kindOf({ kind: "board" }), "board");
  assert.equal(kindOf({ kind: "calendar" }), "table");
  assert.equal(kindOf({ kind: "calendar" }, [...KIND_ORDER, "calendar"]), "calendar");
  assert.equal(kindOf(undefined), "table");
});

test("the switch: every view of part A has a header with the kind menu, Filter, Fields and New; the table is the default", () => {
  const table = views("table");
  assert.ok(has(table, 'data-testid="records-table"'), "the table kind draws the table");
  for (const kind of ["board", "gallery", "list"]) {
    const out = views(kind);
    for (const id of ["records-head", "records-kind", "records-filter", "records-fields", "records-new", "records-find-btn", "records-views"]) assert.ok(has(out, `data-testid="${id}"`), `${kind} has ${id}`);
    assert.ok(has(out, "Projects") && has(out, "All projects"), `${kind} names the type and the view`);
    assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash in any copy");
  }
  assert.ok(has(views("board"), 'aria-label="View as, Board"') && has(views("gallery"), 'aria-label="View as, Gallery"') && has(views("list"), 'aria-label="View as, List"'));
  assert.ok(has(views("gallery"), "Sort") && has(views("list"), "Sort") && !has(views("board"), 'data-testid="records-sort"'), "a board keeps its lanes' order, so it has no Sort");
});

test("a saved view of another kind opens as that kind, and the view menu names it", () => {
  const board = views("table", { type: "projects", viewId: "vw_board" });
  assert.ok(has(board, 'data-testid="records-board"') && has(board, "By status"));
  assert.ok(has(views("table", { type: "projects", viewId: "vw_gallery" }), 'data-testid="records-gallery"'));
  const list = views("table", { type: "projects", viewId: "vw_open" });
  assert.ok(has(list, 'data-testid="records-list"') && has(list, "Open projects"));
  assert.equal(cardsCount(list), 0);
  assert.ok(has(list, "9 projects"), "the saved filter keeps the nine projects that are not done");
});
test("extra kinds from part B join the same switch", () => {
  const s = createViewsSample();
  const out = wrap(s, <RecordViews kind="calendar" extraKinds={[{ kind: "calendar", label: "Calendar", render: (ctx) => <p data-testid="extra">{`calendar of ${ctx.def.plural}`}</p> }]} />, { type: "projects" });
  assert.ok(has(out, 'data-testid="extra"') && has(out, "calendar of Projects"));
  assert.ok(has(views("calendar"), 'data-testid="records-table"'), "without it the kind falls back to the table");
});

// ---------------------------------------------------------------- board: the model

test("lanes: a status field's options in order, then the lane for records with no value", () => {
  assert.equal(isLaneField(status), true);
  assert.deepEqual(lanesOf(status).map((l) => [l.key, l.title, l.none]), [["planning", "Planning", false], ["active", "Active", false], ["done", "Done", false], [NONE_KEY, "No status", true]]);
  const d = projectsDef;
  assert.equal(laneFieldOf(d)?.key, "status", "the first status field");
  assert.equal(laneFieldOf(d, { config: { lane: "status" } })?.key, "status");
  assert.equal(laneFieldOf(d, undefined, "lead"), laneFieldOf(d), "a key that names no lane field falls through");
  const clients = northwind.types[0]!;
  assert.equal(laneFieldOf(clients)?.key, "stage", "a status field wins over a choice field");
  assert.equal(laneFieldOf(clients, { config: { lane: "source" } })?.key, "source", "the saved view's lane");
  assert.equal(laneFieldOf(clients, { group: "status" })?.key, "status", "then the saved group");
  assert.equal(laneFieldOf(clients, { config: { lane: "source" } }, "status")?.key, "status", "a pick in the Lanes menu wins");
  assert.equal(laneFieldOf({ ...clients, fields: clients.fields.filter((f) => !isLaneField(f)) }), undefined);
});

test("a lane asks for its own cards and its own count, with the view's filter and not the lane field's", () => {
  const lanes = lanesOf(status);
  const active = lanes[1]!, none = lanes[3]!;
  assert.deepEqual(laneClause(status, active), { field: "status", op: "eq", value: "active" });
  assert.deepEqual(laneClause(status, none), { field: "status", op: "empty" });
  assert.deepEqual(laneSpec("projects", PLAIN, "name", status, active, LANE_PAGE), { type: "projects", filter: { field: "status", op: "eq", value: "active" }, offset: 0, limit: 40 });
  const v: TableViewState = { ...PLAIN, find: "ri", sort: [{ field: "due", dir: "asc" }], clauses: [{ field: "status", op: "eq", value: "done" }, { field: "lead", op: "eq", value: "usr_maya" }] };
  assert.deepEqual(laneSpec("projects", v, "name", status, active, 80), {
    type: "projects", filter: { and: [{ and: [{ field: "lead", op: "eq", value: "usr_maya" }, { field: "name", op: "contains", value: "ri" }] }, { field: "status", op: "eq", value: "active" }] },
    sort: [{ field: "due", dir: "asc" }], offset: 0, limit: 80,
  });
  assert.deepEqual(laneCountSpec("projects", PLAIN, "name", status, active), { type: "projects", filter: { field: "status", op: "eq", value: "active" } });
});

test("a drop writes the lane field: the lane's key, or null for the lane of no value", () => {
  const lanes = lanesOf(status);
  assert.deepEqual(movePatch(status, lanes[2]!), { status: "done" });
  assert.deepEqual(movePatch(status, lanes[3]!), { status: null });
  const row = project(0, true);
  assert.equal(laneOfRow(status, row, lanes).key, "planning");
  assert.equal(laneOfRow(status, { ...row, fields: { ...row.fields, status: null } }, lanes).key, NONE_KEY);
  assert.equal(laneOfRow(status, { ...row, fields: { ...row.fields, status: "gone" } }, lanes).key, NONE_KEY, "a value that is no longer an option sits in the lane of no value");
});

test("Alt and an arrow move a card to the lane beside it; the lane of no value only counts when it holds cards", () => {
  const lanes = lanesOf(status);
  assert.equal(neighbour(lanes, "planning", 1)?.key, "active");
  assert.equal(neighbour(lanes, "planning", -1), undefined);
  assert.equal(neighbour(lanes, "done", 1)?.key, NONE_KEY);
  assert.equal(neighbour(lanes, "done", 1, (l) => !l.none), undefined, "an empty lane of no value is not a place to go");
  assert.equal(neighbour(lanes, NONE_KEY, -1)?.key, "done");
});

test("a card shows the title and up to three fields: people first, then money and dates; never long text, files or the lane field", () => {
  const d = projectsDef;
  const shown = cardFields(d, [], "status").map((f) => f.key);
  assert.deepEqual(shown, ["lead", "budget", "due"]);
  assert.deepEqual(cardFields(d, ["budget"], "status").map((f) => f.key), ["lead", "due"], "a hidden field drops out");
  assert.ok(!shown.includes("cover") && !shown.includes("name") && !shown.includes("status"));
  const clients = northwind.types[0]!;
  assert.equal(cardFields(clients, [], "stage").length, 3);
  assert.ok(!cardFields(clients, [], "stage").some((f) => f.type === "longtext"));
  assert.equal(badgeFieldOf(clients)?.key, "stage");
  assert.equal(noteOf(["Maya", "", "$4,000"]), "Maya · $4,000");
});

// ---------------------------------------------------------------- board: the screen

test("screen: a board draws a lane per option with its cached count, and every card in the lane its status puts it in", () => {
  const out = views("board");
  assert.ok(has(out, 'data-testid="records-board"') && has(out, 'aria-label="Projects board"'));
  assert.deepEqual(["planning", "active", "done"].map((k) => laneCount(out, k)), [3, 6, 3]);
  assert.ok(!has(out, 'data-testid="lane-none"'), "the lane of no value is not drawn while it is empty");
  assert.deepEqual(cardsIn(out, "planning"), ["projects_0", "projects_4", "projects_8"]);
  assert.deepEqual(cardsIn(out, "done"), ["projects_3", "projects_6", "projects_10"]);
  assert.equal(cardsIn(out, "active").length, 6);
  assert.ok(has(out, "Rivera engagement") && has(out, ">Maya<") && has(out, "$4,000"), "a card shows the title, the lead and the budget");
  assert.ok(has(out, 'aria-label="Rivera engagement, Planning"'), "a card says which lane it is in");
  assert.ok(has(out, 'data-testid="add-planning"') && has(out, 'data-testid="add-done"'), "a lane has a New button");
  assert.ok(has(out, 'data-testid="records-lanes"') && has(out, ">Status<"), "the Lanes button names the field the board runs on");
});

test("cards are draggable and every lane is a drop target (web), so a drag needs no handle", () => {
  const out = views("board");
  assert.equal(count(out, 'draggable="true"'), 12, "one draggable wrapper per card");
  for (const k of ["planning", "active", "done"]) assert.ok(has(out, `data-testid="drop-${k}"`), `${k} takes drops`);
  assert.ok(has(out, 'data-testid="drag-projects_0"'));
});

test("a drop moves the card: one records.update with the lane's value and the card's version, and the next render has it in the new lane", async () => {
  const s = createViewsSample();
  const lanes = lanesOf(status);
  const row = projects(s).find((r) => r.id === "projects_0")!;
  assert.equal(await moveCard(s.data, "projects", status, row, lanes[2]!), true);
  assert.deepEqual(s.calls.map((c) => c.cap), ["records.update"]);
  assert.deepEqual(s.calls[0]!.input, { type: "projects", recordId: "projects_0", patch: { status: "done" }, baseVersion: 1 });
  assert.deepEqual(s.updates, [{ type: "projects", recordId: "projects_0", patch: { status: "done" } }]);
  const out = wrap(s, <RecordViews kind="board" />, { type: "projects" });
  assert.deepEqual(["planning", "active", "done"].map((k) => laneCount(out, k)), [2, 6, 4], "the lane counts move with the card");
  assert.ok(cardsIn(out, "done").includes("projects_0") && !cardsIn(out, "planning").includes("projects_0"));
  assert.equal(projects(s).find((r) => r.id === "projects_0")!.version, 2, "the version moved");
});

test("dropping a card on the lane it is already in writes nothing", async () => {
  const s = createViewsSample();
  const row = projects(s).find((r) => r.id === "projects_1")!;
  assert.equal(await moveCard(s.data, "projects", status, row, lanesOf(status)[1]!), false);
  assert.deepEqual(s.calls, []);
});

test("a card dropped on No status clears the field, and that lane then appears", async () => {
  const s = createViewsSample();
  const row = projects(s).find((r) => r.id === "projects_2")!;
  await moveCard(s.data, "projects", status, row, lanesOf(status)[3]!);
  assert.deepEqual(s.calls[0]!.input, { type: "projects", recordId: "projects_2", patch: { status: null }, baseVersion: 1 });
  const out = wrap(s, <RecordViews kind="board" />, { type: "projects" });
  assert.deepEqual([laneCount(out, "none"), laneCount(out, "active")], [1, 5]);
  assert.deepEqual(cardsIn(out, "none"), ["projects_2"]);
  assert.ok(has(out, ">No status<"));
});

test("a refused move says why and changes nothing; a card someone else changed is refused too", async () => {
  const refused = createViewsSample(northwind, { fail: "You cannot edit projects" });
  const row = projects(refused)[0]!;
  await assert.rejects(moveCard(refused.data, "projects", status, row, lanesOf(status)[1]!), /cannot edit/);
  assert.equal(moveError(new Error("You cannot edit projects")), "Could not move the card: You cannot edit projects");
  assert.equal(moveError(undefined), "Could not move the card.");
  assert.equal(projects(refused)[0]!.fields["status"], "planning", "the card stays where it was");
  const s = createViewsSample();
  const stale = { ...projects(s)[0]!, version: 0 };
  await assert.rejects(moveCard(s.data, "projects", status, stale, lanesOf(status)[2]!), /changed by someone else/);
});

test("a board of clients runs on Stage, and a filter narrows every lane", () => {
  const s = createViewsSample();
  const clients = views("board", { type: "clients" }, s);
  assert.deepEqual(["intake", "engaged", "review", "done"].map((k) => laneCount(clients, k)), [4, 4, 3, 3]);
  assert.ok(has(clients, ">Stage<"), "the Lanes button names the field");
  const narrowed = views("board", { type: "projects" }, s, { clauses: [{ field: "lead", op: "eq", value: "usr_maya" }] });
  const total = ["planning", "active", "done"].reduce((n, k) => n + laneCount(narrowed, k), 0);
  assert.equal(total, projects(s).filter((r) => r.fields["lead"] === "usr_maya").length);
});

test("a lane of ten thousand cards draws forty and says ten thousand; Show more asks for forty more", () => {
  const s = createViewsSample(northwind, { bulk: 10_000 });
  const out = views("board", { type: "clients" }, s);
  const total = ["intake", "engaged", "review", "done"].reduce((n, k) => n + laneCount(out, k), 0);
  assert.equal(total, 10_014);
  assert.ok(laneCount(out, "intake") > 2000);
  assert.equal(cardsIn(out, "intake").length, LANE_PAGE);
  assert.ok(has(out, 'data-testid="more-intake"') && has(out, "Show 40 more of "));
  assert.ok(count(out, 'data-testid="card-') <= 4 * LANE_PAGE, "no lane draws more than a page");
});

test("table100k for the board: 100,014 clients open by asking each lane for forty cards and its cached count", () => {
  const s = createViewsSample(northwind, { bulk: 100_000 });
  const lanes = lanesOf(northwind.types[0]!.fields.find((f) => f.key === "stage")!);
  const stage = northwind.types[0]!.fields.find((f) => f.key === "stage")!;
  const t0 = performance.now();
  let cards = 0, total = 0;
  for (const lane of lanes) {
    const q = s.data.live("records.query", laneSpec("clients", PLAIN, "name", stage, lane, LANE_PAGE)).getSnapshot();
    const n = s.data.live("records.counts", laneCountSpec("clients", PLAIN, "name", stage, lane)).getSnapshot();
    assert.equal(q.status, "ready");
    assert.equal(n.status, "ready");
    cards += (q as { data: { rows: unknown[] } }).data.rows.length;
    total += (n as { data: { count: number } }).data.count;
  }
  const ms = performance.now() - t0;
  console.log(`METRIC ${JSON.stringify({ name: "board100k", rows: 100_014, data_ms: +ms.toFixed(1), budget_ms: 1000, ok: ms < 1000 })}`);
  assert.equal(total, 100_014);
  assert.equal(cards, 4 * LANE_PAGE);
  assert.ok(ms < 1000, `the data a 100,000 record board opens on arrives in ${ms.toFixed(1)} ms`);
});

// ---------------------------------------------------------------- gallery

test("gallery layout: as many cards of at least 232 px as fit, sharing the width, in one fixed box each", () => {
  assert.deepEqual(galleryLayout(1000), { cols: 3, cardW: 313 });
  assert.deepEqual(galleryLayout(1280), { cols: 5, cardW: 238 });
  assert.deepEqual(galleryLayout(390), { cols: 1, cardW: 358 }, "a phone gets one column");
  assert.deepEqual(galleryLayout(0), { cols: 1, cardW: 232 }, "an unmeasured container still gives a whole card");
  for (const w of [320, 640, 900, 1440, 2000]) {
    const { cols, cardW } = galleryLayout(w);
    assert.ok(cardW >= 232 || cols === 1);
    assert.ok(cols * cardW + (cols - 1) * CARD_GAP <= Math.max(232, w - GALLERY_PAD * 2), `${w}: the row fits`);
  }
  assert.deepEqual([COVER_H, BODY_H, CARD_H], [96, 84, 180]);
});

test("covers: the first image file wins, a card with none gets a steady colour and initials", () => {
  const d = projectsDef;
  const withCover = project(0, true), without = project(1, true);
  assert.equal(coverOf(d, withCover)?.name, "cover-0.svg");
  assert.equal(coverOf(d, without), null);
  const odd = { ...without, fields: { ...without.fields, cover: [{ name: "notes.txt", url: "x", mime: "text/plain" }, { name: "photo.JPG", url: "u", mime: "" }] } };
  assert.equal(coverOf(d, odd)?.url, "u", "an image by its name when the type says nothing");
  assert.equal(coverHue(without, "name"), coverHue(without, "name"));
  assert.ok(coverHue(without, "name") >= 0 && coverHue(without, "name") < 400);
  assert.equal(initialsOf("Rivera engagement"), "RE");
  assert.equal(initialsOf(""), "?");
});

test("screen: a gallery draws a card per record in fixed boxes, covers load lazily and keep their size", () => {
  const out = views("gallery");
  assert.ok(has(out, 'data-testid="records-gallery"') && has(out, 'aria-label="Projects gallery"') && has(out, 'aria-label="12 cards"'));
  assert.equal(count(out, 'data-testid="gal-projects_'), 12);
  assert.equal(count(out, 'data-testid="cover-projects_'), 12, "every card has a cover box");
  assert.equal(count(out, 'data-testid="cover-image"'), 4, "four of the twelve have a picture");
  const img = /<img[^>]*data-testid="cover-image"[^>]*>/.exec(out)?.[0] ?? "";
  assert.ok(has(img, 'loading="lazy"') && has(img, 'decoding="async"'), "the browser loads a cover when it nears the screen");
  assert.ok(has(img, 'width="313"') && has(img, 'height="96"') && has(img, "object-fit:cover"), "the picture is drawn in the cover's fixed size");
  assert.ok(count(out, "width:313px") >= 12 * 2, "each card and its cover are 313 px wide");
  assert.ok(has(out, 'data-testid="face-Maya Chen"'), "a card with no picture shows its lead's face");
  assert.ok(has(out, "Rivera engagement") && has(out, "12 projects") && has(out, 'data-testid="tag-status"'));
});

test("a gallery draws sixty cards at first and Show more adds sixty; the foot is the cached count", () => {
  const s = createViewsSample(northwind, { bulk: 150 });
  const out = views("gallery", { type: "clients" }, s);
  assert.equal(count(out, 'data-testid="gal-cl_'), GALLERY_PAGE);
  assert.ok(has(out, 'data-testid="gallery-more"') && has(out, "Show 60 more"));
  assert.ok(has(out, "164 clients"));
  assert.ok(has(out, 'data-testid="face-'), "a client's cover is its owner's face");
  const spec = pageSpec("clients", PLAIN, "name", 120);
  assert.deepEqual(spec, { type: "clients", offset: 0, limit: 120 });
  const small = views("gallery", { type: "clients" });
  assert.ok(!has(small, 'data-testid="gallery-more"'), "fourteen clients fit on one page");
});

// ---------------------------------------------------------------- list

test("screen: a list is the shared Row with its slots: a face or an icon first, the tag last, one line of fields under the title", () => {
  const out = views("list");
  assert.ok(has(out, 'data-testid="records-list"') && has(out, 'aria-label="Projects list"'));
  for (let i = 0; i < 12; i++) assert.ok(has(out, `data-testid="row-rec-projects_${i}"`), `row ${i}`);
  assert.ok(has(out, 'data-testid="row-rec-projects_0-leading"') && has(out, 'data-testid="row-rec-projects_0-trailing"'), "the leading and trailing slots of ui/Row");
  assert.ok(has(out, 'data-testid="face-Maya Chen"'), "the lead's face leads the row");
  assert.ok(has(out, "Maya · $4,000"), "the note joins the lead and the budget");
  assert.ok(has(out, 'data-testid="tag-status"') && has(out, ">Planning<"), "the status is the tag at the right");
  assert.ok(has(out, "12 projects") && has(out, 'data-testid="records-count"'));
  assert.ok(at(out, "row-rec-projects_0") < at(out, "row-rec-projects_11"), "in the order of the records");
});

test("a list sorts and filters like the others, and says so when nothing matches", () => {
  const s = createViewsSample();
  const sorted = views("list", { type: "projects" }, s, { sort: [{ field: "name", dir: "asc" }] });
  assert.ok(at(sorted, "row-rec-projects_9") < at(sorted, "row-rec-projects_0"), "Alvarez settlement before Rivera engagement");
  const done = views("list", { type: "projects" }, s, { clauses: [{ field: "status", op: "eq", value: "done" }] });
  assert.ok(has(done, "3 projects") && !has(done, "row-rec-projects_0"));
  const none = views("list", { type: "projects" }, s, { find: "zzzz" });
  assert.ok(has(none, "Nothing matches these filters."));
  assert.ok(has(views("gallery", { type: "projects" }, s, { find: "zzzz" }), "Nothing matches these filters."));
});

// ---------------------------------------------------------------- all views

test("every view opens offline from the kept copy and says so", () => {
  for (const kind of ["board", "gallery", "list"]) {
    const out = views(kind, { type: "projects" }, createViewsSample(northwind, { online: false }));
    assert.ok(has(out, 'data-testid="records-offline"') && has(out, "Rivera engagement"), kind);
  }
});

test("harbor studio draws its own three projects in the same views", () => {
  const s = createViewsSample(harbor);
  const board = views("board", { type: "projects" }, s);
  assert.deepEqual(["planning", "active", "done"].map((k) => laneCount(board, k)), [1, 2, 0]);
  assert.ok(has(views("gallery", { type: "projects" }, s), "3 projects"));
  assert.ok(!has(views("gallery", { type: "projects" }, s), 'data-testid="face-'), "no lead field here, so initials");
});

test("a type with no status or choice field says why a board cannot be drawn", () => {
  const s = createViewsSample();
  const out = views("board", { type: "meetings" }, s);
  assert.ok(has(out, "have no status or choice field to make lanes from."));
});

test("before data arrives the views draw a frame, never a blank page", () => {
  assert.ok(has(renderToStaticMarkup(<RecordViews kind="board" />), "records-table-loading"));
});

test("the sample is what the views read: twelve projects with budgets and covers, and the count under every view", () => {
  const s = createViewsSample();
  const rows = projects(s);
  assert.equal(rows.length, 12);
  assert.equal(rows.filter((r) => Array.isArray(r.fields["cover"]) && (r.fields["cover"] as unknown[]).length > 0).length, 4);
  const c = s.data.live("records.counts", countSpec("projects", PLAIN, "name")).getSnapshot();
  assert.equal(c.status === "ready" ? c.data.count : -1, 12);
  assert.ok(rows.every((r) => r.updatedAt <= SAMPLE_NOW));
});

test("a menu opened from a button lands under the button when the press has no pointer: keyboard, code and click open it in the same place", () => {
  const button = { getBoundingClientRect: () => ({ left: 640, bottom: 52 }) };
  assert.deepEqual(pointOf({ nativeEvent: { pageX: 0, pageY: 0 }, currentTarget: button }), { x: 640, y: 52 }, "Enter on the button");
  assert.deepEqual(pointOf({ nativeEvent: {}, target: button }), { x: 640, y: 52 }, "a press with no coordinates at all");
  assert.deepEqual(pointOf({ nativeEvent: { pageX: 700, pageY: 60 }, currentTarget: button }), { x: 700, y: 60 }, "a click keeps its pointer");
  assert.deepEqual(pointOf({}), { x: 0, y: 0 }, "nothing to anchor to");
});
