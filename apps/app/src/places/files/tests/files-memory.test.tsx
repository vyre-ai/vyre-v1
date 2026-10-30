// @reads ../../../../../../scripts/shots/mounts/P-L9e_05.tsx
// Files > Knowledge: the memory graph and the proposed facts. A graph that never draws a personal layer, filters by layer, kind and time, is laid out the same every time and keeps where a node was
// left; a proposed fact accepted into the layer it was proposed for (or rejected and kept in history) with its row, its group and its count following.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { MemoryDataProvider, MemoryGraph, MemoryProposed, acceptFact, exportGraph, rejectFact, saveLayout } from "../memory/index.ts";
import type { LiveCap } from "../memory/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import {
  ALL_LAYERS, DAY, GRAPH_LAYERS, KINDS, KIND_HUE, NODE_R, NO_FILTER, SLIDER_DAYS, WORLD, ago, asOfOf, clustersOf, dayText, degrees, hslHex, kindColor, lands, layout, matches, neighborsOf,
  proposedGroups, radiusOf, shown, sliderText, statText, tabOrder, toggled, visibleNode,
} from "../memory/model.ts";
import type { GraphOut, GNode } from "../memory/model.ts";
import { SAMPLE_NOW, createSampleMemory, harbor, northwind } from "../memory/sample.ts";
import type { SampleMemory, SampleSpace } from "../memory/sample.ts";

/** Five thousand notes and eight thousand links, the size the graph is judged at. */
function bigGraph(): { nodes: GNode[]; edges: { from: string; to: string; kind: "link" }[] } {
  const nodes: GNode[] = [];
  for (let i = 0; i < 5000; i++) nodes.push({ nodeId: `n${i}`, kind: KINDS[i % KINDS.length]!, title: `Note ${i}`, layer: GRAPH_LAYERS[i % 3]!, cluster: `c${i % 12}` });
  const edges = Array.from({ length: 8000 }, (_, i) => ({ from: `n${i % 5000}`, to: `n${(i * 7 + 13) % 5000}`, kind: "link" as const }));
  return { nodes, edges };
}

const wrap = (s: SampleMemory, child: ReactElement): string => renderToStaticMarkup(<MemoryDataProvider value={s.data}>{child}</MemoryDataProvider>).replaceAll("<!-- -->", "");
/** The graph over the old Space sample, drawn as the Whole Space (no subject), which is how the older mounts and these tests ask for it. */
const graph = (props: { selected?: string; step?: number; find?: string; around?: boolean } = {}, s: SampleMemory = createSampleMemory()): string =>
  wrap(s, <MemoryGraph around={props.around ?? false} {...(props.selected ? { selected: props.selected } : {})} {...(props.step !== undefined ? { step: props.step } : {})} {...(props.find ? { find: props.find } : {})} />);
const proposed = (s: SampleMemory = createSampleMemory()): string => wrap(s, <MemoryProposed agentId="agt_intake" />);
const has = (s: string, needle: string): boolean => s.includes(needle);
const count = (s: string, needle: string): number => s.split(needle).length - 1;
/** One live read, as the screen makes it. */
function read<C extends LiveCap>(s: SampleMemory, cap: C, input: CapMap[C]["in"]): CapMap[C]["out"] {
  const snap = s.data.live(cap, input).getSnapshot();
  assert.equal(snap.status, "ready");
  return (snap as { data: CapMap[C]["out"] }).data;
}
const at = (s: string, needle: string): number => { const i = s.indexOf(needle); assert.ok(i >= 0, needle); return i; };
const space = (s: SampleSpace = northwind): GraphOut => read(createSampleMemory(s), "memory.graph", { scope: "space" });

// ---------------------------------------------------------------- the model

