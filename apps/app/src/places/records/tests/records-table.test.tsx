// Records sidebar and table: the screen. Types in their groups with counts, saved views, the sheet with its columns and rows drawn from a window, the header menus' model, and the
// 100,000 row Space that opens under the table100k budget. The table draws only the rows and columns that meet the screen; the foot count is the cached count.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { RecordsDataProvider, RecordsSidebar, RecordsStateProvider, SidebarLoading, compact, effectiveType, reduce, sortedViews, typeGroups, INITIAL_STATE } from "../sidebar/index.ts";
import type { RecordsState } from "../sidebar/index.ts";
import {
  FLING_OVERSCAN, GUTTER, PLAIN, ROW_H, TableLoading, TableView, cellText, chosen, clearClauses, colourOf, columnWindow, columnsOf, countSpec, cycleSort, filterOf, fromSaved, groupItems, isEdited,
  optionsOf, queryOffset, querySpec, rowWindow, setSort, toSaved, toggleHidden, toggleOption, totalWidth,
} from "../table/index.ts";
import type { RecordRow, TableViewState } from "../table/index.ts";
import { SAMPLE_NOW, client, createSampleRecords, harbor, northwind } from "../table/sample.ts";
import type { SampleRecords, SampleSpace } from "../table/sample.ts";

const wrap = (s: SampleRecords, child: ReactElement, initial: Partial<RecordsState> = {}): string =>
  renderToStaticMarkup(<RecordsDataProvider value={s.data}><RecordsStateProvider initial={initial}>{child}</RecordsStateProvider></RecordsDataProvider>).replaceAll("<!-- -->", "");
const table = (view?: Partial<TableViewState>, initial: Partial<RecordsState> = {}, space: SampleSpace = northwind, o: { online?: boolean; bulk?: number } = {}): string =>
  wrap(createSampleRecords(space, o), <TableView {...(view ? { view } : {})} />, initial);
const side = (initial: Partial<RecordsState> = {}, space: SampleSpace = northwind): string => wrap(createSampleRecords(space), <RecordsSidebar />, initial);
const has = (s: string, needle: string): boolean => s.includes(needle);
const at = (s: string, needle: string): number => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `expected ${needle}`);
  return i;
};
const recs = (out: string): string[] => [...out.matchAll(/data-testid="rec-([^"]+)"/g)].map((m) => m[1]!).filter((k) => !k.startsWith("pending"));
const name = (i: number): string => String(client(i).fields["name"]);

test("screen: the sidebar groups record types with counts, then saved views and Manage", () => {
  const out = side();
  const order = ["Records", "Projects", "Sites", "Saved views", "Manage"].map((t) => at(out, `>${t}<`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "Records first, a Sites group after the others, then views and Manage");
  for (const label of ["Clients", "Companies", "Meetings", "Northwind site › Orders", "Active clients", "My clients", "Record types", "Schema map"]) assert.ok(has(out, `>${label}<`), label);
  assert.ok(has(out, 'data-testid="count-clients"') && has(out, ">14<") && has(out, ">9<"), "row counts beside each type");
  assert.ok(has(out, 'data-testid="row-nav:type:clients"') && has(out, 'data-testid="row-nav:type:clients-trailing"'), "every row is a ui/Row with slots");
  assert.equal(out.split("background-color:var(--sel)").length - 1, 1, "one row is selected, with the quiet selection token");
});

test("the sidebar opens on the first type and follows the open one and the saved view", () => {
  assert.equal(effectiveType(INITIAL_STATE, typeGroups(northwind.types.map((t) => ({ ...t, rowCount: 1, fieldCount: 1 })))), "clients");
  const projects = side({ type: "projects" });
  assert.ok(!has(projects, ">Active clients<"), "saved views belong to the open type");
  const view = side({ type: "clients", viewId: "vw_active" });
  assert.ok(has(view, "background-color:var(--sel)"));
  let s = reduce(INITIAL_STATE, { type: "open", key: "companies" });
  assert.deepEqual([s.type, s.viewId], ["companies", null]);
  s = reduce(s, { type: "open", key: "clients", viewId: "vw_mine" });
  assert.deepEqual([s.type, s.viewId], ["clients", "vw_mine"]);
  assert.deepEqual(reduce(reduce(s, { type: "section", key: "Sites" }), { type: "section", key: "Sites" }).closed, []);
  assert.deepEqual(reduce(s, { type: "view", viewId: null }).viewId, null);
});

test("type groups: Records first, other groups in order, Sites last; site tables read Site › Table", () => {
  const groups = typeGroups(northwind.types.map((t) => ({ ...t, rowCount: 1, fieldCount: t.fields.length })));
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.label)]), [
    ["Records", ["Clients", "Companies", "Meetings"]], ["Projects", ["Projects"]], ["Sites", ["Northwind site › Orders"]],
  ]);
  assert.equal(compact(14), "14");
  assert.equal(compact(1500), "1,500", "whole numbers up to 10,000, as the prototype draws them");
  assert.equal(compact(100014), "100k");
  assert.equal(compact(2_500_000), "2.5M");
  assert.deepEqual(sortedViews(northwind.views, "usr_irfad").map((v) => v.title), ["My clients", "Active clients"]);
});

