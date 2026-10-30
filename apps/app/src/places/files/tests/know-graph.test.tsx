// Files > Knowledge > Graph over the Northwind sample (the approved mockup's graph): "Around <subject>" and "Whole Space" ask memory.graph the way the mockup does, the header, the stat line, the legend, the
// slider and the evidence card draw as designed, an edge's evidence opens its chat through the shell, the Layers and Types menus carry checkmarks and counts and never list Personal, right-click menus
// and keys do what they say, and the pure helpers (camera, labels, hit grid, layout, route) are right. The canvas itself is drawn in a browser; the screenshots and the speed budget cover it.
import test from "node:test";
import assert from "node:assert/strict";
import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryDataProvider } from "../memory/index.ts";
import { Evidence, MemoryGraph, NodeCard } from "../memory/MemoryGraph.tsx";
import type { MemoryData } from "../memory/index.ts";
import { KNOW_NOW, createKnowSample, pageIdOf } from "../memory/sample-know.ts";
import type { KnowSample } from "../memory/sample-know.ts";
import {
  ALL_LAYERS, DAY, EDGE_LABELS_MAX, GRAPH_LAYERS, HOPS, HitGrid, KINDS, LAYER_MENU, NODE_LABELS_MAX, SLIDER_DAYS, WORLD, ZOOM_MAX, ZOOM_MIN, asOfOf, backgroundMenu, buildGrid, centreOn, clipSeg, degrees, dropOrphans,
  edgeByKey, edgeKey, edgeMenu, filterBanner, firstName, fitCam, graphRoute, hitAt, hopsFrom, keyAction, kindColor, kindCounts, kindHex, labelPlan, layerCounts, layerMenu, layoutAround, legendMenu, moreMenu,
  nextTab, nodeMenu, nodeRadius, pageOf, panBy, pickPages, segDistance, shown, sliderText, sliderTicks, startSubject, statLine, toScreen, toWorld, toggleKindSet, typeMenu, zoomAt,
} from "../memory/model.ts";
import type { GraphOut, KGEdge, KGNode } from "../memory/model.ts";

const has = (s: string, needle: string): boolean => s.includes(needle);
const count = (s: string, needle: string): number => s.split(needle).length - 1;
const text = (html: string): string => html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
/** The attribute text of an edge id: `>` is escaped in markup. */
const esc = (id: string): string => id.replaceAll(">", "&gt;");
type Asked = { cap: string; input: Record<string, unknown> };

/** The screen over the sample, and every live read it asked (the capability and its input). */
function screen(props: Record<string, unknown> = {}, s: KnowSample = createKnowSample()): { html: string; asked: Asked[]; s: KnowSample } {
  const asked: Asked[] = [];
  const data: MemoryData = { ...s.data, live: ((cap: string, input: Record<string, unknown>) => { asked.push({ cap, input }); return (s.data.live as (c: string, i: unknown) => unknown)(cap, input); }) as MemoryData["live"] };
  const html = renderToStaticMarkup(<MemoryDataProvider value={data}><MemoryGraph {...props} /></MemoryDataProvider>).replaceAll("<!-- -->", "");
  return { html, asked, s };
}
const graphAsks = (a: Asked[]): Record<string, unknown>[] => a.filter((x) => x.cap === "memory.graph").map((x) => x.input);
const read = (s: KnowSample, input: Record<string, unknown>): GraphOut => {
  const snap = s.data.live("memory.graph", input as never).getSnapshot();
  assert.equal(snap.status, "ready");
  return (snap as { data: GraphOut }).data;
};
const at = (s: string, needle: string): number => { const i = s.indexOf(needle); assert.ok(i >= 0, needle); return i; };

/** Every element of a rendered tree (a function component is not expanded) with a given testID. */
function walk(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) { for (const c of node) walk(c, out); return out; }
  if (!isValidElement(node)) return out;
  out.push(node);
  walk((node.props as { children?: ReactNode }).children, out);
  return out;
}
const byTestId = (tree: ReactNode, id: string): ReactElement | undefined => walk(tree).find((e) => (e.props as { testID?: string }).testID === id);
const press = (el: ReactElement | undefined): void => { assert.ok(el, "the element is there"); (el.props as { onPress: () => void }).onPress(); };

const IAN = pageIdOf("ian"), CADENCE = pageIdOf("cadence");

// ---------------------------------------------------------------- the data the screen asks for

test("the sample's graph: around Ian is ten nodes and thirteen links two hops out, each link with its label, quote, source and day", () => {
  const s = createKnowSample();
  const g = read(s, { scope: "space", focus: IAN, hops: HOPS });
  assert.equal(g.nodes.length, 10);
  assert.equal(g.edges.length, 13);
  const prefers = g.edges.find((e) => e.from === IAN && e.to === CADENCE) as KGEdge;
  assert.equal(prefers.label, "prefers");
  assert.equal(prefers.evidence, "Ian told me today he prefers updates on Fridays.");
  assert.equal(prefers.source?.title, "Brooks weekly update");
  assert.equal(prefers.source?.kind, "chat");
  assert.match(prefers.source?.link ?? "", /^vyre:\/\/thread\/thr_k2\?m=/);
  assert.equal(prefers.at, Date.UTC(2025, 9, 24, 9));
  assert.ok(g.nodes.every((n) => n.layer !== "person"), "no personal node reaches the screen");
});

