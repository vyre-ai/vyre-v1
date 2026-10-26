// Files > Knowledge > Graph (spec 2.15, 3.5): the notes of an agent's memory (or of the whole Space) as a graph. Nodes are notes, people, clients, projects, sites, decisions, records and chats, one
// colour per kind; edges are links, relations and "came from"; clusters take the name of their hub. Layers and Kinds filter it from quiet header menus with checkmarks, the time slider asks what the
// agent believed on a day, Find lights the notes that match, and a node can be dragged: where it was left is saved for this person. Personal layers are never drawn. A click opens the note in the side pane beside the graph (the shared Viewer: its properties, its text, what it links to and what links to it).
// The surface is sigma.js over graphology (GraphSurface.tsx); this file is everything around it.
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { SidePane } from "../../../../../../ui/src/SidePane/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { Viewer } from "../../../../../../ui/src/Viewer/index.tsx";
import type { DocBlock, ViewerGraph } from "../../../../../../ui/src/Viewer/index.tsx";
import { errorText, exportGraph, saveLayout } from "./actions.ts";
import { useLive, useMemoryData, useOptionalMemoryData } from "./data.tsx";
import { GraphSurface } from "./GraphSurface.tsx";
import type { SurfaceProps } from "./GraphSurface.tsx";
import {
  ALL_LAYERS, GRAPH_LAYERS, KINDS, KIND_LABEL, LAYER_LABEL, SLIDER_DAYS, asOfOf, clustersOf, degrees, each, layout, matches, shown, sliderText, statText, tabOrder, toggled,
} from "./model.ts";
import type { GNode, GraphOut, Positions } from "./model.ts";
import { Icon, QuietButton, pointOf } from "./parts.tsx";

const EMPTY: GraphOut = { nodes: [], edges: [], clusters: [] };

export interface MemoryGraphProps {
  agentId?: string;
  scope?: "agent" | "space";
  /** Start with this node selected. */
  selected?: string | null;
  /** Start the time slider on this step (0 is thirty days ago, 30 is now). */
  step?: number;
  /** Start with this text in Find. */
  find?: string;
}

// ---------------------------------------------------------------- the screen

/** The blocks of a note in the Viewer: the property block, the title and text, then Links (the notes it points to). Linked from is drawn by the Viewer from the graph. */
function noteBlocks(n: GNode, text: string | undefined, links: number, outs: readonly string[]): DocBlock[] {
  const props = [`Kind\t${KIND_LABEL[n.kind].replace(/s$/, "")}`, ...(n.layer ? [`Layer\t${LAYER_LABEL[n.layer]}`] : []), ...(n.cluster ? [`Cluster\t${n.cluster}`] : []), `Links\t${links}`];
  const blocks: DocBlock[] = [{ id: "props", tag: "meta", text: props.join("\n") }, { id: "title", tag: "h1", text: n.title }];
  const lines = (text ?? "").split("\n").filter((x) => x.trim() !== "" && !x.startsWith("# "));
  lines.forEach((ln, i) => blocks.push(ln.startsWith("- ") ? { id: `b${i}`, tag: "li", text: ln.slice(2) } : ln.startsWith("## ") ? { id: `b${i}`, tag: "h2", text: ln.slice(3) } : { id: `b${i}`, tag: "p", text: ln }));
  if (outs.length > 0) {
    blocks.push({ id: "links", tag: "h2", text: `Links · ${outs.length}` });
    outs.forEach((t, i) => blocks.push({ id: `l${i}`, tag: "li", text: `[[${t}]]` }));
  }
  return blocks;
}

/** The selected note beside the graph: the shared SidePane around the shared Viewer. The text is read with memory.read_note; a note that cannot be read still shows its properties and links. */
function NotePane({ node, narrow, winW, links, outs, graph, onClose, onOpenLink }: { node: GNode; narrow: boolean; winW: number; links: number; outs: readonly string[]; graph: ViewerGraph; onClose: () => void; onOpenLink: (id: string) => void }): ReactElement {
  const q = useLive("memory.read_note", { noteId: node.nodeId });
  const text = q.status === "ready" ? q.data.markdown : undefined;
  return (
    <View style={narrow ? m.paneOver : m.paneCol} testID="graph-selected">
      <SidePane paneKey={narrow ? "memory-note-phone" : "memory-note"} title={node.title} toggle={{ open: true, onPress: onClose }} defaultWidth={narrow ? Math.max(winW, 280) : 380} max={1}>
        <Viewer
          key={node.nodeId} fileId={`note:${node.nodeId}`} title={node.title} kind="document" pane="side" blocks={noteBlocks(node, text, links, outs)}
          graph={graph} nodeId={node.nodeId} onOpenLink={onOpenLink}
        />
      </SidePane>
    </View>
  );
}

