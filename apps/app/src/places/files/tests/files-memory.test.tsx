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
  ALL_LAYERS, DAY, GRAPH_LAYERS, KINDS, KIND_HUE, MAX_K, MIN_K, NODE_R, NO_FILTER, SLIDER_DAYS, WORLD, ago, asOfOf, clustersOf, dayText, degrees, fit, hit, kindColor, lands, layout, matches, neighborsOf,
  proposedGroups, radiusOf, shown, sliderText, statText, tabOrder, toScreen, toWorld, toggled, visibleNode, zoomAt,
} from "../memory/model.ts";
import type { GraphOut, GNode } from "../memory/model.ts";
import { SAMPLE_NOW, createSampleMemory, harbor, northwind } from "../memory/sample.ts";
import type { SampleMemory, SampleSpace } from "../memory/sample.ts";

const wrap = (s: SampleMemory, child: ReactElement): string => renderToStaticMarkup(<MemoryDataProvider value={s.data}>{child}</MemoryDataProvider>).replaceAll("<!-- -->", "");
const graph = (props: { scope?: "agent" | "space"; selected?: string; step?: number; find?: string; agentId?: string } = {}, s: SampleMemory = createSampleMemory()): string =>
  wrap(s, <MemoryGraph agentId={props.agentId ?? "agt_intake"} {...(props.scope ? { scope: props.scope } : {})} {...(props.selected ? { selected: props.selected } : {})} {...(props.step !== undefined ? { step: props.step } : {})} {...(props.find ? { find: props.find } : {})} />);
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