test("the Whole Space is every node; a date takes away what was born after it; layers and kinds narrow it", () => {
  const s = createKnowSample();
  const all = read(s, { scope: "space" });
  assert.equal(all.nodes.length, 24);
  const past = read(s, { scope: "space", asOf: asOfOf(22, KNOW_NOW) as number });
  assert.ok(past.nodes.length < all.nodes.length && past.edges.length < all.edges.length);
  assert.ok(!past.nodes.some((n) => n.title === "Rivera intake"), "that chat began on Oct 24");
  assert.ok(past.nodes.some((n) => n.title === "Brooks kickoff"), "this one began on Oct 12");
  assert.ok(past.edges.every((e) => (e.at ?? 0) <= (asOfOf(22, KNOW_NOW) as number)), "an edge born later is gone");
  const people = read(s, { scope: "space", kinds: ["person"] });
  assert.ok(people.nodes.length > 0 && people.nodes.every((n) => n.kind === "person"));
  const agentLayer = read(s, { scope: "space", layers: ["agent"] });
  assert.ok(agentLayer.nodes.length > 0 && agentLayer.nodes.every((n) => n.layer === "agent"));
});

// ---------------------------------------------------------------- the screen: around, whole, the header

test("opens Around the first page: memory.graph with that focus and two hops, no date, the stat line, the header and the controls", () => {
  const { html, asked } = screen();
  const asks = graphAsks(asked);
  assert.ok(asks.length > 0 && asks.every((i) => i.scope === "space" && i.focus === IAN && i.hops === 2 && !("asOf" in i) && !("layers" in i) && !("kinds" in i)), JSON.stringify(asks));
  assert.ok(asked.some((x) => x.cap === "memory.page.list"), "the first page comes from the page list");
  assert.ok(has(html, 'data-testid="memory-graph"') && has(html, 'data-testid="graph-surface"') && has(html, 'data-testid="graph-canvas"'));
  assert.ok(has(html, ">10 nodes · 13 links · around Ian Brooks, two hops<"), text(html));
  assert.ok(has(html, ">Knowledge<") && has(html, ">Graph<") && has(html, 'data-testid="graph-subject"') && has(html, ">Ian Brooks<") && has(html, 'data-testid="know-search"'), "Knowledge > Graph > the subject chip, and the one Search knowledge field");
  assert.ok(has(html, ">Around Ian<") && has(html, ">Whole Space<") && has(html, 'data-testid="scope-around"') && has(html, 'data-testid="scope-space"'));
  for (const id of ["graph-layers", "graph-kinds", "graph-more", "graph-slider", "zoom-in", "zoom-out", "zoom-fit", "graph-legend", "graph-time"]) assert.ok(has(html, `data-testid="${id}"`), id);
  assert.ok(!has(html, 'data-testid="graph-find"') && !has(html, 'data-testid="graph-export"'), "Find is the Search field and Export is in the ... menu");
  assert.ok(has(html, 'aria-label="Layers"') && has(html, ">Layers<") && has(html, ">Types<"), "quiet header buttons, no pill chips");
  assert.ok(!has(html, "sigma") && !has(html, String.fromCharCode(0x2014)) && !has(html, String.fromCharCode(0xa7)), "no sigma, no em dash, no section sign");
});

test("Whole Space asks without a focus, names the Space in the breadcrumb and says so in the stat line", () => {
  const { html, asked } = screen({ focus: IAN, around: false });
  assert.ok(graphAsks(asked).every((i) => !("focus" in i) && !("hops" in i)), JSON.stringify(graphAsks(asked)));
  assert.ok(has(html, ">24 nodes · 26 links · the whole Space<"));
  assert.ok(has(html, 'data-testid="graph-space"') && !has(html, 'data-testid="graph-subject"'), "the chip is the Space's name, not a picker");
  assert.ok(has(html, ">Around Ian<"), "the subject is kept: pressing Around goes back to it");
  assert.equal(count(html, 'data-testid="gnode-'), 24);
});

test("a given focus is the subject (and the old scope name still reaches the whole Space)", () => {
  const e = screen({ focus: pageIdOf("elena") });
  assert.ok(graphAsks(e.asked).every((i) => i.focus === pageIdOf("elena")) && has(e.html, ">Around Elena<") && has(e.html, "around Elena Rivera, two hops"), text(e.html));
  const old = screen({ scope: "space" });
  assert.ok(graphAsks(old.asked).every((i) => !("focus" in i)) && has(old.html, "the whole Space"));
});

test("a page that has the person's own name is the page it opens on, ahead of the first", () => {
  const pages = [{ pageId: "a", title: "Ian Brooks", kind: "client", ownerRef: "x" }, { pageId: "me", title: "Irfad Imtiaz", kind: "person", ownerRef: "usr_irfad" }];
  assert.equal(startSubject(pages, { id: "usr_irfad", name: "Irfad Imtiaz" }), "me");
  assert.equal(startSubject(pages, { id: "usr_other", name: "Nobody" }), "a", "else the first page");
  assert.equal(startSubject(pages), "a");
  assert.equal(startSubject([]), undefined);
});

