// Files > Knowledge > Graph (spec 2.15, 3.5): the notes of an agent's memory (or of the whole Space) as a graph. Nodes are notes, people, clients, projects, sites, decisions, records and chats, one
// colour per kind; edges are links, relations and "came from"; clusters take the name of their hub. Layers and Kinds filter it from quiet header menus with checkmarks, the time slider asks what the
// agent believed on a day, Find lights the notes that match, and a node can be dragged: where it was left is saved for this person. Personal layers are never drawn. A click opens the note beside the graph.
// DECISION: the surface is drawn here as SVG (nodes, links and labels) behind GraphSurface, because sigma and graphology are allowed dependencies (scripts/allowlist.json) but are in neither
// package.json nor the lock file, and a dependency needs an install this worker cannot run. GraphSurface takes the same nodes, edges, positions and view a sigma renderer would, so it swaps in whole.
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { errorText, exportGraph, saveLayout } from "./actions.ts";
import { useLive, useMemoryData, useOptionalMemoryData } from "./data.tsx";
import {
  ALL_LAYERS, GRAPH_LAYERS, KINDS, KIND_LABEL, LAYER_LABEL, MAX_K, MIN_K, SLIDER_DAYS, asOfOf, clustersOf, degrees, each, fit, hit, kindColor, layout, matches, neighborsOf, radiusOf, shown, sliderText, statText, tabOrder,
  toScreen, toWorld, toggled, zoomAt,
} from "./model.ts";
import type { GNode, GraphOut, Positions, View as Viewport } from "./model.ts";
import { Icon, QuietButton, pointOf } from "./parts.tsx";

const EMPTY: GraphOut = { nodes: [], edges: [], clusters: [] };
const DEFAULT = { w: 900, h: 560 };

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

// ---------------------------------------------------------------- the surface

interface SurfaceProps {
  nodes: readonly GNode[]; edges: GraphOut["edges"]; pos: Positions; view: Viewport; w: number; h: number;
  sel: string | null; lit: ReadonlySet<string>; hover: string | null; deg: ReadonlyMap<string, number>;
  onHover: (id: string | null) => void; onSelect: (id: string | null) => void; onOpen: (id: string) => void;
  onPan: (dx: number, dy: number) => void; onZoom: (f: number, x: number, y: number) => void; onMove: (id: string, p: { x: number; y: number }) => void; onDrop: () => void;
  onKey: (e: { key: string; shiftKey?: boolean; preventDefault?: () => void }) => void; onMenu: (id: string, x: number, y: number) => void;
}