test("screen: the table draws a header, one row per record and the cached count in the foot", () => {
  const out = table();
  assert.deepEqual(recs(out), Array.from({ length: 14 }, (_, i) => `cl_${i}`));
  assert.ok(has(out, name(0)) && has(out, name(13)));
  assert.ok(has(out, 'data-testid="th-name"') && has(out, ">Name<") && has(out, ">Status<") && has(out, ">Owner<") && has(out, ">Value<"));
  assert.ok(has(out, ">Lead<") && has(out, ">Active<"), "choice cells read their option's title");
  assert.ok(has(out, ">$1,000<") && has(out, "Oct 18, 2025"), "money and dates read plainly");
  assert.ok(has(out, ">Irfad Imtiaz<") && has(out, 'data-testid="face-Irfad Imtiaz"'), "a person cell has a face and a name");
  assert.ok(has(out, 'data-testid="records-count"') && has(out, "14 clients"));
  assert.ok(has(out, "Clients") && has(out, "All clients") && !has(out, 'data-testid="records-edited"'));
  assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash in any copy");
});

test("column windowing: only the columns that meet the screen are drawn, the title column always", () => {
  const out = table();
  assert.ok(has(out, 'data-testid="th-name"') && has(out, 'data-testid="th-email"'));
  assert.ok(!has(out, 'data-testid="th-notes"') && !has(out, 'data-testid="th-active"') && !has(out, 'data-testid="th-rating"'), "columns past the right edge are not drawn");
  const cols = columnsOf(northwind.types[0]!, []);
  assert.equal(cols[0]!.field.key, "name", "the title field leads");
  assert.equal(cols.length, 13);
  const w = columnWindow(cols, 0, 1000);
  assert.deepEqual([w.from, w.pad], [1, 0]);
  assert.ok(w.to < cols.length && w.to > 4);
  const far = columnWindow(cols, 1400, 1000);
  assert.ok(far.from > 4 && far.pad > 0, "scrolled right, the columns on the left drop out and a spacer keeps the rest in place");
  assert.equal(columnWindow(cols, totalWidth(cols), 1000).to, cols.length);
  assert.deepEqual(columnsOf(northwind.types[0]!, ["notes", "email"]).map((c) => c.field.key).includes("notes"), false);
  assert.equal(columnsOf(northwind.types[0]!, ["name"])[0]!.field.key, "name", "the title field cannot be hidden");
});

test("the row window follows the scroll and the query asks for 200 rows on a 100 row grid", () => {
  assert.deepEqual(rowWindow(0, 600, 100_000), { first: 0, last: Math.ceil(600 / ROW_H) + 6 });
  assert.deepEqual(rowWindow(34 * 5000, 600, 100_000, FLING_OVERSCAN), { first: 5000 - FLING_OVERSCAN, last: 5000 + Math.ceil(600 / ROW_H) + FLING_OVERSCAN }, "a fling never outruns the drawn rows");
  assert.deepEqual(rowWindow(34 * 5000, 600, 100_000), { first: 5000 - 6, last: 5000 + Math.ceil(600 / ROW_H) + 6 });
  assert.equal(rowWindow(0, 600, 3).last, 3, "never past the last row");
  assert.equal(queryOffset(0, 100_000), 0);
  assert.equal(queryOffset(120, 100_000), 0);
  assert.equal(queryOffset(149, 100_000), 0);
  assert.equal(queryOffset(150, 100_000), 100);
  assert.equal(queryOffset(250, 100_000), 200);
  assert.equal(queryOffset(99_990, 100_000), 99_800, "the last window ends at the last row");
  assert.equal(queryOffset(10, 50), 0);
});