test("the nodes and the links are also lists a screen reader walks: typed, with each link read as a sentence, and no personal node", () => {
  const { html } = screen();
  assert.equal(count(html, 'data-testid="gnode-'), 10);
  assert.ok(has(html, 'data-kind="client"') && has(html, 'data-kind="chat"') && has(html, 'data-kind="agent"') && has(html, 'data-kind="topic"') && has(html, 'data-kind="record"'));
  assert.ok(has(html, 'aria-label="Ian Brooks, Clients, ') && has(html, 'aria-label="Brooks kickoff, Chats, '));
  assert.equal(count(html, 'data-testid="gedge-'), 13);
  assert.ok(has(html, `data-testid="gedge-${esc(`${IAN}>${CADENCE}`)}"`) && has(html, 'aria-label="Ian Brooks prefers Client update cadence"'));
  assert.ok(has(html, 'aria-label="Brooks kickoff about Ian Brooks"'), "a chat's edge is read from the chat to the person");
});

// ---------------------------------------------------------------- the legend, the slider

test("the legend counts what is drawn, one row per type the Space has, chats as the rounded kind", () => {
  const { html } = screen();
  const row = (k: string): string => text(new RegExp(`data-testid="legend-${k}" type="button">(.*?)</button>`).exec(html)![1]!).split("|").filter(Boolean).join(" ");
  assert.equal(row("person"), "People 2");
  assert.equal(row("client"), "Clients 1");
  assert.equal(row("project"), "Projects 1");
  assert.equal(row("topic"), "Topics 1");
  assert.equal(row("agent"), "Agents 2");
  assert.equal(row("record"), "Records 1");
  assert.equal(row("chat"), "Chats 2");
  assert.ok(!has(html, 'data-testid="legend-note"') && !has(html, 'data-testid="legend-decision"'), "a type the Space does not have has no row");
  assert.equal(count(html, 'data-testid="legend-'), 7);
  assert.ok(has(html, 'aria-label="Chats, 2"') && has(html, 'role="button"'), "a row is a button: pressing it toggles that type");
  const whole = screen({ around: false }).html;
  assert.ok(has(whole, 'aria-label="People, 4"') && has(whole, 'aria-label="Chats, 4"'), "the counts follow what is drawn");
});

test("What we know now: the label, the range, the dates computed from the clock, and Back to now once it is moved", () => {
  const now = screen().html;
  assert.ok(has(now, ">What we know now<") && !has(now, 'data-testid="graph-now"') && has(now, 'type="range"') && has(now, 'max="30"') && has(now, 'value="30"'));
  for (const d of ["Oct 1", "Oct 8", "Oct 16", "Today"]) assert.ok(has(now, `>${d}<`), d);
  assert.deepEqual(sliderTicks(KNOW_NOW), [{ label: "Oct 1", step: 7 }, { label: "Oct 8", step: 14 }, { label: "Oct 16", step: 22 }, { label: "Today", step: 30 }]);
  const later = sliderTicks(KNOW_NOW + 6 * DAY).map((t) => t.label);
  assert.deepEqual(later, ["Oct 7", "Oct 14", "Oct 22", "Today"], "the ticks move with the clock");
  const back = screen({ step: 18, around: false });
  const asOf = asOfOf(18, KNOW_NOW) as number;
  assert.ok(graphAsks(back.asked).every((i) => i.asOf === asOf), "moving it asks again with that date");
  assert.ok(has(back.html, `>What we knew on ${sliderText(18, KNOW_NOW)}<`) && has(back.html, "What we knew on Oct 12") && has(back.html, 'data-testid="graph-now"') && has(back.html, ">Back to now<") && has(back.html, 'value="18"'));
  assert.ok(!has(back.html, "Rivera intake") && has(back.html, "Brooks kickoff"), "nodes born after the date vanish");
  const around = screen({ step: 10 });
  assert.ok(graphAsks(around.asked).every((i) => i.focus === IAN && i.asOf === asOfOf(10, KNOW_NOW)), "around keeps its subject while the date moves");
});

// ---------------------------------------------------------------- the evidence card