/** Draws the graph and takes the pointer. Replaceable by a WebGL renderer with the same props. */
function GraphSurface(p: SurfaceProps): ReactElement | null {
  const down = useRef<{ x: number; y: number; id: string | null; moved: boolean } | null>(null);
  if (Platform.OS !== "web") return null;
  const near = p.sel ? neighborsOf(p.sel, p.edges) : null;
  const labelAll = p.view.k >= 0.7 || p.nodes.length <= 14;
  const at = (e: { clientX: number; clientY: number; currentTarget: { getBoundingClientRect(): { left: number; top: number } } }): { x: number; y: number } => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const kids: ReactElement[] = [];
  for (const e of p.edges) {
    const a = p.pos[e.from], b = p.pos[e.to];
    if (!a || !b) continue;
    const s = toScreen(p.view, a), t = toScreen(p.view, b);
    const on = p.sel !== null && (e.from === p.sel || e.to === p.sel);
    const dim = near !== null && !on;
    kids.push(createElement("line", {
      key: `${e.from}>${e.to}:${e.kind}`, x1: s.x, y1: s.y, x2: t.x, y2: t.y, "data-edge": `${e.from}>${e.to}`, "data-kind": e.kind, "data-emphasis": on ? "hot" : dim ? "dim" : "idle",
      style: { stroke: on ? "var(--accent)" : "var(--ink-4)", strokeWidth: on ? 2 : 1.2, opacity: dim ? 0.15 : e.kind === "came_from" ? 0.5 : 0.85, strokeDasharray: e.kind === "came_from" ? "3 3" : undefined },
    }));
  }
  for (const n of p.nodes) {
    const q = p.pos[n.nodeId];
    if (!q) continue;
    const s = toScreen(p.view, q);
    const r = radiusOf(p.deg.get(n.nodeId) ?? 0);
    const dim = (near !== null && !near.has(n.nodeId)) || (p.lit.size > 0 && !p.lit.has(n.nodeId));
    const on = p.sel === n.nodeId, over = p.hover === n.nodeId;
    kids.push(createElement("circle", {
      key: `c:${n.nodeId}`, cx: s.x, cy: s.y, r: on || over ? r + 2 : r, "data-testid": `gnode-${n.nodeId}`, "data-kind": n.kind, "data-selected": on ? "true" : "false",
      style: { fill: kindColor(n.kind), stroke: on ? "var(--accent)" : "var(--win)", strokeWidth: on ? 3 : 2, opacity: dim ? 0.2 : 1, cursor: "pointer" },
    }));
    if (labelAll || on || over || p.lit.has(n.nodeId)) {
      kids.push(createElement("text", { key: `t:${n.nodeId}`, x: s.x, y: s.y + r + 13, textAnchor: "middle", "data-testid": `glabel-${n.nodeId}`, style: { fill: "var(--ink-2)", fontSize: 11.5, opacity: dim ? 0.25 : 1, pointerEvents: "none", fontWeight: on ? 600 : 400 } }, n.title));
    }
  }
  return createElement(
    "svg",
    {
      width: p.w, height: p.h, tabIndex: 0, role: "img", "aria-label": "Memory graph. Tab walks the notes, Enter opens one, plus and minus zoom.", "data-testid": "graph-surface",
      style: { display: "block", touchAction: "none", outline: "none", cursor: "grab", userSelect: "none" },
      onPointerDown: (e: { clientX: number; clientY: number; pointerId: number; button?: number; currentTarget: { setPointerCapture?: (id: number) => void; getBoundingClientRect(): { left: number; top: number } } }) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const c = at(e);
        down.current = { x: c.x, y: c.y, id: hit(p.nodes, p.pos, p.deg, p.view, c.x, c.y), moved: false };
      },
      onPointerMove: (e: { clientX: number; clientY: number; currentTarget: { getBoundingClientRect(): { left: number; top: number } } }) => {
        const c = at(e), d = down.current;
        if (!d) { const id = hit(p.nodes, p.pos, p.deg, p.view, c.x, c.y); if (id !== p.hover) p.onHover(id); return; }
        if (!d.moved && Math.hypot(c.x - d.x, c.y - d.y) < 4) return;
        d.moved = true;
        if (d.id) p.onMove(d.id, toWorld(p.view, c.x, c.y)); else { p.onPan(c.x - d.x, c.y - d.y); d.x = c.x; d.y = c.y; }
      },
      onPointerUp: () => {
        const d = down.current;
        down.current = null;
        if (!d) return;
        if (d.moved && d.id) p.onDrop(); else if (!d.moved) p.onSelect(d.id);
      },
      onPointerLeave: () => { if (!down.current && p.hover) p.onHover(null); },
      onDoubleClick: (e: { clientX: number; clientY: number; currentTarget: { getBoundingClientRect(): { left: number; top: number } } }) => { const c = at(e); const id = hit(p.nodes, p.pos, p.deg, p.view, c.x, c.y); if (id) p.onOpen(id); },
      onWheel: (e: { clientX: number; clientY: number; deltaY: number; ctrlKey?: boolean; preventDefault?: () => void; currentTarget: { getBoundingClientRect(): { left: number; top: number } } }) => { const c = at(e); p.onZoom(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), c.x, c.y); },
      onContextMenu: (e: { clientX: number; clientY: number; preventDefault(): void; currentTarget: { getBoundingClientRect(): { left: number; top: number } } }) => {
        const c = at(e), id = hit(p.nodes, p.pos, p.deg, p.view, c.x, c.y);
        if (!id) return;
        e.preventDefault();
        p.onMenu(id, e.clientX, e.clientY);
      },
      onKeyDown: p.onKey,
    },
    ...kids,
  );
}