test("a saved view applies its filter, sort and hidden fields, and the header names it", () => {
  const out = table(undefined, { type: "clients", viewId: "vw_active" });
  const active = Array.from({ length: 14 }, (_, i) => client(i)).filter((r) => r.fields["status"] === "active");
  const byValue = active.slice().sort((a, b) => (b.fields["value"] as { amount: number }).amount - (a.fields["value"] as { amount: number }).amount).map((r) => r.id);
  assert.deepEqual(recs(out), byValue);
  assert.ok(has(out, "Active clients") && has(out, `${active.length} clients`));
  const v = fromSaved(northwind.views[0]);
  assert.deepEqual([v.clauses, v.sort, v.hidden], [[{ field: "status", op: "eq", value: "active" }], [{ field: "value", dir: "desc" }], ["notes"]]);
  assert.deepEqual(fromSaved(undefined), PLAIN);
  const saved = toSaved(v);
  assert.deepEqual([saved.filter, saved.sort, saved.hidden], [{ field: "status", op: "eq", value: "active" }, [{ field: "value", dir: "desc" }], ["notes"]]);
});

test("an edited view says so with Save and Reset", () => {
  const out = table({ sort: [{ field: "name", dir: "asc" }] }, { type: "clients" });
  assert.ok(!has(out, 'data-testid="records-edited"'), "the starting view is the base, so nothing is edited yet");
  assert.equal(isEdited({ ...PLAIN, sort: [{ field: "name", dir: "asc" }] }, PLAIN), true);
  assert.equal(isEdited(PLAIN, PLAIN), false);
  assert.equal(isEdited({ ...PLAIN, find: "x" }, PLAIN), false, "find is not part of a saved view");
});

test("view editing: sort cycles, options toggle into eq and in clauses, hidden fields toggle, filters clear", () => {
  let v: TableViewState = PLAIN;
  v = cycleSort(v, "name");
  assert.deepEqual(v.sort, [{ field: "name", dir: "asc" }]);
  v = cycleSort(v, "name");
  assert.deepEqual(v.sort, [{ field: "name", dir: "desc" }]);
  v = cycleSort(v, "name");
  assert.deepEqual(v.sort, []);
  assert.deepEqual(setSort(v, "value", "desc").sort, [{ field: "value", dir: "desc" }]);
  v = toggleOption(v, "status", "active");
  assert.deepEqual(v.clauses, [{ field: "status", op: "eq", value: "active" }]);
  v = toggleOption(v, "status", "lead");
  assert.deepEqual(v.clauses, [{ field: "status", op: "in", value: ["active", "lead"] }]);
  assert.deepEqual(chosen(v, "status"), ["active", "lead"]);
  v = toggleOption(toggleOption(v, "status", "active"), "status", "lead");
  assert.deepEqual(v.clauses, []);
  assert.deepEqual(toggleHidden(toggleHidden(PLAIN, "notes"), "notes").hidden, []);
  assert.deepEqual(clearClauses({ ...PLAIN, clauses: [{ field: "a", op: "eq", value: 1 }], find: "x" }), PLAIN);
});

test("the query the view compiles to: filter and find joined with and, sort, group, a 200 row window", () => {
  assert.equal(filterOf(PLAIN, "name"), undefined);
  assert.deepEqual(filterOf({ ...PLAIN, find: "ri" }, "name"), { field: "name", op: "contains", value: "ri" });
  const v: TableViewState = { ...PLAIN, clauses: [{ field: "status", op: "eq", value: "active" }], find: "ri", sort: [{ field: "value", dir: "desc" }] };
  assert.deepEqual(filterOf(v, "name"), { and: [{ field: "status", op: "eq", value: "active" }, { field: "name", op: "contains", value: "ri" }] });
  assert.deepEqual(querySpec("clients", v, "name", 300), { type: "clients", filter: filterOf(v, "name"), sort: [{ field: "value", dir: "desc" }], offset: 300, limit: 200 });
  assert.deepEqual(querySpec("clients", { ...PLAIN, group: "status" }, "name", 300), { type: "clients", group: "status", offset: 0, limit: 1000 });
  assert.deepEqual(countSpec("clients", PLAIN, "name"), { type: "clients" });
});