test("an edge in the route opens its evidence: from, the label, to, the words, the source, the day, Open the chat, a way to close it", () => {
  const { html } = screen({ edge: `${IAN}>${CADENCE}` });
  const card = html.slice(at(html, 'data-testid="graph-evidence"'));
  assert.ok(has(card, "Ian Brooks") && has(card, ">prefers<") && has(card, "Client update cadence"), "From, the label in the accent, To");
  assert.ok(has(card, "“Ian told me today he prefers updates on Fridays.”") && has(card, 'data-testid="graph-evidence-quote"'), "the quote");
  assert.ok(/data-testid="graph-evidence-quote"/.test(card) && /r-borderLeftWidth[^"]*" data-testid="graph-evidence-quote"/.test(card), "with its bar on the left");
  assert.ok(has(card, 'data-testid="graph-evidence-source"') && has(card, ">Brooks weekly update<"), "the source chip");
  assert.ok(has(card, 'data-testid="graph-evidence-date"') && has(card, ">Today<"), "the day");
  assert.ok(has(card, 'data-testid="graph-evidence-open"') && has(card, ">Open the chat<"));
  assert.ok(has(card, 'data-testid="graph-evidence-close"') && has(card, 'aria-label="Close"'));
  assert.equal(count(html, 'data-testid="graph-evidence"'), 1);
  assert.ok(!has(html, 'data-testid="graph-selected"'), "the card of a node is not drawn under it");
  assert.ok(has(html, `aria-selected="true" aria-label="Ian Brooks prefers Client update cadence"`), "the link says it is selected to a screen reader");
  assert.ok(!has(screen().html, 'data-testid="graph-evidence"'), "no edge, no card");
  assert.ok(!has(screen({ edge: "nope>nothing" }).html, 'data-testid="graph-evidence"'), "an edge that is not in the picture shows nothing");
});

test("Open the chat goes through nav.openChat with the edge's link; the chip does too; close and the other buttons are real", () => {
  const s = createKnowSample();
  const g = read(s, { scope: "space", focus: IAN, hops: HOPS });
  const edge = edgeByKey(g.edges as KGEdge[], `${IAN}>${CADENCE}`)!;
  let closed = 0;
  const tree = Evidence({ edge, from: "Ian Brooks", to: "Client update cadence", now: KNOW_NOW, onClose: () => { closed += 1; }, data: s.data });
  press(byTestId(tree, "graph-evidence-open"));
  press(byTestId(tree, "graph-evidence-source"));
  press(byTestId(tree, "graph-evidence-close"));
  assert.deepEqual(s.opened, [`chat:${edge.source!.link}`, `chat:${edge.source!.link}`]);
  assert.equal(closed, 1);
  // a channel has no chat to open: the source is named, there is no button
  const channel = edgeByKey(g.edges as KGEdge[], `${pageIdOf("omar")}>${IAN}`)!;
  assert.equal(channel.source?.kind, "channel");
  const t2 = Evidence({ edge: channel, from: "Omar Haddad", to: "Ian Brooks", now: KNOW_NOW, onClose: () => undefined, data: s.data });
  assert.ok(byTestId(t2, "graph-evidence-source") && !byTestId(t2, "graph-evidence-open"));
});

test("a selected node shows its card: kind, links, Show around this, Open page or Open the chat", () => {
  const node: KGNode = { nodeId: IAN, kind: "client", title: "Ian Brooks", layer: "space" };
  let acts: string[] = [];
  const mk = (n: KGNode, o: { canFocus: boolean; page: boolean }): ReactElement => NodeCard({ node: n, links: 6, canFocus: o.canFocus, page: o.page, onFocus: () => acts.push("focus"), onOpen: () => acts.push("open"), onClose: () => acts.push("close") });
  const a = mk(node, { canFocus: true, page: true });
  press(byTestId(a, "graph-selected-focus")); press(byTestId(a, "graph-selected-open")); press(byTestId(a, "graph-selected-close"));
  assert.deepEqual(acts, ["focus", "open", "close"]);
  assert.ok(has(renderToStaticMarkup(a), ">6 links<") && has(renderToStaticMarkup(a), ">Client<"));
  assert.ok(has(renderToStaticMarkup(mk({ nodeId: "pg_o", kind: "person", title: "Omar Haddad" }, { canFocus: true, page: true })), ">Person<"), "one person, not People");
  acts = [];
  const chat = mk({ nodeId: "chat-k1", kind: "chat", title: "Brooks kickoff", link: "vyre://thread/thr_k1" }, { canFocus: false, page: false });
  assert.ok(has(renderToStaticMarkup(chat), ">Open the chat<") && !byTestId(chat, "graph-selected-focus"));
  const none = mk({ nodeId: "rec", kind: "record", title: "Brooks Logistics" }, { canFocus: false, page: false });
  assert.ok(!byTestId(none, "graph-selected-open"), "a record with no page and no chat has nothing to open");
});

// ---------------------------------------------------------------- menus, keys, route

test("Layers: Space, Project, Agent with checkmarks and counts, never Personal, and a note that Personal is private", () => {
  let log: string[] = [];
  const entries = layerMenu(new Set(["space", "agent"]), { space: 6, project: 3, agent: 1 }, { toggle: (l) => log.push(`toggle ${l}`), all: () => log.push("all") });
  const items = entries.filter((e): e is Extract<typeof e, { label: string }> => "label" in e);
  assert.deepEqual(items.map((e) => [e.label, e.checked, e.count]).slice(0, 3), [["Space", true, 6], ["Project", false, 3], ["Agent", true, 1]]);
  assert.ok(!items.some((e) => e.label === "Personal"), "Personal is not a row");
  assert.ok(entries.some((e) => "head" in e && e.head === "Personal is private and never shown"));
  for (const e of items) e.onSelect?.();
  assert.deepEqual(log, ["toggle space", "toggle project", "toggle agent", "all"]);
  assert.deepEqual([...LAYER_MENU], ["space", "project", "agent"]);
  assert.deepEqual([...GRAPH_LAYERS].sort(), [...LAYER_MENU].sort());
});

test("Types: every kind with a checkmark and a count (none chosen is all on), Show all types", () => {
  const counts = new Map(kindCounts(read(createKnowSample(), { scope: "space", focus: IAN, hops: 2 }).nodes));
  const on: string[] = [];
  const all = typeMenu(new Set(), counts, { toggle: (k) => on.push(k), all: () => on.push("all") }).filter((e): e is Extract<typeof e, { label: string }> => "label" in e);
  assert.deepEqual(all.slice(0, 7).map((e) => [e.label, e.checked, e.count]), [["People", true, 2], ["Clients", true, 1], ["Projects", true, 1], ["Topics", true, 1], ["Agents", true, 2], ["Records", true, 1], ["Chats", true, 2]]);
  assert.deepEqual(all.slice(7, 10).map((e) => e.label), ["Notes", "Decisions", "Sites"], "plus the older kinds");
  const some = typeMenu(new Set(["chat"]), counts, { toggle: () => undefined, all: () => undefined }).filter((e): e is Extract<typeof e, { label: string }> => "label" in e);
  assert.deepEqual(some.filter((e) => e.checked).map((e) => e.label), ["Chats"]);
  for (const e of all) e.onSelect?.();
  assert.deepEqual(on.slice(0, 2), ["person", "client"]);
  assert.equal(on.at(-1), "all");
});

test("a type pressed in the legend or the menu is the same state: from all on it turns that one off; the rest flip", () => {
  const off = toggleKindSet(new Set(), "chat");
  assert.ok(!off.has("chat") && off.size === KINDS.length - 1);
  const back = toggleKindSet(off, "chat");
  assert.equal(back.size, KINDS.length);
  assert.equal(toggleKindSet(new Set(["chat"]), "chat").size, 0, "the last one off leaves the set empty, which is every type on");
  assert.equal(filterBanner(new Set(["agent", "project", "space"]), new Set()), "");
  assert.equal(filterBanner(ALL_LAYERS, off), "Hiding Chats");
  assert.equal(filterBanner(new Set(["space"]), new Set()), "Showing Space");
  assert.equal(filterBanner(new Set(["space", "project"]), new Set()), "Hiding Agent");
  assert.equal(filterBanner(ALL_LAYERS, new Set(["person", "client"])), "Showing People, Clients");
});

test("right-click a node: Open page, Show around this, Open in Chats, Copy name; each item does its thing", () => {
  const log: string[] = [];
  const on = { open: () => log.push("open"), around: () => log.push("around"), chats: () => log.push("chats"), copy: () => log.push("copy") };
  const labels = (n: KGNode, o: { page: boolean; subject: boolean }): string[] => nodeMenu(n, o, on).filter((e): e is Extract<typeof e, { label: string }> => "label" in e).map((e) => e.label);
  assert.deepEqual(labels({ nodeId: "p", kind: "person", title: "Maya Chen" }, { page: true, subject: false }), ["Open page", "Show around this", "Copy name"]);
  assert.deepEqual(labels({ nodeId: "p", kind: "client", title: "Ian Brooks" }, { page: true, subject: true }), ["Open page", "Copy name"], "the subject is already the centre");
  assert.deepEqual(labels({ nodeId: "c", kind: "chat", title: "Brooks kickoff", link: "vyre://thread/thr_k1" }, { page: false, subject: false }), ["Open in Chats", "Copy name"]);
  assert.deepEqual(labels({ nodeId: "r", kind: "record", title: "Brooks Logistics" }, { page: false, subject: false }), ["Copy name"]);
  for (const e of nodeMenu({ nodeId: "c", kind: "chat", title: "x", link: "l" }, { page: true, subject: false }, on)) if ("onSelect" in e) e.onSelect?.();
  assert.deepEqual(log, ["open", "around", "chats", "copy"]);
});

test("right-click an edge: Show evidence, Copy quote; the background: Fit, the other scope, Back to now, Show all; a legend row; the ... menu", () => {
  const log: string[] = [];
  const e: KGEdge = { from: "a", to: "b", kind: "relation", label: "prefers", evidence: "the words" };
  const items = (m: ReturnType<typeof edgeMenu>): { label: string; onSelect?: () => void }[] => m.filter((x): x is Extract<typeof x, { label: string }> => "label" in x);
  assert.deepEqual(items(edgeMenu(e, { evidence: () => log.push("ev"), copy: () => log.push("copy") })).map((x) => x.label), ["Show evidence", "Copy quote"]);
  assert.deepEqual(items(edgeMenu({ ...e, evidence: undefined }, { evidence: () => undefined, copy: () => undefined })).map((x) => x.label), ["Show evidence"], "no quote, nothing to copy");
  const bgOn = { fit: () => log.push("fit"), scope: () => log.push("scope"), now: () => log.push("now"), reset: () => log.push("reset") };
  assert.deepEqual(items(backgroundMenu({ around: true, subject: "Ian Brooks", past: false, narrowed: false }, bgOn)).map((x) => x.label), ["Fit to screen", "Show the whole Space"]);
  assert.deepEqual(items(backgroundMenu({ around: false, subject: "Ian Brooks", past: true, narrowed: true }, bgOn)).map((x) => x.label), ["Fit to screen", "Show around Ian Brooks", "Back to now", "Show all layers and types"]);
  assert.deepEqual(items(backgroundMenu({ around: true, subject: null, past: false, narrowed: false }, bgOn)).map((x) => x.label), ["Fit to screen"]);
  assert.deepEqual(items(moreMenu({ past: true, narrowed: true }, { export: () => log.push("export"), fit: bgOn.fit, now: bgOn.now, reset: bgOn.reset })).map((x) => x.label), ["Export graph", "Fit to screen", "Show all layers and types", "Back to now"]);
  assert.deepEqual(items(legendMenu("chat", false, { toggle: () => log.push("t"), only: () => log.push("o"), all: () => log.push("a") })).map((x) => x.label), ["Hide Chats", "Show only Chats", "Show all types"]);
  assert.equal(items(legendMenu("chat", true, { toggle: () => undefined, only: () => undefined, all: () => undefined }))[0]!.label, "Show Chats");
  for (const m of [edgeMenu(e, { evidence: () => log.push("ev"), copy: () => log.push("copy") }), legendMenu("chat", false, { toggle: () => log.push("t"), only: () => log.push("o"), all: () => log.push("a") })]) for (const x of items(m)) x.onSelect?.();
  assert.deepEqual(log, ["ev", "copy", "t", "o", "a"]);
});

test("keys: Tab walks the nodes and wraps, Enter opens, Escape closes, + - 0 zoom and fit, the arrows pan", () => {
  assert.deepEqual(keyAction({ key: "Tab" }, false), { k: "tab", back: false });
  assert.deepEqual(keyAction({ key: "Tab", shiftKey: true }, false), { k: "tab", back: true });
  assert.deepEqual(keyAction({ key: "Enter" }, true), { k: "open" });
  assert.equal(keyAction({ key: "Enter" }, false), null, "nothing selected, nothing to open");
  assert.deepEqual(keyAction({ key: "Escape" }, false), { k: "clear" });
  assert.deepEqual(["+", "=", "-", "0"].map((key) => keyAction({ key }, false)?.k), ["in", "in", "out", "fit"]);
  assert.deepEqual(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].map((key) => keyAction({ key }, false)), [{ k: "pan", dx: 60, dy: 0 }, { k: "pan", dx: -60, dy: 0 }, { k: "pan", dx: 0, dy: 60 }, { k: "pan", dx: 0, dy: -60 }]);
  assert.equal(keyAction({ key: "q" }, true), null);
  assert.equal(nextTab(["a", "b", "c"], null, false), "a");
  assert.equal(nextTab(["a", "b", "c"], "a", false), "b");
  assert.equal(nextTab(["a", "b", "c"], "c", false), "a", "wraps");
  assert.equal(nextTab(["a", "b", "c"], "a", true), "c", "and wraps back");
  assert.equal(nextTab([], null, false), undefined);
});