// ---------------------------------------------------------------- the screen

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
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<Viewport | null>(null);
  const [moved, setMoved] = useState<Positions>({});
  const [size, setSize] = useState(DEFAULT);
  const [note, setNote] = useState<string | null>(null);
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
  const ids = useMemo(() => each(s.nodes, (n) => n.nodeId), [s]);
  const v = view ?? fit(pos, ids, size.w, size.h);
  const selNode = sel ? s.nodes.find((n) => n.nodeId === sel) : undefined;
  const agentName = data.agents.find((a) => a.id === agent)?.name ?? "Agent";

  // a new picture fits the window again; a pan or zoom by the person is kept until then
  const sig = `${scope}:${agent}:${asOf ?? "now"}:${[...layers].sort().join()}:${[...kinds].sort().join()}`;
  const last = useRef(sig);
  useEffect(() => { if (last.current !== sig) { last.current = sig; setView(null); setSel(null); setMoved({}); } }, [sig]);

  const open = (id: string): void => { const n = g.nodes.find((x) => x.nodeId === id); data.nav.openNote(id, n?.link); };
  const onKey = (e: { key: string; shiftKey?: boolean; preventDefault?: () => void }): void => {
    if (e.key === "Tab") {
      const order = tabOrder(s.nodes, pos);
      if (order.length === 0) return;
      e.preventDefault?.();
      const at = sel ? order.indexOf(sel) : -1;
      const next = order[(at + (e.shiftKey ? -1 : 1) + order.length) % order.length];
      if (next) setSel(next);
    } else if (e.key === "Enter" && sel) { e.preventDefault?.(); open(sel); }
    else if (e.key === "Escape") setSel(null);
    else if (e.key === "+" || e.key === "=") { e.preventDefault?.(); setView(zoomAt(v, 1.2, size.w / 2, size.h / 2)); }
    else if (e.key === "-") { e.preventDefault?.(); setView(zoomAt(v, 1 / 1.2, size.w / 2, size.h / 2)); }
    else if (e.key === "0") { e.preventDefault?.(); setView(null); }
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
    menu.show([{ label: "Open Beside", onSelect: () => open(id) }, { label: "Focus Here", onSelect: () => setView(zoomAt({ ...v, x: size.w / 2 - (pos[id]?.x ?? 0) * v.k, y: size.h / 2 - (pos[id]?.y ?? 0) * v.k }, 1.4, size.w / 2, size.h / 2)) }], x, y);
  };
  const doExport = (): void => {
    setNote(null);
    exportGraph(data, scope, scope === "agent" ? agent : undefined, asOf, [...kinds]).then(() => setNote("Graph exported to Files. Personal layers are not in it.")).catch((e: unknown) => setNote(errorText(e, "Could not export the graph")));
  };
  const drop = (): void => {
    saveLayout(data, scope, scope === "agent" ? agent : undefined, { ...saved, ...moved }).catch((e: unknown) => setNote(errorText(e, "Could not save the layout")));
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
      <View style={m.wrap} onLayout={(e) => { const { width, height } = e.nativeEvent.layout; if (width > 0 && height > 0 && (width !== size.w || height !== size.h)) setSize({ w: Math.round(width), h: Math.round(height) }); }} testID="graph-wrap">
        {empty ? (
          <States kind="empty" title={g.nodes.length > 0 ? "Every note is filtered out." : "No notes to draw yet"} icon="files" {...(g.nodes.length > 0 ? { action: { label: "Show everything", onPress: () => { setLayers(ALL_LAYERS); setKinds(new Set()); setQ(""); } } } : {})} />
        ) : (
          <>
            <GraphSurface
              nodes={s.nodes} edges={s.edges} pos={pos} view={v} w={size.w} h={size.h} sel={sel} lit={lit} hover={hover} deg={deg}
              onHover={setHover} onSelect={setSel} onOpen={open} onPan={(dx, dy) => setView({ ...v, x: v.x + dx, y: v.y + dy })} onZoom={(f, x, y) => setView(zoomAt(v, f, x, y))}
              onMove={(id, p) => setMoved((cur) => ({ ...cur, [id]: { x: Math.round(p.x), y: Math.round(p.y) } }))} onDrop={drop} onKey={onKey} onMenu={nodeMenu}
            />
            <View style={m.zoom} testID="graph-zoom">
              <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" testID="zoom-in" disabled={v.k >= MAX_K} onPress={() => setView(zoomAt(v, 1.25, size.w / 2, size.h / 2))} style={m.zBtn}><Icon name="plus" size={14} color="var(--ink-2)" /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" testID="zoom-out" disabled={v.k <= MIN_K} onPress={() => setView(zoomAt(v, 0.8, size.w / 2, size.h / 2))} style={m.zBtn}><Icon name="minus" size={14} color="var(--ink-2)" /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Fit to window" testID="zoom-fit" onPress={() => setView(null)} style={m.zBtn}><Icon name="fit" size={14} color="var(--ink-2)" /></Pressable>
            </View>
            {selNode ? (
              <View style={m.card} testID="graph-selected" accessibilityRole="summary">
                <View style={m.cardHead}><View style={[m.dot, { backgroundColor: kindColor(selNode.kind) }]} /><Text numberOfLines={1} style={m.cardTitle}>{selNode.title}</Text></View>
                <Text style={m.cardSub}>{`${KIND_LABEL[selNode.kind].replace(/s$/, "")}${selNode.cluster ? ` in ${selNode.cluster}` : ""} · ${deg.get(selNode.nodeId) ?? 0} links`}</Text>
                <Pressable accessibilityRole="button" testID="graph-open" onPress={() => open(selNode.nodeId)} style={({ hovered }: { hovered?: boolean }) => [m.openBtn, hovered === true && m.over]}><Text style={m.link}>Open beside</Text></Pressable>
              </View>
            ) : null}
          </>
        )}
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
  wrap: { flex: 1, minHeight: 0, overflow: "hidden" },
  zoom: { position: "absolute", right: 14, bottom: 14, borderRadius: 9, backgroundColor: "var(--raised)" as string, overflow: "hidden", boxShadow: "var(--sh-1), inset 0 0 0 1px var(--line)" } as object,
  zBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  card: { position: "absolute", left: 14, bottom: 14, maxWidth: 280, padding: 12, gap: 4, borderRadius: 11, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-2), inset 0 0 0 1px var(--line)" } as object,
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 9 },
  cardTitle: { flexShrink: 1, fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  cardSub: { fontSize: 12, color: "var(--ink-3)" as string },
  openBtn: { alignSelf: "flex-start", height: 24, justifyContent: "center", paddingHorizontal: 6, borderRadius: 6 },
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