test("filters narrow the table, find narrows by the title, and counts come from the same filter", () => {
  const s = createSampleRecords();
  const count = (v: TableViewState): number => {
    const c = s.data.live("records.counts", countSpec("clients", v, "name")).getSnapshot();
    return c.status === "ready" ? c.data.count : -1;
  };
  assert.equal(count(PLAIN), 14);
  assert.equal(count({ ...PLAIN, clauses: [{ field: "status", op: "eq", value: "active" }] }), 7);
  assert.equal(count({ ...PLAIN, clauses: [{ field: "status", op: "in", value: ["active", "lead"] }] }), 7 + 3);
  assert.equal(count({ ...PLAIN, find: name(3).slice(0, 6) }) >= 1, true);
  const out = table({ clauses: [{ field: "status", op: "eq", value: "paused" }] });
  const paused = Array.from({ length: 14 }, (_, i) => client(i)).filter((r) => r.fields["status"] === "paused").map((r) => r.id);
  assert.deepEqual(recs(out), paused);
  assert.ok(has(out, `${paused.length} clients`));
});

test("Group puts rows under their group headers and a folded group keeps only its header", () => {
  const rows = Array.from({ length: 14 }, (_, i) => client(i)).sort((a, b) => String(a.fields["status"]).localeCompare(String(b.fields["status"])));
  const status = northwind.types[0]!.fields.find((x) => x.key === "status")!;
  const items = groupItems(rows as RecordRow[], status, [], (id) => id);
  const heads = items.filter((i) => i.g).map((i) => (i.g ? [i.label, i.n] : []));
  assert.deepEqual(heads.map((h) => h[0]), ["Active", "Closed", "Lead", "Paused"]);
  assert.equal(items.filter((i) => !i.g).length, 14);
  const folded = groupItems(rows as RecordRow[], status, ["active"], (id) => id);
  assert.equal(folded.filter((i) => !i.g).length, 14 - 7);
  const out = table({ group: "status" });
  assert.ok(has(out, 'data-testid="group-active"') && has(out, 'data-testid="group-paused"') && has(out, ">Active<"));
  assert.ok(has(out, `height:${(14 + 4) * ROW_H}px`), "group headers take a row each");
});

test("Colour tints rows by an option field and cells read plainly", () => {
  const status = northwind.types[0]!.fields.find((x) => x.key === "status")!;
  assert.ok(/^hsla\(150, 65%, 52%, 0\.10\)$/.test(colourOf(status, client(1) as RecordRow) ?? ""), "an option's colour is its hue");
  assert.equal(colourOf(undefined, client(0) as RecordRow), null);
  assert.notEqual(table({ colour: "status" }), table(), "a coloured table paints its rows differently");
  const names = (id: string): string => northwind.people[id] ?? id;
  const f = (k: string) => northwind.types[0]!.fields.find((x) => x.key === k)!;
  assert.equal(cellText(f("value"), { amount: 12345, currency: "USD" }, names), "$12,345");
  assert.equal(cellText(f("due"), SAMPLE_NOW, names), "Oct 24, 2025");
  assert.equal(cellText(f("owner"), "usr_maya", names), "Maya Chen");
  assert.equal(cellText(f("status"), "paused", names), "Paused");
  assert.equal(cellText(f("notes"), "", names), "");
  assert.deepEqual(optionsOf(f("active")).map((o) => o.title), ["Checked", "Unchecked"]);
});

test("the table opens offline from the kept copy and says so", () => {
  const out = table(undefined, {}, northwind, { online: false });
  assert.ok(has(out, "Offline, showing your saved copy") && has(out, name(0)));
  assert.ok(!has(table(), "Offline, showing"));
});