test("the route follows the screen: subject, scope and edge are the hash; the picker lists pages by name", () => {
  assert.deepEqual(graphRoute(IAN, true, null), { v: "graph", focus: IAN, scope: "around" });
  assert.deepEqual(graphRoute(IAN, false, null), { v: "graph", focus: IAN, scope: "space" });
  assert.deepEqual(graphRoute(undefined, true, `${IAN}>${CADENCE}`), { v: "graph", scope: "around", edge: `${IAN}>${CADENCE}` });
  const pages = [{ title: "Ian Brooks" }, { title: "Elena Rivera" }, { title: "Brooks onboarding" }];
  assert.deepEqual(pickPages(pages, "brooks").map((p) => p.title), ["Ian Brooks", "Brooks onboarding"]);
  assert.equal(pickPages(pages, "").length, 3);
  assert.equal(pickPages(pages, "zzz").length, 0);
  assert.equal(pickPages(pages, " ELENA ").length, 1);
  assert.equal(pickPages(Array.from({ length: 90 }, (_, i) => ({ title: `Page ${i}` })), "").length, 40);
  assert.equal(edgeKey({ from: "a", to: "b" }), "a>b");
  assert.equal(firstName("Ian Brooks"), "Ian");
  assert.equal(firstName("Assistant"), "Assistant");
});