function GraphBody({ agentId, scope: scope0 = "agent", selected = null, step: step0 = SLIDER_DAYS, find = "" }: MemoryGraphProps): ReactElement {
  const data = useMemoryData();
  const menu = useMenu();
  const [agent, setAgent] = useState(agentId ?? data.agents[0]?.id ?? "");
  const [scope, setScope] = useState<"agent" | "space">(scope0);
  const [layers, setLayers] = useState<ReadonlySet<string>>(ALL_LAYERS);
  const [kinds, setKinds] = useState<ReadonlySet<string>>(new Set());
  const [q, setQ] = useState(find);
  const [step, setStep] = useState(step0);
  const [sel, setSel] = useState<string | null>(selected);
  const [moved, setMoved] = useState<Positions>({});
  const [command, setCommand] = useState<SurfaceProps["command"]>(null);
  const [note, setNote] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const winW = useWindowDimensions().width;
  const now = data.now();
  const asOf = asOfOf(step, now);
  const agentArg = scope === "agent" && agent ? { agentId: agent } : {};
  const gq = useLive("memory.graph", { scope, ...agentArg, ...(asOf !== undefined ? { asOf } : {}) });
  const lq = useLive("memory.layout.get", { scope, ...agentArg });
  const kept = useRef<GraphOut>(EMPTY);
  if (gq.status === "ready") kept.current = gq.data;
  const g = kept.current;
  const saved: Positions = lq.status === "ready" ? lq.data.positions : {};
  const filter = useMemo(() => ({ layers, kinds, q }), [layers, kinds, q]);
  const s = useMemo(() => shown(g, filter), [g, filter]);
  const pos = useMemo(() => layout(s.nodes, s.edges, { ...saved, ...moved }), [s, saved, moved]);
  const deg = useMemo(() => degrees(s.edges), [s]);
  const clusters = useMemo(() => clustersOf(s.nodes, s.edges), [s]);
  const lit = useMemo(() => matches(s.nodes, q), [s, q]);
  const selNode = sel ? s.nodes.find((n) => n.nodeId === sel) : undefined;
  const vgraph = useMemo<ViewerGraph>(() => ({
    nodes: s.nodes.map((x) => ({ nodeId: x.nodeId, title: x.title, kind: x.kind, ...(x.link ? { link: x.link } : {}) })),
    edges: s.edges.map((x) => ({ from: x.from, to: x.to, kind: "link" as const })),
  }), [s]);
  const agentName = data.agents.find((a) => a.id === agent)?.name ?? "Agent";

  // a new picture fits the window again; a pan or zoom by the person is kept until then
  const sig = `${scope}:${agent}:${asOf ?? "now"}:${[...layers].sort().join()}:${[...kinds].sort().join()}`;
  const last = useRef(sig);
  useEffect(() => { if (last.current !== sig) { last.current = sig; setSel(null); setMoved({}); } }, [sig]);
  const seq = useRef(0);
  const send = (kind: "in" | "out" | "fit" | "focus", node?: string): void => { seq.current += 1; setCommand({ id: seq.current, kind, ...(node ? { node } : {}) }); };

  const open = (id: string): void => { const n = g.nodes.find((x) => x.nodeId === id); data.nav.openNote(id, n?.link); };
  const onKey = (e: { key: string; shiftKey?: boolean; preventDefault?: () => void }): void => {
    if (e.key === "Tab") {
      const order = tabOrder(s.nodes, pos);
      if (order.length === 0) return;
      e.preventDefault?.();
      const at = sel ? order.indexOf(sel) : -1;
      const next = order[(at + (e.shiftKey ? -1 : 1) + order.length) % order.length];
      if (next) { setSel(next); send("focus", next); }
    } else if (e.key === "Enter" && sel) { e.preventDefault?.(); open(sel); }
    else if (e.key === "Escape") setSel(null);
    else if (e.key === "+" || e.key === "=") { e.preventDefault?.(); send("in"); }
    else if (e.key === "-") { e.preventDefault?.(); send("out"); }
    else if (e.key === "0") { e.preventDefault?.(); send("fit"); }
  };

  const layerEntries = (): MenuEntry[] => [
    { head: "Layers" },
    ...each(GRAPH_LAYERS, (l): MenuEntry => ({ label: LAYER_LABEL[l], checked: layers.has(l), onSelect: () => setLayers(toggled(layers, l)) })),
    { separator: true },
    { head: "Personal layers are private" },
  ];
  const kindEntries = (): MenuEntry[] => [
    { head: "Kinds" },
    ...each(KINDS, (k): MenuEntry => ({ label: KIND_LABEL[k], checked: kinds.size === 0 || kinds.has(k), onSelect: () => setKinds(toggled(kinds, k)) })),
    ...(kinds.size > 0 ? [{ separator: true } as MenuEntry, { label: "Show every kind", onSelect: () => setKinds(new Set()) } as MenuEntry] : []),
  ];
  const agentEntries = (): MenuEntry[] => [{ head: "Agent" }, ...each(data.agents, (a): MenuEntry => ({ label: a.name, checked: a.id === agent, onSelect: () => setAgent(a.id) }))];
  const nodeMenu = (id: string, x: number, y: number): void => {
    setSel(id);
    menu.show([{ label: "Open Beside", onSelect: () => open(id) }, { label: "Focus Here", onSelect: () => send("focus", id) }], x, y);
  };
  const doExport = (): void => {
    setNote(null);
    exportGraph(data, scope, scope === "agent" ? agent : undefined, asOf, [...kinds]).then(() => setNote("Graph exported to Files. Personal layers are not in it.")).catch((e: unknown) => setNote(errorText(e, "Could not export the graph")));
  };
  const drop = (id: string, p: { x: number; y: number }): void => {
    const next = { ...saved, ...moved, [id]: p };
    setMoved((cur) => ({ ...cur, [id]: p }));
    saveLayout(data, scope, scope === "agent" ? agent : undefined, next).catch((e: unknown) => setNote(errorText(e, "Could not save the layout")));
  };

  const empty = s.nodes.length === 0;
  const web = Platform.OS === "web";
  return (
    <View style={m.main} testID="memory-graph" accessibilityLabel="Memory graph">
      <View style={m.head} testID="graph-head">
        <View style={m.crumb}>
          <Icon name="graph" size={16} color="var(--ink-3)" />
          <Text accessibilityRole="header" aria-level={1} style={m.h1}>Graph</Text>
          {scope === "agent" ? (
            <>
              <Text style={m.slash}>/</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Agent, ${agentName}`} testID="graph-agent" onPress={(e) => { const p = pointOf(e); menu.show(agentEntries(), p.x, p.y); }} style={({ hovered }: { hovered?: boolean }) => [m.pick, hovered === true && m.over]}>
                <Text style={m.pickText}>{agentName}</Text>
                <Icon name="chevd" size={9} color="var(--ink-3)" />
              </Pressable>
            </>
          ) : null}
        </View>
        <View style={m.grow} />
        <View style={m.seg} accessibilityRole="radiogroup" accessibilityLabel="Scope">
          {each(["agent", "space"] as const, (k) => (
            <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: scope === k }} testID={`scope-${k}`} onPress={() => setScope(k)} style={[m.segBtn, scope === k && m.segOn]}>
              <Text style={[m.segText, scope === k && m.segTextOn]}>{k === "agent" ? agentName : "Whole Space"}</Text>
            </Pressable>
          ))}
        </View>
        <View style={m.find}>
          <Icon name="find" size={13} color="var(--ink-3)" />
          {web
            ? createElement("input", { value: q, placeholder: "Find a note", "aria-label": "Find a note", "data-testid": "graph-find", onChange: (e: { target: { value: string } }) => setQ(e.target.value), style: { border: 0, outline: 0, background: "transparent", color: "var(--ink)", font: "inherit", fontSize: 13, width: 130 } })
            : null}
        </View>
        <QuietButton icon="layers" label="Layers" lit={layers.size < GRAPH_LAYERS.length} testID="graph-layers" onPress={(x, y) => menu.show(layerEntries(), x, y)} />
        <QuietButton icon="filter" label="Kinds" lit={kinds.size > 0} testID="graph-kinds" onPress={(x, y) => menu.show(kindEntries(), x, y)} />
        <QuietButton icon="export" label="Export" testID="graph-export" onPress={doExport} />
      </View>
      <View style={m.time} testID="graph-time">
        <Icon name="clock" size={14} color="var(--ink-3)" />
        <Text style={m.timeText}>What it believed</Text>
        {web
          ? createElement("input", { type: "range", min: 0, max: SLIDER_DAYS, value: step, "aria-label": "Time", "aria-valuetext": sliderText(step, now), "data-testid": "graph-slider", onChange: (e: { target: { value: string } }) => setStep(Number(e.target.value)), style: { flex: 1, maxWidth: 280, accentColor: "var(--accent)" } })
          : null}
        <Text style={m.timeVal} testID="graph-day">{sliderText(step, now)}</Text>
        {asOf !== undefined ? <Pressable accessibilityRole="button" testID="graph-now" onPress={() => setStep(SLIDER_DAYS)}><Text style={m.link}>Back to now</Text></Pressable> : null}
      </View>
      {note ? <Text style={m.note} accessibilityRole="alert" testID="graph-note">{note}</Text> : null}
      <View style={m.body} onLayout={(e: { nativeEvent: { layout: { width: number } } }) => setNarrow(e.nativeEvent.layout.width < 760)}>
      <View style={m.wrap} testID="graph-wrap">
        {empty ? (
          <States kind="empty" title={g.nodes.length > 0 ? "Every note is filtered out." : "No notes to draw yet"} icon="files" {...(g.nodes.length > 0 ? { action: { label: "Show everything", onPress: () => { setLayers(ALL_LAYERS); setKinds(new Set()); setQ(""); } } } : {})} />
        ) : (
          <>
            <GraphSurface
              nodes={s.nodes} edges={s.edges} pos={pos} deg={deg} sel={sel} lit={lit} fitKey={sig} command={command}
              onSelect={setSel} onOpen={open} onDrop={drop} onKey={onKey} onMenu={nodeMenu}
              kinds={kinds} onKind={(k) => setKinds(kinds.size === 0 ? new Set(KINDS.filter((x) => x !== k)) : toggled(kinds, k))} narrow={narrow}
            />
            <View style={m.zoom} testID="graph-zoom">
              <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" testID="zoom-in" onPress={() => send("in")} style={m.zBtn}><Icon name="plus" size={14} color="var(--ink-2)" /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" testID="zoom-out" onPress={() => send("out")} style={m.zBtn}><Icon name="minus" size={14} color="var(--ink-2)" /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Fit to window" testID="zoom-fit" onPress={() => send("fit")} style={m.zBtn}><Icon name="fit" size={14} color="var(--ink-2)" /></Pressable>
            </View>
          </>
        )}
      </View>
      {selNode ? (
        <NotePane
          node={selNode} narrow={narrow} winW={winW} links={deg.get(selNode.nodeId) ?? 0} graph={vgraph}
          outs={s.edges.filter((x) => x.from === selNode.nodeId).map((x) => s.nodes.find((y) => y.nodeId === x.to)?.title ?? "").filter((t) => t !== "")}
          onClose={() => setSel(null)} onOpenLink={(id) => { setSel(id); send("focus", id); }}
        />
      ) : null}
      </View>
      <View style={m.foot}>
        <Text style={m.stat} testID="graph-stat">{statText(s, clusters)}</Text>
        {s.hidden > 0 ? <Text style={m.stat} testID="graph-hidden">{`${s.hidden} hidden by the filters`}</Text> : null}
        <View style={m.grow} />
        {each(clusters.slice(0, 4), (c) => <Text key={c.name} style={m.cluster} testID={`cluster-${c.name}`}>{`${c.name} ${c.size}`}</Text>)}
      </View>
      {menu.element}
    </View>
  );
}

const m = StyleSheet.create({
  main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  head: { minHeight: 48, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4, paddingLeft: 18, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  crumb: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  h1: { margin: 0, fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  slash: { fontSize: 14, color: "var(--ink-4)" as string },
  pick: { height: 26, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, borderRadius: 6 },
  pickText: { fontSize: 13, color: "var(--ink-2)" as string },
  over: { backgroundColor: "var(--hover)" as string },
  grow: { flex: 1 },
  seg: { flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  segBtn: { height: 24, paddingHorizontal: 10, borderRadius: 6, justifyContent: "center" },
  segOn: { backgroundColor: "var(--raised)" as string },
  segText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  segTextOn: { color: "var(--ink)" as string, fontWeight: "500" },
  find: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, borderRadius: 7, backgroundColor: "var(--sunk)" as string },
  time: { height: 38, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  timeText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  timeVal: { minWidth: 44, fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string, fontVariant: ["tabular-nums"] },
  link: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  note: { fontSize: 12.5, color: "var(--ink-2)" as string, paddingHorizontal: 18, paddingVertical: 6 },
  wrap: { flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" },
  zoom: { position: "absolute", right: 14, bottom: 14, borderRadius: 9, backgroundColor: "var(--raised)" as string, overflow: "hidden", boxShadow: "var(--sh-1), inset 0 0 0 1px var(--line)" } as object,
  zBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, minHeight: 0, flexDirection: "row" },
  paneCol: { flexShrink: 0, minHeight: 0 },
  paneOver: { position: "absolute", top: 0, right: 0, bottom: 0 },
  foot: { height: 32, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 18, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  stat: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  cluster: { fontSize: 12, color: "var(--ink-3)" as string },
});

/** The screen, or its frame while the shell has not provided the data yet. */
export function MemoryGraph(props: MemoryGraphProps): ReactElement {
  const data = useOptionalMemoryData();
  if (!data) return <View style={m.main} testID="memory-graph-loading" accessibilityLabel="Loading"><View style={m.head}><Text accessibilityRole="header" style={m.h1}>Graph</Text></View></View>;
  return <GraphBody {...props} />;
}