test("personal layers are never in a graph: a node of the person layer is not visible under any filter", () => {
  const g = space();
  const priv = g.nodes.find((n) => n.nodeId === "private")!;
  assert.equal(priv.layer, "person");
  assert.equal(visibleNode(priv, NO_FILTER), false);
  assert.equal(visibleNode(priv, { layers: new Set(["person", "agent", "project", "space"]), kinds: new Set(), q: "" }), false, "even if the layer were asked for");
  assert.deepEqual([...GRAPH_LAYERS], ["agent", "project", "space"]);
  assert.equal(shown(g, NO_FILTER).nodes.some((n) => n.nodeId === "private"), false);
  assert.equal(shown(g, NO_FILTER).edges.some((e) => e.from === "private" || e.to === "private"), false, "nor an edge that reaches one");
  assert.equal(shown(g, NO_FILTER).hidden, 0, "and nobody is told how many were left out");
});

test("layers and kinds filter the graph; the edges follow the nodes that stay", () => {
  const g = space();
  const all = shown(g, NO_FILTER);
  assert.equal(all.nodes.length, 17);
  const projectOnly = shown(g, { layers: new Set(["project"]), kinds: new Set(), q: "" });
  assert.deepEqual(projectOnly.nodes.map((n) => n.nodeId).sort(), ["consult", "elena", "inv", "letter", "marcus", "pruitt", "prep", "rivera", "trust"].sort());
  assert.ok(projectOnly.edges.every((e) => projectOnly.nodes.some((n) => n.nodeId === e.from) && projectOnly.nodes.some((n) => n.nodeId === e.to)));
  assert.equal(projectOnly.hidden, 8);
  const people = shown(g, { layers: ALL_LAYERS, kinds: new Set(["person", "client"]), q: "" });
  assert.deepEqual(people.nodes.map((n) => n.nodeId).sort(), ["elena", "marcus", "maya", "omar"]);
  assert.deepEqual(toggled(new Set(["a"]), "b"), new Set(["a", "b"]));
  assert.deepEqual(toggled(new Set(["a", "b"]), "a"), new Set(["b"]));
  assert.equal(KINDS.length, Object.keys(KIND_HUE).length);
  assert.notEqual(kindColor("client"), kindColor("project"), "one colour per kind");
});

test("Find lights the notes that match and filters nothing", () => {
  const nodes = shown(space(), NO_FILTER).nodes;
  assert.deepEqual([...matches(nodes, "rivera")].sort(), ["consult", "elena", "rivera"]);
  assert.deepEqual([...matches(nodes, "  FEE ")].sort(), ["fees", "flat"]);
  assert.equal(matches(nodes, "").size, 0);
  assert.equal(shown(space(), { ...NO_FILTER, q: "rivera" }).nodes.length, 17, "the search does not hide the rest");
});

test("the time slider: Now at the right end, the end of each earlier day to its left", () => {
  assert.equal(SLIDER_DAYS, 30);
  assert.equal(asOfOf(30, SAMPLE_NOW), undefined);
  assert.equal(asOfOf(99, SAMPLE_NOW), undefined);
  const today = Math.floor(SAMPLE_NOW / DAY) * DAY;
  assert.equal(asOfOf(29, SAMPLE_NOW), today - 1, "yesterday ends where today starts");
  assert.equal(asOfOf(18, SAMPLE_NOW), today - 11 * DAY - 1);
  assert.equal(sliderText(30, SAMPLE_NOW), "Now");
  assert.equal(sliderText(29, SAMPLE_NOW), "Oct 23");
  assert.equal(sliderText(18, SAMPLE_NOW), "Oct 12");
  assert.equal(dayText(Date.UTC(2025, 0, 5)), "Jan 5");
});

test("the layout is the same every time, keeps what was saved and puts every node in the world", () => {
  const { nodes, edges } = shown(space(), NO_FILTER);
  const a = layout(nodes, edges), b = layout(nodes, edges);
  assert.deepEqual(a, b, "no randomness");
  assert.equal(Object.keys(a).length, nodes.length);
  for (const p of Object.values(a)) assert.ok(p.x > -WORLD && p.x < WORLD * 2 && p.y > -WORLD && p.y < WORLD * 2, "inside the world");
  const kept = layout(nodes, edges, { elena: { x: 10, y: 20 } });
  assert.deepEqual(kept["elena"], { x: 10, y: 20 }, "a saved position is not moved");
  assert.notDeepEqual(kept["rivera"], a["rivera"], "the others settle around it");
  const apart = new Set(Object.values(a).map((p) => `${p.x},${p.y}`));
  assert.equal(apart.size, nodes.length, "no two nodes on one point");
  const withServer: GNode = { nodeId: "s", kind: "note", title: "S", x: 5, y: 6 };
  assert.deepEqual(layout([withServer], [])["s"], { x: 5, y: 6 }, "the server's position is used when there is one");
  assert.deepEqual(layout([], []), {});
});

