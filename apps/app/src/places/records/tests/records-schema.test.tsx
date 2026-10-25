// @reads ../../../../../../scripts/shots/mounts/P-L9d_07.tsx
// Records > Schema map and Record types (P-L9d_07): the map draws a card per type with its links and has no editing controls; the list is rows that open a type and a line that says
// structure lives in the Console. Screens render through react-dom/server over react-native-web from the sample Space's replica.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import {
  CARD_W, RecordTypesList, SchemaDataProvider, SchemaMap, bounds, cardDim, cardHeight, edgeGeometry, emphasis, fieldRows, fitView, layout, miniGo, miniModel, moreCount, neighbor, shownCount,
  summary, typeTag, zoomAt, ZMAX, ZMIN,
} from "../schemamap/index.ts";
import type { MapEdge, MapNode, Rect } from "../schemamap/index.ts";
import { createSampleSchema, harbor, northwind, northwindEdges, northwindTypes } from "../schemamap/sample.ts";
import type { SampleSchema } from "../schemamap/sample.ts";

const html = (s: SampleSchema, el: ReactElement): string => renderToStaticMarkup(<SchemaDataProvider value={s.data}>{el}</SchemaDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
/** The text inside the element with this test id. */
const textOf = (s: string, id: string): string | null => new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`).exec(s)?.[1] ?? null;
const titleOf = (t: string): string => (northwindTypes.find((x) => x.key === t)?.plural ?? t);

const map = (s: SampleSchema, props: Parameters<typeof SchemaMap>[0] = {}): string => html(s, <SchemaMap details={s.details} {...props} />);

test("a card lists the title field first, then the links, then the rest; links read Link to and Linked from", () => {
  const clients = northwindTypes.find((t) => t.key === "clients")!;
  const rows = fieldRows("clients", northwindEdges, titleOf, clients);
  assert.equal(rows[0]?.key, "name", "the title field leads");
  assert.deepEqual(rows.slice(1, 4).map((r) => r.key), ["projects", "invoices", "meetings"], "then the links, in the order the type has them");
  assert.equal(rows[1]?.typeLabel, "Link to Projects");
  assert.equal(rows.find((r) => r.key === "email")?.typeLabel, "Email");
  assert.equal(rows.find((r) => r.key === "balance")?.symbol, "Σ");
  const tasks = fieldRows("tasks", northwindEdges, titleOf, northwindTypes.find((t) => t.key === "tasks"));
  const project = tasks.find((r) => r.key === "project")!;
  assert.equal(project.typeLabel, "Linked from Projects");
  assert.equal(project.outgoing, false);
  const bare = fieldRows("clients", northwindEdges, titleOf, undefined);
  assert.deepEqual(bare.map((r) => r.key), ["projects", "invoices", "meetings"], "before the details load the card shows the links the map knows");
});

test("five fields show, the rest sit behind +N more, and the card is as tall as its rows", () => {
  assert.equal(shownCount(10, false), 5);
  assert.equal(shownCount(10, true), 10);
  assert.equal(moreCount(10), 5);
  assert.equal(moreCount(3), 0);
  assert.equal(cardHeight(3, false), 40 + 3 * 26 + 6);
  assert.equal(cardHeight(10, false), 40 + 5 * 26 + 28);
  assert.equal(cardHeight(10, true), 40 + 10 * 26 + 28);
});

test("the starting layout places every card, none on top of another, the same way every time", () => {
  const nodes: MapNode[] = northwindTypes.map((t) => ({ type: t.key, title: t.plural, rowCount: 1 }));
  const heights = new Map(northwindTypes.map((t) => [t.key, cardHeight(t.fields.length, false)] as const));
  const a = layout(nodes, northwindEdges, heights);
  const b = layout(nodes, northwindEdges, heights);
  assert.deepEqual([...a], [...b]);
  assert.equal(a.size, 7);
  const rects: Rect[] = nodes.map((n) => ({ x: a.get(n.type)![0], y: a.get(n.type)![1], w: CARD_W, h: heights.get(n.type)! }));
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const p = rects[i]!, q = rects[j]!;
      assert.ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, `cards ${i} and ${j} overlap`);
    }
  }
});

test("a curve leaves the link field on the side facing its target: dot at the source, crow's foot at the many side, bar at the one side", () => {
  const e: MapEdge = { from: "clients", to: "projects", field: "projects", inverse: "client" };
  const from: Rect = { x: 0, y: 0, w: 232, h: 200 }, right: Rect = { x: 400, y: 50, w: 232, h: 200 }, left: Rect = { x: -400, y: 50, w: 232, h: 200 };
  const g = edgeGeometry(e, from, right, 1, 5);
  assert.deepEqual(g.dot, [232, 40 + 26 + 13]);
  assert.ok(g.d.startsWith("M232 79 C"), g.d);
  assert.ok(g.d.endsWith("400 70"), g.d);
  assert.ok(g.crow.startsWith("M245 79 L232 73.5"), g.crow);
  assert.ok(g.bar.startsWith("M389 64.5"), g.bar);
  const back = edgeGeometry(e, from, left, 1, 5);
  assert.deepEqual(back.dot, [0, 79]);
  const hidden = edgeGeometry(e, from, right, 7, 5);
  assert.equal(hidden.dot[1], 20, "a link field behind +N more leaves from the card's head");
});

test("hovering or selecting a type lights its links and dims the rest", () => {
  assert.equal(emphasis(null, northwindEdges[0]!), "idle");
  assert.equal(emphasis("clients", northwindEdges[0]!), "hot");
  assert.equal(emphasis("tasks", northwindEdges[0]!), "dim");
  assert.equal(cardDim(null, "tasks", northwindEdges), false);
  assert.equal(cardDim("projects", "tasks", northwindEdges), false, "tasks is linked to projects");
  assert.equal(cardDim("projects", "hires", northwindEdges), true);
  assert.equal(cardDim("projects", "projects", northwindEdges), false);
});

test("fit shows every card; zoom keeps the point under the pointer still and stays within its limits", () => {
  const rects: Rect[] = [{ x: 70, y: 40, w: 232, h: 200 }, { x: 430, y: 300, w: 232, h: 200 }];
  const v = fitView(rects, 1000, 700);
  const b = bounds(rects)!;
  assert.ok(v.k <= 1.1 && v.k >= ZMIN);
  assert.ok(b.x * v.k + v.x >= 0 && (b.x + b.w) * v.k + v.x <= 1000, "inside horizontally");
  assert.ok(b.y * v.k + v.y >= 0 && (b.y + b.h) * v.k + v.y <= 700, "inside vertically");
  const z = zoomAt({ k: 1, x: 10, y: 20 }, 2, 300, 200);
  assert.equal(z.k, 2);
  assert.equal((300 - z.x) / z.k, (300 - 10) / 1, "the canvas point under the pointer is unchanged");
  assert.equal(zoomAt({ k: 2, x: 0, y: 0 }, 10, 0, 0).k, ZMAX);
  assert.equal(zoomAt({ k: 0.4, x: 0, y: 0 }, 0.01, 0, 0).k, ZMIN);
  assert.deepEqual(fitView([], 1000, 700), { k: 1, x: 0, y: 0 });
});

test("arrow keys move to the nearest card that way; the minimap centres the view where it is pressed", () => {
  const rects = new Map<string, Rect>([["a", { x: 0, y: 0, w: 232, h: 100 }], ["b", { x: 400, y: 10, w: 232, h: 100 }], ["c", { x: 20, y: 300, w: 232, h: 100 }]]);
  assert.equal(neighbor(rects, "a", "right"), "b");
  assert.equal(neighbor(rects, "a", "down"), "c");
  assert.equal(neighbor(rects, "a", "left"), "a", "nothing to the left keeps the selection");
  assert.equal(neighbor(rects, null, "right"), "a", "with nothing selected the first card is chosen");
  const v = { k: 1, x: 0, y: 0 };
  const m = miniModel(rects, v, 800, 500);
  assert.equal(m.cards.length, 3);
  const centred = miniGo(m, 84, 54, v, 800, 500);
  assert.equal(centred.k, 1);
  assert.ok(Math.abs(centred.x + (84 / m.s + m.x0) - 400) < 1e-6, "the pressed spot lands in the middle of the canvas");
});

test("the map draws a card for every type with its record count and its fields, and a curve for every link", () => {
  const out = map(createSampleSchema());
  for (const t of northwindTypes) {
    assert.ok(has(out, `data-testid="schema-card-${t.key}"`), t.key);
    assert.ok(has(out, `>${t.plural}<`), `${t.plural} heading`);
  }
  assert.equal(textOf(out, "schema-count-clients"), "38");
  assert.equal(textOf(out, "schema-count-messages"), "420");
  assert.ok(has(out, "Link to Projects") && has(out, "Linked from Projects") && has(out, "Link to Clients"));
  assert.equal(out.split('data-edge="').length - 1, northwindEdges.length, "one curve per link");
  assert.ok(has(out, 'data-edge="clients&gt;projects"') && has(out, 'data-edge="messages&gt;clients"'));
  assert.equal(textOf(out, "schema-map-summary"), "7 tables · 45 fields");
  assert.ok(has(out, "+5 more") && has(out, 'data-testid="schema-more-clients"'), "Clients has ten fields, five show");
  assert.ok(!has(out, 'data-testid="schema-more-hires"'), "Hires has four, none hidden");
});

test("an expanded card shows all its fields and offers Show fewer", () => {
  const out = map(createSampleSchema(), { expanded: ["clients"] });
  assert.ok(has(out, 'data-testid="field-clients-since"') && has(out, "Show fewer"));
  const closed = map(createSampleSchema());
  assert.ok(!has(closed, 'data-testid="field-clients-since"'));
});

test("the map is read only: no New table, no Journey, no delete, no add link, no drag handles; the only way out is the Console", () => {
  const out = map(createSampleSchema());
  for (const word of ["New table", "New Journey", "Delete", "Add relation", "Rename", "Workspace per record", "Drag to another table"]) assert.ok(!has(out, word), word);
  assert.ok(has(out, "Edit in the Console") && has(out, 'data-testid="schema-map-console"'));
  assert.ok(has(out, 'aria-label="Zoom in"') && has(out, 'aria-label="Zoom out"') && has(out, 'aria-label="Fit to screen"'));
  assert.ok(has(out, 'data-testid="schema-minimap"'));
  assert.ok(has(out, 'aria-label="Schema map. Arrow keys move between tables, Enter opens one."'));
});

test("selecting a type lights its links, dims the others, and dims the cards it is not linked to", () => {
  const out = map(createSampleSchema(), { selected: "projects" });
  const hot = out.split('data-emphasis="hot"').length - 1;
  const dimmed = out.split('data-emphasis="dim"').length - 1;
  assert.equal(hot, 3, "projects is on the ends of three links: from clients, to tasks, to invoices");
  assert.equal(dimmed, northwindEdges.length - 3);
  assert.equal(out.split('aria-selected="true"').length - 1, 1, "exactly the selected card says so, to screen readers too");
  assert.ok(has(out, 'role="listbox"') && has(out, 'role="option"'), "the cards are the options of the map's listbox");
  assert.ok(has(out, 'aria-label="Projects, 12 records"'));
});

test("a smaller Space draws on its own: Harbor Studio with three types and two links", () => {
  const s = createSampleSchema(harbor);
  const out = map(s);
  assert.equal(textOf(out, "schema-map-summary"), "3 tables · 10 fields");
  assert.equal(out.split('data-edge="').length - 1, 2);
});

test("a new type added to the Space shows up on the map and in the list", () => {
  const s = createSampleSchema();
  s.addType({ key: "referrals", title: "Referral", plural: "Referrals", icon: "referrals", label: "internal", system: false, titleField: "source", fields: [{ key: "source", type: "text", title: "Source" }, { key: "client", type: "relation", title: "Client" }], version: 1 }, 6, [{ from: "referrals", to: "clients", field: "client" }]);
  const out = map(s);
  assert.ok(has(out, 'data-testid="schema-card-referrals"') && has(out, 'data-edge="referrals&gt;clients"'));
  assert.equal(textOf(out, "schema-map-summary"), "8 tables · 47 fields");
  assert.ok(has(html(s, <RecordTypesList />), 'data-testid="row-type:referrals"'));
});

test("Record types: a Row per type with its records and fields, where it comes from, a chevron; no New button; a line says it is managed in the console", () => {
  const s = createSampleSchema(northwind, { withSynced: true });
  const out = html(s, <RecordTypesList />);
  for (const t of northwindTypes) assert.ok(has(out, `data-testid="row-type:${t.key}"`), t.key);
  assert.ok(has(out, "38 records · 10 fields") && has(out, "2 records · 4 fields"));
  assert.ok(has(out, 'data-testid="row-type:clients-leading"') && has(out, 'data-testid="row-type:clients-trailing"'), "ui/Row with its slots");
  assert.equal(textOf(out, "type-tag-clients"), "Built in");
  assert.equal(textOf(out, "type-tag-hires"), "Synced from HubSpot");
  assert.ok(!has(out, "New record type") && !has(out, "New table") && !has(out, "Add a type"));
  assert.ok(has(out, "Record types are managed in the console") && has(out, 'data-testid="record-types-console"'));
  assert.deepEqual(typeTag({ system: false }), null);
  assert.deepEqual(typeTag({ system: true }), { kind: "plain", text: "Built in" });
  assert.deepEqual(typeTag({ system: false, group: "Sites" }), { kind: "plain", text: "Site table" });
});

test("counts read in words", () => {
  assert.equal(summary(1, 3), "1 table · 3 fields");
  assert.equal(summary(2, 1), "2 tables · 1 field");
  assert.equal(summary(4, null), "4 tables");
});