// ---------------------------------------------------------------- the model: shape, camera, labels, hits, layout

test("what is drawn: personal nodes never, nodes left with no link dropped when a filter or a date is on (the subject stays), counts and the stat line", () => {
  const g: GraphOut = {
    nodes: [{ nodeId: "a", kind: "client", title: "A", layer: "space" }, { nodeId: "b", kind: "chat", title: "B", layer: "project" }, { nodeId: "c", kind: "note", title: "C", layer: "space" }, { nodeId: "p", kind: "note", title: "P", layer: "person" }],
    edges: [{ from: "a", to: "b", kind: "relation" }, { from: "a", to: "p", kind: "link" }], clusters: [],
  };
  const s = shown(g, { layers: ALL_LAYERS, kinds: new Set(), q: "" });
  assert.deepEqual(s.nodes.map((n) => n.nodeId), ["a", "b", "c"]);
  assert.equal(s.edges.length, 1, "an edge to a personal node is not drawn");
  assert.deepEqual(dropOrphans(s).nodes.map((n) => n.nodeId), ["a", "b"]);
  assert.deepEqual(dropOrphans(s, "c").nodes.map((n) => n.nodeId), ["a", "b", "c"]);
  assert.deepEqual([...kindCounts(g.nodes)], [["client", 1], ["chat", 1], ["note", 1]], "personal nodes are not counted");
  assert.deepEqual(layerCounts(g.nodes), { space: 2, project: 1 });
  assert.equal(statLine(10, 13, "Ian Brooks"), "10 nodes · 13 links · around Ian Brooks, two hops");
  assert.equal(statLine(25, 30, null), "25 nodes · 30 links · the whole Space");
  assert.equal(statLine(1, 1, null), "1 node · 1 link · the whole Space");
  assert.equal(pageOf({ nodeId: "pg_x", kind: "topic", title: "X" }, new Set(["pg_x"])), "pg_x");
  assert.equal(pageOf({ nodeId: "chat-k1", kind: "chat", title: "K" }, new Set(["pg_x"])), undefined);
  assert.equal(pageOf({ nodeId: "rec", kind: "record", title: "R", pageId: "pg_r" }, new Set()), "pg_r");
});