test("an empty type and an empty filter say so with the shared empty state", () => {
  assert.ok(has(table(undefined, {}, { ...harbor, counts: { clients: 0, projects: 0 } }), "No clients yet."));
  const none = table({ find: "zzzz" });
  assert.ok(has(none, "Nothing matches these filters.") && has(none, "Clear filters"));
});

test("before data arrives the sidebar and the table draw a frame of the right size, never a blank page", () => {
  assert.ok(has(renderToStaticMarkup(<TableView />), "records-table-loading"));
  assert.ok(has(renderToStaticMarkup(<RecordsSidebar />), "records-sidebar-loading"));
  assert.ok(has(renderToStaticMarkup(<TableLoading />), "Records") && has(renderToStaticMarkup(<SidebarLoading />), "Loading"));
});

test("writes change what the next render shows: a new record adds a row, a saved view joins the sidebar", async () => {
  const s = createSampleRecords();
  const html = (): string => wrap(s, <TableView />);
  assert.ok(html().includes("14 clients"));
  const out = (await s.data.call("records.create", { type: "clients", fields: { name: "New person" }, idempotencyKey: "k1" })) as { record: { id: string } };
  assert.ok(html().includes("15 clients") && html().includes("New person"));
  await s.data.call("views.save", { type: "clients", kind: "table", title: "Big deals", idempotencyKey: "k2", sort: [{ field: "value", dir: "desc" }] });
  assert.ok(wrap(s, <RecordsSidebar />).includes(">Big deals<"));
  assert.deepEqual(s.calls.map((c) => c.cap), ["records.create", "views.save"]);
  s.data.nav.openRecord(out.record.id);
  assert.deepEqual(s.opened, [`record:${out.record.id}`]);
});

test("harbor studio draws its own types, people and a shorter table", () => {
  const out = table(undefined, {}, harbor);
  assert.ok(has(out, "6 clients"));
  const sidebar = side({}, harbor);
  assert.ok(has(sidebar, ">Clients<") && has(sidebar, ">Projects<") && !has(sidebar, ">Companies<"));
  assert.equal(GUTTER, 56);
});

test("a face in a cell reaches the stylesheet only as a hash class and a checked bitmap, never as text of a name", async () => {
  const { faceClassOf, faceRule, safeBitmapUrl } = await import("../table/model.ts");
  const nasty = ["Evil\" } body { display:none } /*", "Line\nbreak {x}", "a'b\"c", "}</style><script>x</script>", "名前   (x)"];
  for (const name of nasty) {
    assert.match(faceClassOf(name), /^vrt-f[a-z0-9]+$/, name);
    const css = faceRule(name);
    assert.ok(css.startsWith(`.${faceClassOf(name)}{`), "the selector is the hash class");
    assert.ok(css.endsWith("}") && css.split("{").length === 2 && css.split("}").length === 2, `one rule, no stray braces: ${css}`);
    for (const piece of ["display:none", "script", "style>", "\n", " ", "Evil"]) assert.ok(!css.includes(piece), `${piece} must not reach the rule`);
  }
  assert.notEqual(faceClassOf("Maya Chen"), faceClassOf("Omar Haddad"));
  const png = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(safeBitmapUrl(png), png);
  for (const bad of ["data:image/png;base64,AAA\") ;} body{x:y", "javascript:alert(1)", "https://evil.example/x.png", "data:image/svg+xml;utf8,<svg/>", "", undefined]) assert.equal(safeBitmapUrl(bad), null, String(bad));
  assert.ok(faceRule("Maya Chen", png).includes(`url("${png}")`));
  assert.ok(!faceRule("Maya Chen", "javascript:alert(1)").includes("javascript"));
});

test("a cell face is seeded by the person's id: two people called Maya Chen have two faces, and a rename keeps the face", async () => {
  const { faceClassOf, faceRule } = await import("../table/model.ts");
  assert.notEqual(faceClassOf("usr_maya_1"), faceClassOf("usr_maya_2"), "two ids, two faces, whatever they are called");
  assert.notEqual(faceRule("usr_maya_1"), faceRule("usr_maya_2"));
  assert.equal(faceRule("usr_maya_1"), faceRule("usr_maya_1"), "one id always gets the same face, so a rename changes nothing");
});