test("fit holds every node with a margin; zoom keeps the point under the pointer; hits find the nearest node", () => {
  const { nodes, edges } = shown(space(), NO_FILTER);
  const pos = layout(nodes, edges);
  const ids = nodes.map((n) => n.nodeId);
  const v = fit(pos, ids, 900, 560);
  for (const id of ids) { const s = toScreen(v, pos[id]!); assert.ok(s.x >= 0 && s.x <= 900 && s.y >= 0 && s.y <= 560, `${id} is on screen`); }
  assert.ok(v.k <= 1.4 && v.k >= MIN_K);
  assert.deepEqual(fit({}, [], 900, 560), { x: 0, y: 0, k: 1 });
  const one = fit({ a: { x: 500, y: 500 } }, ["a"], 900, 560);
  assert.ok(one.k <= 1.4, "one node is not a close-up");
  const w0 = toWorld(v, 300, 200), z = zoomAt(v, 1.5, 300, 200), w1 = toWorld(z, 300, 200);
  assert.ok(Math.abs(w0.x - w1.x) < 1e-6 && Math.abs(w0.y - w1.y) < 1e-6);
  assert.equal(zoomAt(v, 100, 0, 0).k, MAX_K);
  assert.equal(zoomAt(v, 0.0001, 0, 0).k, MIN_K);
  const deg = degrees(edges);
  const where = toScreen(v, pos["rivera"]!);
  assert.equal(hit(nodes, pos, deg, v, where.x + 2, where.y - 2), "rivera");
  assert.equal(hit(nodes, pos, deg, v, -50, -50), null);
  assert.ok(radiusOf(0) === NODE_R && radiusOf(100) <= NODE_R * 2 && radiusOf(9) > radiusOf(1), "a hub is bigger, up to twice the base");
  assert.deepEqual([...neighborsOf("elena", edges)].sort(), ["elena", "prep", "rivera"]);
  assert.equal(tabOrder(nodes, pos).length, nodes.length);
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

test("screen: Intake's graph draws its notes without the personal one, each in its kind's colour, with the count in the foot", () => {
  const out = graph();
  assert.ok(has(out, 'data-testid="memory-graph"') && has(out, 'data-testid="graph-surface"') && has(out, 'aria-label="Memory graph. Tab walks the notes, Enter opens one, plus and minus zoom."'));
  assert.equal(count(out, 'data-testid="gnode-'), 12, "Intake's notes and the Space's, none of Docs' or Billing's");
  for (const id of ["vyre", "script", "hours", "elena", "rivera", "consult", "prep", "widget", "maya", "omar", "fees", "flat"]) assert.ok(has(out, `data-testid="gnode-${id}"`), id);
  assert.ok(!has(out, 'data-testid="gnode-private"') && !has(out, "private notes"), "a personal layer is never drawn");
  assert.ok(!has(out, 'data-testid="gnode-letter"'), "another agent's notes stay out of this agent's graph");
  assert.equal(count(out, "data-edge="), 13);
  assert.ok(has(out, 'data-kind="client"') && has(out, `fill:${kindColor("client")}`));
  assert.ok(has(out, ">12 notes, 13 links, 2 clusters<") && has(out, 'data-testid="cluster-Firm"') && has(out, ">Firm 8<"));
  assert.ok(has(out, ">Graph<") && has(out, ">Intake<") && has(out, 'data-testid="scope-agent"') && has(out, ">Whole Space<"));
  for (const id of ["graph-find", "graph-layers", "graph-kinds", "graph-export", "graph-slider", "zoom-in", "zoom-out", "zoom-fit"]) assert.ok(has(out, `data-testid="${id}"`), id);
  assert.ok(has(out, ">Now<") && !has(out, 'data-testid="graph-now"'), "the slider rests on Now");
  assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash in any copy");
});

test("the whole Space draws every agent's notes, still not the personal one", () => {
  const out = graph({ scope: "space" });
  assert.equal(count(out, 'data-testid="gnode-'), 17);
  assert.ok(has(out, ">17 notes,") && !has(out, 'data-testid="gnode-private"'));
  assert.ok(!has(out, 'data-testid="graph-agent"'), "no agent picker in the Space scope");
  assert.ok(has(graph(), 'data-testid="graph-agent"'));
});

test("selecting a node lights its links, fades the others and shows its card with Open beside", () => {
  const out = graph({ scope: "space", selected: "elena" });
  assert.equal(count(out, 'data-emphasis="hot"'), 2, "elena has two links");
  assert.equal(count(out, 'data-emphasis="dim"'), count(out, "data-edge=") - 2);
  assert.ok(has(out, 'data-selected="true"') && has(out, 'data-testid="graph-selected"') && has(out, "Elena Rivera") && has(out, "Open beside") && has(out, 'data-testid="graph-open"'));
  assert.equal(count(out, 'data-selected="true"'), 1);
  const none = graph({ scope: "space" });
  assert.equal(count(none, 'data-emphasis="hot"'), 0);
  assert.ok(!has(none, 'data-testid="graph-selected"'));
});

test("what the agent believed on a day: the nodes that did not exist yet are gone, and Back to now is offered", () => {
  const out = graph({ scope: "space", step: 18 });
  assert.equal(count(out, 'data-testid="gnode-'), 12);
  for (const id of ["flat", "letter", "prep", "inv", "trust"]) assert.ok(!has(out, `data-testid="gnode-${id}"`), `${id} came later`);
  assert.ok(has(out, ">Oct 12<") && has(out, 'data-testid="graph-now"') && has(out, ">12 notes, 12 links, 3 clusters<"));
  const s = createSampleMemory();
  const live = read(s, "memory.graph", { scope: "space", asOf: asOfOf(18, SAMPLE_NOW) as number });
  assert.equal(live.nodes.filter((n) => n.layer !== "person").length, 12, "the capability is asked for that day");
});

test("Find lights notes and the rest stay; an empty graph says so; a graph filtered to nothing offers to show everything", () => {
  const out = graph({ scope: "space", find: "rivera" });
  assert.equal(count(out, 'data-testid="gnode-'), 17);
  assert.ok(has(out, 'data-testid="glabel-elena"') && has(out, "opacity:0.2"), "a match is labelled and the rest are faded");
  const empty = createSampleMemory({ ...harbor, nodes: [], edges: [] });
  const e = graph({ agentId: "agt_scout" }, empty);
  assert.ok(has(e, "No notes to draw yet") && !has(e, 'data-testid="graph-surface"'));
});

test("the graph opens offline-ready from the kept copy and a loading frame draws before the data arrives", () => {
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

test("screen: proposed facts are shared Rows with the source under them and Accept and Reject at the right", () => {
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