test("one hue per type, chats a grey-green of their own; a hex for the canvas", () => {
  assert.equal(new Set(KINDS.map(kindColor)).size, KINDS.length);
  for (const k of KINDS) assert.match(kindHex(k), /^#[0-9a-f]{6}$/);
  assert.equal(KINDS.length, 10);
  assert.deepEqual(KINDS.slice(0, 7), ["person", "client", "project", "topic", "agent", "record", "chat"]);
});

test("around layout: the subject in the middle, what it links to nearer than what those link to, the same every time, nothing on top of anything", () => {
  const g = read(createKnowSample(), { scope: "space", focus: IAN, hops: HOPS });
  const a = layoutAround(g.nodes, g.edges, IAN), b = layoutAround(g.nodes, g.edges, IAN);
  assert.deepEqual(a, b);
  assert.deepEqual(a[IAN], { x: WORLD / 2, y: WORLD / 2 });
  const hop = hopsFrom(IAN, g.edges);
  assert.equal(hop.get(IAN), 0);
  assert.ok([...hop.values()].every((h) => h <= HOPS) && hop.size === g.nodes.length, "every node is within two hops");
  const dist = (id: string): number => Math.hypot(a[id]!.x - WORLD / 2, a[id]!.y - WORLD / 2);
  const mean = (h: number): number => { const ids = [...hop].filter(([, x]) => x === h).map(([id]) => id); return ids.reduce((t, id) => t + dist(id), 0) / ids.length; };
  assert.ok(mean(1) < mean(2), "the first ring is nearer");
  const ids = g.nodes.map((n) => n.nodeId);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) assert.ok(Math.hypot(a[ids[i]!]!.x - a[ids[j]!]!.x, a[ids[i]!]!.y - a[ids[j]!]!.y) > 20, `${ids[i]} and ${ids[j]} are apart`);
  const whole = read(createKnowSample(), { scope: "space" });
  const w = layoutAround(whole.nodes, whole.edges, null);
  assert.equal(Object.keys(w).length, whole.nodes.length);
  assert.deepEqual(w, layoutAround(whole.nodes, whole.edges, null));
});

test("the camera: fit puts every node in the box with room for the legend and the cards; zoom keeps the point under the pointer; the range is bounded", () => {
  const pos = { a: { x: 0, y: 0 }, b: { x: 600, y: 300 }, c: { x: 300, y: 600 } };
  const ids = ["a", "b", "c"];
  const cam = fitCam(pos, ids, 1200, 800);
  for (const id of ids) { const p = toScreen(cam, pos[id as "a"]); assert.ok(p.x >= 190 - 1 && p.x <= 1200 - 90 + 1 && p.y >= 60 - 1 && p.y <= 800 - 190 + 1, `${id} at ${p.x},${p.y}`); }
  assert.ok(cam.k <= 2.4, "a handful of nodes are not blown up");
  const narrow = fitCam(pos, ids, 600, 800);
  assert.ok(toScreen(narrow, pos.a).x >= 39, "a narrow window gives the legend no room");
  assert.deepEqual(fitCam({}, [], 500, 400), { x: 250, y: 200, k: 1 });
  const px = 700, py = 300, before = toWorld(cam, px, py), z = zoomAt(cam, 1.25, px, py), after = toWorld(z, px, py);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9, "the point under the pointer stays put");
  assert.ok(z.k > cam.k);
  assert.equal(zoomAt({ x: 0, y: 0, k: 1 }, 1e9, 0, 0).k, ZOOM_MAX);
  assert.equal(zoomAt({ x: 0, y: 0, k: 1 }, 1e-9, 0, 0).k, ZOOM_MIN);
  assert.deepEqual(panBy({ x: 1, y: 2, k: 3 }, 10, -5), { x: 11, y: -3, k: 3 });
  const c = centreOn({ x: 0, y: 0, k: 0.2 }, { x: 100, y: 100 }, 800, 600, 0.7);
  assert.deepEqual(toScreen(c, { x: 100, y: 100 }), { x: 400, y: 300 });
  assert.equal(c.k, 0.7, "focusing zooms in to at least a readable size");
});