test("node sizes, colours and neighbours: a hub is bigger, a colour is a hex WebGL can read, a node's links are its neighbours", () => {
  const { nodes, edges } = shown(space(), NO_FILTER);
  const pos = layout(nodes, edges);
  const deg = degrees(edges);
  assert.ok(radiusOf(0) === NODE_R && radiusOf(100) <= NODE_R * 2 && radiusOf(9) > radiusOf(1), "a hub is bigger, up to twice the base");
  assert.deepEqual([...neighborsOf("elena", edges)].sort(), ["elena", "prep", "rivera"]);
  assert.equal(tabOrder(nodes, pos).length, nodes.length);
  assert.equal(deg.get("vyre"), 4);
  assert.equal(hslHex(0, 100, 50), "#ff0000");
  assert.equal(hslHex(120, 100, 50), "#00ff00");
  assert.equal(hslHex(240, 100, 50), "#0000ff");
  assert.equal(hslHex(0, 0, 100), "#ffffff");
  assert.match(hslHex(KIND_HUE.client, 62, 55), /^#[0-9a-f]{6}$/);
});

test("graph scale: five thousand notes are filtered, laid out, counted and clustered (the speed half is files-graph.perf.test.tsx)", () => {
  const { nodes, edges } = bigGraph();
  const g: GraphOut = { nodes, edges, clusters: [] };
  const s = shown(g, { layers: new Set(["agent", "space"]), kinds: new Set(), q: "" });
  const pos = layout(s.nodes, s.edges);
  const deg = degrees(s.edges);
  const clusters = clustersOf(s.nodes, s.edges);
  const lit = matches(s.nodes, "Note 49");
  assert.equal(Object.keys(pos).length, s.nodes.length);
  assert.ok(deg.size > 1000 && clusters.length === 8 && lit.size > 0);
  assert.deepEqual(layout(s.nodes, s.edges), pos, "the same notes lay out the same way every time");
});

test("clusters are counted from what is drawn and named after their hub", () => {
  const { nodes, edges } = shown(space(), NO_FILTER);
  const c = clustersOf(nodes, edges);
  assert.deepEqual(c.map((x) => [x.name, x.size]), [["Firm", 8], ["Rivera engagement", 6], ["Pruitt estate plan", 3]]);
  assert.equal(c[0]!.hub, "fees", "the hub is the node with the most links; Fee schedule and VYRE.md tie at four and the title decides");
  assert.equal(statText({ nodes, edges, hidden: 0 }, c), `17 notes, ${edges.length} links, 3 clusters`);
  assert.equal(statText({ nodes: [], edges: [], hidden: 0 }, []), "0 notes, 0 links");
  assert.equal(statText({ nodes: [nodes[0]!], edges: [], hidden: 0 }, clustersOf([nodes[0]!], [])), "1 note, 0 links, 1 cluster");
});

// ---------------------------------------------------------------- the graph screen

test("screen: the Whole Space draws its notes without the personal one, each in its kind's colour, with the count at the top left", () => {
  const out = graph();
  assert.ok(has(out, 'data-testid="memory-graph"') && has(out, 'data-testid="graph-surface"') && has(out, 'data-testid="graph-canvas"') && has(out, 'aria-label="Knowledge graph. Tab walks the nodes, Enter opens one, plus and minus zoom, the arrow keys pan."'));
  assert.equal(count(out, 'data-testid="gnode-'), 17, "every note of the Space, one list entry each");
  for (const id of ["vyre", "script", "hours", "elena", "rivera", "consult", "prep", "widget", "maya", "omar", "fees", "flat", "letter", "inv", "trust"]) assert.ok(has(out, `data-testid="gnode-${id}"`), id);
  assert.ok(!has(out, 'data-testid="gnode-private"') && !has(out, "private notes"), "a personal layer is never drawn");
  assert.ok(has(out, 'data-kind="client"') && has(out, 'role="listbox"') && has(out, 'aria-label="Nodes in the graph"'), "the nodes are also a listbox, because a canvas cannot be read aloud");
  const dot = (k: string): string => out.slice(at(out, `data-testid="legend-${k}"`)).match(/background-color:([^"]+)"/)![1]!;
  assert.ok(dot("client").startsWith("rgba(") && dot("client") !== dot("project") && dot("person") !== dot("client"), "one colour per kind, in the legend");
  assert.ok(has(out, 'data-testid="graph-legend"') && has(out, 'aria-label="Clients, '), "the legend is a card of toggle rows, each with its count");
  assert.equal(count(out, 'data-testid="legend-'), KINDS.filter((k) => out.includes(`data-kind="${k}"`)).length, "one legend row per kind the Space has");
  assert.ok(has(out, ">17 nodes · 21 links · the whole Space<") && has(out, 'data-testid="graph-stat"'));
  assert.ok(has(out, ">Knowledge<") && has(out, ">Graph<") && has(out, 'data-testid="scope-around"') && has(out, 'data-testid="scope-space"') && has(out, ">Whole Space<") && has(out, 'data-testid="know-search"'));
  for (const id of ["graph-layers", "graph-kinds", "graph-more", "graph-slider", "zoom-in", "zoom-out", "zoom-fit"]) assert.ok(has(out, `data-testid="${id}"`), id);
  assert.ok(!has(out, 'data-testid="graph-find"'), "Find is the Search knowledge field now");
  assert.ok(has(out, ">What we know now<") && !has(out, 'data-testid="graph-now"'), "the slider rests on now");
  assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash in any copy");
});

test("selecting a node marks it and the notes it links to, for the screen and for a screen reader, and shows its card", () => {
  const out = graph({ selected: "elena" });
  const listbox = (html: string): string => html.slice(at(html, 'data-testid="graph-notes"'), at(html, 'data-testid="graph-links"'));
  assert.equal(count(listbox(out), 'aria-selected="true"'), 1, "exactly the selected note says so");
  assert.ok(has(out, 'data-testid="gnode-elena"') && has(out, 'aria-label="Elena Rivera, Clients, 2 links"'));
  assert.equal(count(out, 'data-linked="true"'), 2, "elena links to rivera and prep");
  assert.ok(has(out, 'data-testid="graph-selected"') && has(out, ">Client<") && has(out, ">2 links<"), "the card of the node: its kind and its links");
  const none = graph();
  assert.equal(count(listbox(none), 'aria-selected="true"'), 0);
  assert.equal(count(none, 'data-linked="true"'), 0);
  assert.ok(!has(none, 'data-testid="graph-selected"'));
});

test("what the Space knew on a day: the nodes that did not exist yet are gone, and Back to now is offered", () => {
  const out = graph({ step: 18 });
  assert.equal(count(out, 'data-testid="gnode-'), 12);
  for (const id of ["flat", "letter", "prep", "inv", "trust"]) assert.ok(!has(out, `data-testid="gnode-${id}"`), `${id} came later`);
  assert.ok(has(out, ">What we knew on Oct 12<") && has(out, 'data-testid="graph-now"') && has(out, ">Back to now<") && has(out, ">12 nodes · 12 links · the whole Space<"));
  const s = createSampleMemory();
  const live = read(s, "memory.graph", { scope: "space", asOf: asOfOf(18, SAMPLE_NOW) as number });
  assert.equal(live.nodes.filter((n) => n.layer !== "person").length, 12, "the capability is asked for that day");
});

test("Find lights notes and the rest stay; an empty graph says so", () => {
  const out = graph({ find: "rivera" });
  assert.equal(count(out, 'data-testid="gnode-'), 17);
  assert.equal(count(out, 'data-lit="true"'), 3, "elena, rivera and the consult match");
  const empty = createSampleMemory({ ...harbor, nodes: [], edges: [] });
  const e = graph({}, empty);
  assert.ok(has(e, "Nothing to draw yet") && !has(e, 'data-testid="graph-surface"'));
});

test("the graph draws a loading frame before the shell gives it data", () => {
  assert.ok(has(renderToStaticMarkup(<MemoryGraph />), "memory-graph-loading"));
  assert.ok(has(renderToStaticMarkup(<MemoryProposed />), "memory-proposed-loading"));
});

test("saving where nodes were left, and exporting the graph, go through their capabilities and are read back", async () => {
  const s = createSampleMemory();
  await saveLayout(s.data, "space", undefined, { elena: { x: 40, y: 50 } });
  assert.deepEqual(s.calls[0], { cap: "memory.layout.save", input: { scope: "space", positions: { elena: { x: 40, y: 50 } } } });
  assert.deepEqual(read(s, "memory.layout.get", { scope: "space" }).positions, { elena: { x: 40, y: 50 } });
  assert.deepEqual(read(s, "memory.layout.get", { scope: "agent", agentId: "agt_intake" }).positions, {}, "per scope");
  const file = await exportGraph(s.data, "agent", "agt_intake", asOfOf(20, SAMPLE_NOW), ["client"]);
  assert.match(file, /^fil_export_/);
  assert.deepEqual(s.calls[1]!.input, { scope: "agent", agentId: "agt_intake", asOf: asOfOf(20, SAMPLE_NOW), kinds: ["client"] });
  assert.equal((await exportGraph(s.data, "space", undefined, undefined, [])).length > 0, true);
  assert.deepEqual(s.calls[2]!.input, { scope: "space" });
});

// ---------------------------------------------------------------- proposed facts

test("proposed facts are grouped by the layer they would join, newest first, and say where they came from", () => {
  const s = createSampleMemory();
  const facts = read(s, "memory.facts.list", { status: ["proposed"] }).facts;
  const groups = proposedGroups(facts);
  assert.deepEqual(groups.map((g) => [g.layer, g.facts.map((f) => f.factId)]), [["project", ["f1", "f2"]], ["space", ["f3"]], ["agent", ["f4"]], ["person", ["f5"]]]);
  assert.equal(lands(facts.find((f) => f.factId === "f1")!), "the project's memory");
  assert.equal(lands(facts.find((f) => f.factId === "f5")!), "your own memory");
  assert.equal(ago(SAMPLE_NOW - 3 * 3_600_000, SAMPLE_NOW), "3 h ago");
  assert.equal(ago(SAMPLE_NOW - 26 * 3_600_000, SAMPLE_NOW), "1 d ago");
  assert.equal(ago(SAMPLE_NOW - 5 * 60_000, SAMPLE_NOW), "5 min ago");
  assert.equal(ago(SAMPLE_NOW, SAMPLE_NOW), "Just now");
  assert.deepEqual(proposedGroups([{ ...facts[0]!, status: "current" }]), [], "only facts that wait");
});

test("screen: proposed facts are shared Rows with the source under them and quiet Accept and Reject text actions at the right", () => {
  const out = proposed();
  assert.ok(has(out, 'data-testid="memory-proposed"') && has(out, ">Proposed<") && has(out, ">5 waiting<"));
  for (const id of ["f1", "f2", "f3", "f4", "f5"]) {
    assert.ok(has(out, `data-testid="row-fact:${id}"`) && has(out, `data-testid="row-fact:${id}-trailing"`) && has(out, `data-testid="accept-${id}"`) && has(out, `data-testid="reject-${id}"`), id);
  }
  assert.ok(has(out, "Elena Rivera prefers email over phone calls") && has(out, "From a channel of Maya Chen · 3 h ago") && has(out, "From an automation run of Maya Chen"));
  assert.ok(has(out, "Joins the project&#x27;s memory") || has(out, "Joins the project's memory"));
  assert.ok(has(out, 'data-testid="accept-all-project"') && !has(out, 'data-testid="accept-all-space"'), "Accept all only where there is more than one");
  assert.ok(has(out, ">low risk<") || has(out, "low risk"));
  assert.ok(has(out, 'data-testid="proposed-notes"') && has(out, "Rivera contact preferences") && has(out, "memory/proposed/rivera-contact.md"));
  assert.ok(has(out, 'aria-label="Accept: Elena Rivera prefers email over phone calls"'));
  assert.ok(has(out, "opacity:0"), "on a desktop the actions wait for hover, focus or selection");
  assert.ok(at(out, 'data-testid="layer-project"') < at(out, 'data-testid="layer-space"') && at(out, 'data-testid="layer-space"') < at(out, 'data-testid="layer-agent"'));
});
test("accept promotes a fact to the project layer: it becomes current there, leaves the waiting list and the screen follows", async () => {
  const s = createSampleMemory();
  const before = read(s, "memory.facts.list", { layer: "project", status: ["current"] }).facts.map((f) => f.factId);
  assert.deepEqual(before, ["f6"]);
  const fact = await acceptFact(s.data, "f1");
  assert.deepEqual([fact.factId, fact.layer, fact.status], ["f1", "project", "current"]);
  assert.deepEqual(s.calls, [{ cap: "memory.fact.accept", input: { factId: "f1" } }]);
  assert.deepEqual(read(s, "memory.facts.list", { layer: "project", status: ["current"] }).facts.map((f) => f.factId).sort(), ["f1", "f6"], "now in the project's memory");
  assert.deepEqual(read(s, "memory.facts.list", { layer: "project", status: ["proposed"] }).facts.map((f) => f.factId), ["f2"]);
  const out = proposed(s);
  assert.ok(!has(out, 'data-testid="accept-f1"') && has(out, 'data-testid="accept-f2"') && has(out, ">4 waiting<"));
  assert.ok(has(out, 'data-testid="layer-count-project"') && has(out, ">1<"));
  assert.ok(!has(out, 'data-testid="accept-all-project"'), "one fact left in that group");
  await assert.rejects(acceptFact(s.data, "f1"), /Only a proposed fact/, "a fact is decided once");
});

test("reject closes a fact off and keeps it in history; it is never current and never waits again", async () => {
  const s = createSampleMemory();
  const fact = await rejectFact(s.data, "f3");
  assert.deepEqual([fact.status, fact.closedAt], ["removed", SAMPLE_NOW]);
  assert.deepEqual(read(s, "memory.facts.list", { layer: "space", status: ["current"] }).facts.map((f) => f.factId), ["f7"]);
  assert.deepEqual(read(s, "memory.facts.list", { status: ["removed"] }).facts.map((f) => f.factId), ["f3"], "kept, as removed");
  assert.ok(!has(proposed(s), 'data-testid="accept-f3"') && !has(proposed(s), 'data-testid="layer-space"'));
  await assert.rejects(rejectFact(s.data, "nope"), /fact not found/);
});

test("a refused decision says why and changes nothing", async () => {
  const s = createSampleMemory(northwind, { fail: "You cannot edit this agent" });
  await assert.rejects(acceptFact(s.data, "f1"), /cannot edit/);
  assert.deepEqual(read(s, "memory.facts.list", { layer: "project", status: ["proposed"] }).facts.map((f) => f.factId), ["f1", "f2"]);
});

test("when everything is decided the screen says nothing is waiting", async () => {
  const s = createSampleMemory({ ...northwind, notes: [] });
  for (const id of ["f1", "f2", "f3", "f4", "f5"]) await acceptFact(s.data, id);
  const out = proposed(s);
  assert.ok(has(out, "Nothing waiting for review") && !has(out, ">waiting<"));
  assert.ok(has(wrap(createSampleMemory(harbor), <MemoryProposed agentId="agt_scout" />), "The launch date is the 14th"));
});

test("opening a fact's source and a note goes through the shell's navigation", () => {
  const s = createSampleMemory();
  s.data.nav.openSource("/chats/ch_rivera");
  s.data.nav.openNote("elena");
  assert.deepEqual(s.opened, ["source:/chats/ch_rivera", "note:elena"]);
});