test("labels: kept while the edges in view are few, gone when thousands are; node names likewise; a crowd shrinks the nodes", () => {
  assert.deepEqual(labelPlan(13, 10), { edges: true, nodes: true });
  assert.deepEqual(labelPlan(EDGE_LABELS_MAX, NODE_LABELS_MAX), { edges: true, nodes: true });
  assert.deepEqual(labelPlan(EDGE_LABELS_MAX + 1, NODE_LABELS_MAX + 1), { edges: false, nodes: false });
  assert.deepEqual(labelPlan(8000, 5000), { edges: false, nodes: false });
  assert.equal(nodeRadius(0, false), 7.5);
  assert.equal(nodeRadius(10, false), 12);
  assert.equal(nodeRadius(0, true), 12.5, "the subject is biggest");
  assert.ok(nodeRadius(2, false, 5000) < nodeRadius(2, false) / 2 && nodeRadius(2, false, 5000) >= 0.35 * nodeRadius(2, false), "a crowd shrinks them, but not to nothing");
  assert.equal(nodeRadius(2, false, 300), nodeRadius(2, false));
});

test("what a pointer hits: a node by its circle, an edge within a few pixels of its line, a node before an edge, nothing in the empty", () => {
  assert.ok(Math.abs(segDistance(5, 3, 0, 0, 10, 0) - 3) < 1e-9);
  assert.equal(segDistance(-4, 3, 0, 0, 10, 0), 5, "past the end it is the distance to the end");
  assert.equal(segDistance(1, 1, 2, 2, 2, 2), Math.SQRT2, "a segment of no length is a point");
  assert.deepEqual(clipSeg(-100, 50, 300, 50, 0, 0, 200, 100), [0, 50, 200, 50]);
  assert.equal(clipSeg(-100, -100, -50, -50, 0, 0, 200, 100), null);
  const g = new HitGrid(48, [-50, -50, 800, 600]);
  g.addSeg("a>b", 100, 100, 500, 300);
  g.addSeg("c>d", 100, 400, 700, 400);
  g.addPoint("a", 100, 100, 9);
  g.addPoint("far", 3000, 3000, 9);
  assert.equal(g.nodeAt(106, 104), "a");
  assert.equal(g.nodeAt(112, 100), "a", "a few pixels of slop around the circle");
  assert.equal(g.nodeAt(130, 100), null);
  assert.equal(g.edgeAt(300, 200), "a>b", "on the line");
  assert.equal(g.edgeAt(300, 204), "a>b", "within a few pixels");
  assert.equal(g.edgeAt(300, 230), null, "beyond them");
  assert.equal(g.edgeAt(450, 402), "c>d");
  assert.equal(g.edgeAt(750, 400), null, "the line ends at 700");
  assert.equal(hitAt(g, 101, 101) !== null && "node" in hitAt(g, 101, 101)!, true, "the node on the line's end wins over the edge");
  assert.deepEqual(hitAt(g, 300, 200), { edge: "a>b" });
  assert.equal(hitAt(g, 600, 50), null);
  // built from a real picture: the click on the middle of the `prefers` line finds that edge
  const picture = read(createKnowSample(), { scope: "space", focus: IAN, hops: HOPS });
  const pos = layoutAround(picture.nodes, picture.edges, IAN);
  const cam = fitCam(pos, picture.nodes.map((n) => n.nodeId), 1200, 800);
  const grid = buildGrid(picture.nodes as KGNode[], picture.edges as KGEdge[], (id) => pos[id], cam, () => 8, 1200, 800);
  const a = toScreen(cam, pos[IAN]!), b = toScreen(cam, pos[CADENCE]!);
  assert.deepEqual(hitAt(grid, (a.x + b.x) / 2, (a.y + b.y) / 2 + 2), { edge: edgeKey({ from: IAN, to: CADENCE }) });
  assert.deepEqual(hitAt(grid, a.x + 1, a.y), { node: IAN });
  const deg = degrees(picture.edges);
  assert.equal(deg.get(IAN), 6, "Ian has six links in this picture");
});

// ---------------------------------------------------------------- the slider's range

test("the time slider's range is thirty days and now is the right end", () => {
  assert.equal(SLIDER_DAYS, 30);
  assert.equal(asOfOf(SLIDER_DAYS, KNOW_NOW), undefined);
  assert.equal(DAY, 86_400_000);
});
