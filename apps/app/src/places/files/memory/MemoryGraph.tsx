// Files > Knowledge > Graph (spec 2.15, 3.5): what the Space knows as a picture, opening on one subject. The header is the Knowledge header (Knowledge > Graph > the subject, a chip that opens a picker with
// search) with "Around <First name>" | "Whole Space", Layers (Space, Project, Agent; Personal is private and never drawn) and Types (with counts), both quiet menus with checkmarks, a "..." menu (Export,
// Fit, Show everything) and the one Search knowledge field. Around asks memory.graph for the subject and two hops; Whole Space asks without a subject. Nodes are typed (one hue each, chats are rounded
// squares) and every edge carries its label; a click on an edge selects it and shows the evidence under it: the words, where they were said, the day, and Open the chat. A click on a node shows its
// neighbours and a card; double-click or Enter opens its page (a chat opens in Chats). The slider "What we know now" asks what was known on a day. The legend (bottom left) counts what is drawn and a
// row toggles that type, the same state as the Types menu. Zoom is at the bottom right and on + - 0, Tab walks the nodes, the arrow keys pan, Escape closes the card. Right-click: node (Open page,
// Show around this, Open in Chats, Copy name), edge (Show evidence, Copy quote), background (Fit, Around/Whole Space, Back to now). A drag saves the layout; personal layers never reach the screen.
// The route follows the person: a new subject, scope or edge goes to nav.go so back and forward work, without remounting this screen. The surface is a canvas (GraphSurface.tsx).
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { errorText, exportGraph, saveLayout } from "./actions.ts";
import { useLive, useMemoryData, useOptionalMemoryData } from "./data.tsx";
import type { MemoryData } from "./data.tsx";
import { GraphSurface } from "./GraphSurface.tsx";
import type { SurfaceCommand, SurfaceMenu } from "./GraphSurface.tsx";
import { KnowHeader, frame } from "./KnowFrame.tsx";
import { SubjectTile } from "./KnowParts.tsx";
import { KIND_ONE, dateText } from "./know.ts";
import type { PageKind } from "./know.ts";
import {
  ALL_LAYERS, GRAPH_LAYERS, HOPS, KINDS, KIND_LABEL, SLIDER_DAYS, asOfOf, backgroundMenu, degrees, dropOrphans, each, edgeByKey, edgeMenu, filterBanner, firstName, graphRoute, keyAction, kindColor, kindOne, kindCounts, layerCounts, layerMenu,
  layout, layoutAround, legendMenu, matches, moreMenu, nextTab, nodeMenu, pageOf, pickPages, shown, sliderText, sliderTicks, startSubject, statLine, tabOrder, toggleKindSet, toggled, typeMenu,
} from "./model.ts";
import type { GraphOut, KGEdge, KGNode, Kind, Positions } from "./model.ts";
import { Icon, QuietButton, pointOf } from "./parts.tsx";

/** Past this many nodes the relaxed layout (quadratic) gives way to the fast one. */
const AROUND_MAX = 150;
const EMPTY: GraphOut = { nodes: [], edges: [], clusters: [] };

export interface MemoryGraphProps {
  /** Kept for the old mounts: the graph is no longer one agent's; it is around a subject or the whole Space. */
  agentId?: string;
  /** Old name for the scope: "space" with no focus is the whole Space. */
  scope?: "agent" | "space";
  /** Start with this node selected. */
  selected?: string | null;
  /** Start the time slider on this step (0 is thirty days ago, 30 is now). */
  step?: number;
  /** Light the nodes whose name has this text in it. */
  find?: string;
  /** Open around this subject (a page id or node id) rather than the first page. */
  focus?: string;
  /** With a focus: true is "Around <subject>", false is "Whole Space". Left out it is true. */
  around?: boolean;
  /** Open with this edge's evidence card showing (`<from>><to>`). */
  edge?: string;
}

// ---------------------------------------------------------------- the pieces

/** The subject picker: a field and the pages under it. Enter takes the first match, the arrows move, Escape closes. */
export function Picker({ pages, current, onPick, onClose }: { pages: readonly { pageId: string; title: string; kind: PageKind }[]; current: string | undefined; onPick: (id: string) => void; onClose: () => void }): ReactElement {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const list = pickPages(pages, q);
  const move = (e: { key: string; preventDefault?: () => void; stopPropagation?: () => void }): void => {
    if (e.key === "Escape") { e.stopPropagation?.(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault?.(); setAt(Math.min(list.length - 1, at + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault?.(); setAt(Math.max(0, at - 1)); }
    else if (e.key === "Enter") { e.preventDefault?.(); const p = list[at]; if (p) onPick(p.pageId); }
  };
  return (
    <>
      <Pressable accessibilityLabel="Close" accessibilityRole="button" testID="graph-pick-away" onPress={onClose} style={m.away} />
      <View style={m.picker} testID="graph-picker" accessibilityRole="menu" accessibilityLabel="Center the graph on">
        <Text style={m.pickHead}>Center the graph on</Text>
        <View style={m.pickFind}>
          <Icon name="find" size={13} color="var(--ink-3)" />
          {Platform.OS === "web"
            ? createElement("input", { value: q, autoFocus: true, placeholder: "Find a page", "aria-label": "Find a page", "data-testid": "graph-pick-q", onChange: (e: { target: { value: string } }) => { setQ(e.target.value); setAt(0); }, onKeyDown: move, style: { border: 0, outline: 0, background: "transparent", color: "var(--ink)", font: "inherit", fontSize: 13, flex: 1, minWidth: 0 } })
            : null}
        </View>
        <View style={m.pickList}>
          {each(list, (p, i) => (
            <Pressable key={p.pageId} accessibilityRole="menuitem" accessibilityState={{ checked: p.pageId === current }} testID={`graph-pick-${p.pageId}`} onPress={() => onPick(p.pageId)} style={({ hovered }: { hovered?: boolean }) => [m.pickRow, (hovered === true || i === at) && m.over]}>
              <SubjectTile name={p.title} kind={p.kind} size={18} />
              <Text style={m.pickName} numberOfLines={1}>{p.title}</Text>
              <Text style={m.pickKind}>{KIND_ONE[p.kind]}</Text>
              {p.pageId === current ? <Icon name="check" size={12} color="var(--accent)" /> : null}
            </Pressable>
          ))}
          {list.length === 0 ? <Text style={m.pickNone}>No page matches.</Text> : null}
        </View>
      </View>
    </>
  );
}

/** The evidence under a selected edge: "Ian Brooks prefers Client update cadence", the words, where they were said, the day and Open the chat. */
export function Evidence({ edge, from, to, now, onClose, data }: { edge: KGEdge; from: string; to: string; now: number; onClose: () => void; data: MemoryData }): ReactElement {
  const link = edge.source?.link;
  return (
    <View style={m.card} testID="graph-evidence" accessibilityRole="summary" accessibilityLabel={`${from} ${edge.label ?? "links to"} ${to}`}>
      <View style={m.cardHead}>
        <Text style={m.cardTitle} testID="graph-evidence-title">{from}{" "}<Text style={m.cardLabel}>{edge.label ?? "links to"}</Text>{" "}{to}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" testID="graph-evidence-close" onPress={onClose} style={({ hovered }: { hovered?: boolean }) => [m.ib, hovered === true && m.over]}><Icon name="x" size={13} color="var(--ink-3)" /></Pressable>
      </View>
      {edge.evidence ? <View style={m.quote} testID="graph-evidence-quote"><Text style={m.quoteText}>{`“${edge.evidence}”`}</Text></View> : null}
      <View style={m.cardFoot}>
        {edge.source ? (
          <Pressable accessibilityRole="link" accessibilityLabel={`Source: ${edge.source.title}`} testID="graph-evidence-source" onPress={() => { if (link) data.nav.openChat(link); }} style={({ hovered }: { hovered?: boolean }) => [m.src, hovered === true && link !== undefined && m.srcOver]}>
            <Icon name={edge.source.kind === "chat" ? "chat" : edge.source.kind === "channel" ? "hash" : "sheet"} size={11} color="var(--ink-3)" />
            <Text style={m.srcText} numberOfLines={1}>{edge.source.title}</Text>
          </Pressable>
        ) : null}
        {edge.at !== undefined ? <Text style={m.cardDate} testID="graph-evidence-date">{dateText(edge.at, now)}</Text> : null}
        <View style={m.grow} />
        {link ? (
          <Pressable accessibilityRole="button" testID="graph-evidence-open" onPress={() => data.nav.openChat(link)} style={({ hovered }: { hovered?: boolean }) => [m.hm, hovered === true && m.over]}>
            <Icon name="jump" size={13} color="var(--ink-2)" />
            <Text style={m.hmText}>{edge.source?.kind === "chat" ? "Open the chat" : "Open the source"}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** The card of a selected node: its name and kind, how many links it has, and the way into it. */
export function NodeCard({ node, links, canFocus, page, onFocus, onOpen, onClose }: { node: KGNode; links: number; canFocus: boolean; page: boolean; onFocus: () => void; onOpen: () => void; onClose: () => void }): ReactElement {
  const chat = node.kind === "chat" && node.link !== undefined;
  return (
    <View style={m.card} testID="graph-selected" accessibilityRole="summary" accessibilityLabel={`${node.title}, ${KIND_LABEL[node.kind]}`}>
      <View style={m.cardHead}>
        <View style={[m.dot, { backgroundColor: kindColor(node.kind) as string }]} />
        <Text style={m.cardTitle} numberOfLines={1}>{node.title}</Text>
        <Text style={m.badge}>{kindOne(node.kind)}</Text>
        <View style={m.grow} />
        <Pressable accessibilityRole="button" accessibilityLabel="Close" testID="graph-selected-close" onPress={onClose} style={({ hovered }: { hovered?: boolean }) => [m.ib, hovered === true && m.over]}><Icon name="x" size={13} color="var(--ink-3)" /></Pressable>
      </View>
      <View style={m.cardFoot}>
        <Text style={m.cardDate}>{`${links} ${links === 1 ? "link" : "links"}`}</Text>
        <View style={m.grow} />
        {canFocus ? <Pressable accessibilityRole="button" testID="graph-selected-focus" onPress={onFocus} style={({ hovered }: { hovered?: boolean }) => [m.hm, hovered === true && m.over]}><Icon name="graph" size={13} color="var(--ink-2)" /><Text style={m.hmText}>Show around this</Text></Pressable> : null}
        {page || chat ? <Pressable accessibilityRole="button" testID="graph-selected-open" onPress={onOpen} style={({ hovered }: { hovered?: boolean }) => [m.hm, hovered === true && m.over]}><Icon name="jump" size={13} color="var(--ink-2)" /><Text style={m.hmText}>{chat ? "Open the chat" : "Open page"}</Text></Pressable> : null}
      </View>
    </View>
  );
}

const copy = (text: string): void => { void (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard?.writeText(text); };

// ---------------------------------------------------------------- the screen

function GraphBody(props: MemoryGraphProps): ReactElement {
  const { focus: focus0, around: around0, edge: edge0, scope: legacy, selected = null, step: step0 = SLIDER_DAYS, find = "" } = props;
  const data = useMemoryData();
  const menu = useMenu();
  const now = data.now();
  const [focus, setFocus] = useState<string | undefined>(focus0);
  const [around, setAround] = useState<boolean>(around0 ?? !(legacy === "space" && !focus0));
  const [selEdge, setSelEdge] = useState<string | null>(edge0 ?? null);
  const [sel, setSel] = useState<string | null>(edge0 ? null : selected);
  const [layers, setLayers] = useState<ReadonlySet<string>>(ALL_LAYERS);
  const [kinds, setKinds] = useState<ReadonlySet<string>>(new Set());
  const [step, setStep] = useState(step0);
  const [moved, setMoved] = useState<Positions>({});
  const [command, setCommand] = useState<SurfaceCommand | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [picking, setPicking] = useState(false);
  const asOf = asOfOf(step, now);

  // the route is the tab's hash: what this screen changes goes to nav.go; what comes back is only adopted when this screen did not send it (no loop, no remount)
  const sent = useRef<string | null>(null);
  const keyOf = (f: string | undefined, a: boolean, e: string | null | undefined): string => `${f ?? ""}|${a ? 1 : 0}|${e ?? ""}`;
  const go = (f: string | undefined, a: boolean, e: string | null): void => {
    sent.current = keyOf(f, a, e);
    data.nav.go(graphRoute(f, a, e));
  };
  const arrived = keyOf(focus0, around0 ?? true, edge0);
  const seen = useRef(arrived);
  useEffect(() => {
    if (seen.current === arrived) return;
    seen.current = arrived;
    if (sent.current === arrived) return;
    setFocus(focus0); setAround(around0 ?? true); setSelEdge(edge0 ?? null); setSel(null);
  }, [arrived, focus0, around0, edge0]);

  const pq = useLive("memory.page.list", { limit: 500 });
  const pages = pq.status === "ready" ? pq.data.pages : [];
  const pageIds = useMemo(() => new Set(pages.map((p) => p.pageId)), [pages]);
  const subjectId = focus ?? startSubject(pages, data.me);
  const askLayers = layers.size < GRAPH_LAYERS.length ? { layers: GRAPH_LAYERS.filter((l) => layers.has(l)) } : {};
  const askKinds = kinds.size > 0 ? { kinds: [...kinds] } : {};
  const base = { scope: "space" as const, ...(around && subjectId ? { focus: subjectId, hops: HOPS } : {}), ...(asOf !== undefined ? { asOf } : {}) };
  const gq = useLive("memory.graph", { ...base, ...askLayers, ...askKinds });
  const bq = useLive("memory.graph", base);
  const lq = useLive("memory.layout.get", { scope: "space" });
  const kept = useRef<GraphOut>(EMPTY);
  const keptBase = useRef<GraphOut>(EMPTY);
  if (gq.status === "ready") kept.current = gq.data;
  if (bq.status === "ready") keptBase.current = bq.data;
  const g = kept.current, b = keptBase.current;
  const saved: Positions = lq.status === "ready" ? lq.data.positions : {};
  const narrowed = layers.size < GRAPH_LAYERS.length || kinds.size > 0;
  const filter = useMemo(() => ({ layers, kinds, q: "" }), [layers, kinds]);
  const s = useMemo(() => {
    const x = shown(g, filter);
    return narrowed || asOf !== undefined ? dropOrphans(x, around ? subjectId : undefined) : x;
  }, [g, filter, narrowed, asOf, around, subjectId]);
  const nodes = s.nodes as KGNode[], edges = s.edges as KGEdge[];
  const center = around ? subjectId ?? null : null;
  // around a subject the picture is its own (the subject in the middle); a position kept by a drag in the Whole Space is not meant for it
  const pos = useMemo(() => {
    if (nodes.length > AROUND_MAX) return layout(nodes, edges, { ...(center ? { [center]: { x: 500, y: 500 } } : {}), ...saved, ...moved });
    if (center && nodes.some((n) => n.nodeId === center)) return { ...layoutAround(nodes, edges, center), ...moved };
    return { ...layoutAround(nodes, edges, null), ...saved, ...moved };
  }, [nodes, edges, center, saved, moved]);
  const deg = useMemo(() => degrees(edges), [edges]);
  const lit = useMemo(() => matches(nodes, find), [nodes, find]);
  const selNode = sel ? nodes.find((n) => n.nodeId === sel) : undefined;
  const edge = edgeByKey(edges, selEdge);
  const titleOf = (id: string): string => nodes.find((n) => n.nodeId === id)?.title ?? b.nodes.find((n) => n.nodeId === id)?.title ?? id;
  const subjectPage = pages.find((p) => p.pageId === subjectId);
  const subjectTitle = subjectPage?.title ?? (subjectId ? titleOf(subjectId) : "");
  const spaceName = (data as MemoryData & { spaceName?: string }).spaceName ?? "This Space";

  // a new picture fits the window again; a pan or zoom by the person is kept until then
  const sig = `${around ? subjectId ?? "" : "space"}:${asOf ?? "now"}:${[...layers].sort().join()}:${[...kinds].sort().join()}`;
  const last = useRef(sig);
  useEffect(() => { if (last.current !== sig) { last.current = sig; setMoved({}); } }, [sig]);
  const seq = useRef(0);
  const send = (c: Omit<SurfaceCommand, "id">): void => { seq.current += 1; setCommand({ id: seq.current, ...c }); };

  const pickNode = (id: string | null): void => { setSel(id); if (selEdge !== null) { setSelEdge(null); go(focus, around, null); } };
  const pickEdge = (key: string | null): void => { setSelEdge(key); setSel(null); go(focus, around, key); };
  const clear = (): void => { setSel(null); if (selEdge !== null) { setSelEdge(null); go(focus, around, null); } };
  const subject = (id: string | undefined, a: boolean): void => { setFocus(id); setAround(a); setSel(null); setSelEdge(null); setPicking(false); go(id, a, null); };
  const open = (id: string): void => {
    const n = nodes.find((x) => x.nodeId === id);
    if (!n) return;
    const page = pageOf(n, pageIds);
    if (page) data.nav.go({ v: "page", pageId: page });
    else if (n.kind === "chat" && n.link) data.nav.openChat(n.link);
    else data.nav.openNote(id, n.link);
  };
  const reset = (): void => { setLayers(ALL_LAYERS); setKinds(new Set()); };
  const toggleKind = (k: Kind): void => setKinds(toggleKindSet(kinds, k));

  const onKey = (e: { key: string; shiftKey?: boolean; preventDefault?: () => void }): void => {
    const a = keyAction(e, sel !== null);
    if (!a) return;
    if (a.k !== "clear") e.preventDefault?.();
    if (a.k === "tab") { const next = nextTab(tabOrder(nodes, pos), sel, a.back); if (next) { pickNode(next); send({ kind: "focus", node: next }); } }
    else if (a.k === "open") { if (sel) open(sel); }
    else if (a.k === "clear") clear();
    else if (a.k === "pan") send({ kind: "pan", dx: a.dx, dy: a.dy });
    else send({ kind: a.k });
  };
  // Escape closes the card wherever the focus is
  useEffect(() => {
    if (Platform.OS !== "web" || (sel === null && selEdge === null)) return;
    const w = globalThis as unknown as { addEventListener(t: string, f: (e: { key: string }) => void): void; removeEventListener(t: string, f: (e: { key: string }) => void): void };
    const f = (e: { key: string }): void => { if (e.key === "Escape") clear(); };
    w.addEventListener("keydown", f);
    return () => w.removeEventListener("keydown", f);
  });

  // the menus
  const counts = useMemo(() => kindCounts(b.nodes), [b]);
  const lcounts = useMemo(() => layerCounts(b.nodes), [b]);
  const doExport = (): void => {
    setNote(null);
    exportGraph(data, "space", undefined, asOf, [...kinds]).then(() => setNote("Graph exported to Files. Personal layers are not in it.")).catch((e: unknown) => setNote(errorText(e, "Could not export the graph")));
  };
  const surfaceMenu = (mn: SurfaceMenu): void => {
    if (mn.kind === "node" && mn.id) {
      const id = mn.id, n = nodes.find((x) => x.nodeId === id);
      if (!n) return;
      pickNode(id);
      const page = pageOf(n, pageIds);
      menu.show(nodeMenu(n, { page: page !== undefined, subject: id === center }, { open: () => open(id), around: () => { if (page) subject(page, true); }, chats: () => open(id), copy: () => copy(n.title) }), mn.x, mn.y);
    } else if (mn.kind === "edge" && mn.id) {
      const key = mn.id, e = edgeByKey(edges, key);
      if (e) menu.show(edgeMenu(e, { evidence: () => pickEdge(key), copy: () => copy(e.evidence ?? "") }), mn.x, mn.y);
    } else {
      menu.show(backgroundMenu({ around, subject: subjectId ? subjectTitle : null, past: asOf !== undefined, narrowed }, { fit: () => send({ kind: "fit" }), scope: () => { if (subjectId) subject(subjectId, !around); }, now: () => setStep(SLIDER_DAYS), reset }), mn.x, mn.y);
    }
  };
  const layerOn = { toggle: (l: string) => setLayers(toggled(layers, l)), all: () => setLayers(ALL_LAYERS) };
  const kindOn = { toggle: toggleKind, all: () => setKinds(new Set()) };
  const drop = (id: string, p: { x: number; y: number }): void => {
    const next = { ...saved, ...moved, [id]: p };
    setMoved((cur) => ({ ...cur, [id]: p }));
    saveLayout(data, "space", undefined, next).catch((e: unknown) => setNote(errorText(e, "Could not save the layout")));
  };

  // the legend: the kinds the Space has, with how many of each are drawn
  const drawn = kindCounts(nodes);
  const legend = KINDS.filter((k) => (counts.get(k) ?? 0) > 0 || (drawn.get(k) ?? 0) > 0);
  const ticks = sliderTicks(now);
  const ready = gq.status === "ready" || kept.current !== EMPTY;
  const empty = ready && nodes.length === 0;
  const web = Platform.OS === "web";
  const banner = filterBanner(layers, kinds);

  const right = (
    <>
      <View style={m.seg} accessibilityRole="radiogroup" accessibilityLabel="Scope">
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: around }} testID="scope-around" onPress={() => subject(subjectId, true)} style={[m.segBtn, around && m.segOn]}><Text style={[m.segText, around && m.segTextOn]} numberOfLines={1}>{`Around ${firstName(subjectTitle || "this")}`}</Text></Pressable>
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: !around }} testID="scope-space" onPress={() => subject(subjectId, false)} style={[m.segBtn, !around && m.segOn]}><Text style={[m.segText, !around && m.segTextOn]}>Whole Space</Text></Pressable>
      </View>
      <View style={m.div} />
      <QuietButton icon="users" label="Layers" lit={layers.size < GRAPH_LAYERS.length} testID="graph-layers" onPress={(x, y) => menu.show(layerMenu(layers, lcounts, layerOn), x, y, "other")} />
      <QuietButton icon="filter" label="Types" lit={kinds.size > 0} testID="graph-kinds" onPress={(x, y) => menu.show(typeMenu(kinds, counts, kindOn), x, y, "other")} />
      <Pressable accessibilityRole="button" accessibilityLabel="More" testID="graph-more" onPress={(e) => { const p = pointOf(e); menu.show(moreMenu({ past: asOf !== undefined, narrowed }, { export: doExport, fit: () => send({ kind: "fit" }), now: () => setStep(SLIDER_DAYS), reset }), p.x, p.y, "other"); }} style={({ hovered }: { hovered?: boolean }) => [m.more, hovered === true && m.over]}><Icon name="more" size={15} color="var(--ink-2)" /></Pressable>
    </>
  );
  const chip = around ? (
    <View style={m.chipWrap}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Center the graph on, ${subjectTitle}`} accessibilityState={{ expanded: picking }} testID="graph-subject" onPress={() => setPicking(!picking)} style={({ hovered }: { hovered?: boolean }) => [m.pick, hovered === true && m.over]}>
        <SubjectTile name={subjectTitle || "?"} kind={subjectPage?.kind ?? "topic"} size={18} />
        <Text style={m.pickText} numberOfLines={1}>{subjectTitle || "Pick a page"}</Text>
        <Icon name="chevd" size={9} color="var(--ink-3)" />
      </Pressable>
      {picking ? <Picker pages={pages} current={subjectId} onPick={(id) => subject(id, true)} onClose={() => setPicking(false)} /> : null}
    </View>
  ) : (
    <View style={m.chipWrap} testID="graph-space"><View style={m.pick}><View style={m.spaceTile}><Text style={m.spaceLetter}>{spaceName.charAt(0).toUpperCase()}</Text></View><Text style={m.pickText}>{spaceName}</Text></View></View>
  );

  return (
    <View style={frame.main} testID="memory-graph" accessibilityLabel="Knowledge graph">
      <KnowHeader crumbs={[{ t: "Knowledge", route: { v: "learned" } }, { t: "Graph", icon: "graph" }, { t: subjectTitle, node: chip }]} right={right} />
      {note ? <Text style={m.note} accessibilityRole="alert" testID="graph-note">{note}</Text> : null}
      <View style={m.wrap} testID="graph-wrap" onLayout={(e: { nativeEvent: { layout: { width: number } } }) => setNarrow(e.nativeEvent.layout.width < 760)}>
        {!ready ? <View style={m.loading} testID="graph-loading" accessibilityLabel="Loading"><Text style={m.pickNone}>Loading the graph</Text></View> : empty ? (
          <States kind="empty" title={b.nodes.length > 0 ? "Every node is filtered out." : "Nothing to draw yet"} icon="files" {...(b.nodes.length > 0 ? { action: { label: "Show everything", onPress: reset } } : {})} />
        ) : (
          <GraphSurface
            nodes={nodes} edges={edges} pos={pos} deg={deg} sel={sel} selEdge={selEdge} lit={lit} center={center} labelsAll={around} fitKey={sig} command={command}
            onSelectNode={pickNode} onSelectEdge={pickEdge} onClear={clear} onOpen={open} onDrop={drop} onMenu={surfaceMenu} onKey={onKey}
          />
        )}
        {ready && !empty ? (
          <>
            <View style={m.statWrap} pointerEvents="box-none">
              <Text style={m.stat} testID="graph-stat">{statLine(nodes.length, edges.length, center ? subjectTitle : null)}</Text>
              {narrowed ? (
                <View style={m.banner} testID="graph-banner"><Text style={m.bannerText}>{banner}</Text><Pressable accessibilityRole="button" testID="graph-banner-clear" onPress={reset}><Text style={m.link}>Show all</Text></Pressable></View>
              ) : null}
              {s.hidden > 0 && !narrowed ? <Text style={m.stat} testID="graph-hidden">{`${s.hidden} hidden by the date`}</Text> : null}
            </View>
            {narrow ? null : (
              <View style={m.legend} testID="graph-legend" accessibilityRole="menu" accessibilityLabel="Types">
                {each(legend, (k) => {
                  const off = kinds.size > 0 && !kinds.has(k);
                  return (
                    <Pressable
                      key={k} accessibilityRole="button" accessibilityState={{ pressed: !off }} accessibilityLabel={`${KIND_LABEL[k]}, ${drawn.get(k) ?? 0}`} testID={`legend-${k}`}
                      onPress={() => toggleKind(k)} {...(web ? menuTrigger((x, y) => menu.show(legendMenu(k, off, { toggle: () => toggleKind(k), only: () => setKinds(new Set([k])), all: () => setKinds(new Set()) }), x, y)) : {})}
                      style={({ hovered }: { hovered?: boolean }) => [m.lrow, hovered === true && m.over, off && m.off]}
                    >
                      <View style={[m.ldot, k === "chat" && m.lsq, { backgroundColor: kindColor(k) as string }]} />
                      <Text style={m.ltext}>{KIND_LABEL[k]}</Text>
                      <Text style={m.lcount}>{drawn.get(k) ?? 0}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            <View style={m.zoom} testID="graph-zoom">
              <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" testID="zoom-in" onPress={() => send({ kind: "in" })} style={({ hovered }: { hovered?: boolean }) => [m.zBtn, hovered === true && m.over]}><Icon name="plus" size={14} color="var(--ink-2)" /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" testID="zoom-out" onPress={() => send({ kind: "out" })} style={({ hovered }: { hovered?: boolean }) => [m.zBtn, hovered === true && m.over]}><Icon name="minus" size={14} color="var(--ink-2)" /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Fit to screen" testID="zoom-fit" onPress={() => send({ kind: "fit" })} style={({ hovered }: { hovered?: boolean }) => [m.zBtn, hovered === true && m.over]}><Icon name="fit" size={14} color="var(--ink-2)" /></Pressable>
            </View>
          </>
        ) : null}
        <View style={m.bottom} pointerEvents="box-none">
          {edge ? <Evidence edge={edge} from={titleOf(edge.from)} to={titleOf(edge.to)} now={now} onClose={clear} data={data} /> : selNode ? (
            <NodeCard
              node={selNode} links={deg.get(selNode.nodeId) ?? 0} canFocus={around && pageOf(selNode, pageIds) !== undefined && selNode.nodeId !== center} page={pageOf(selNode, pageIds) !== undefined}
              onFocus={() => { const p = pageOf(selNode, pageIds); if (p) subject(p, true); }} onOpen={() => open(selNode.nodeId)} onClose={clear}
            />
          ) : null}
          <View style={m.time} testID="graph-time">
            <View style={m.timeTop}>
              <Text style={m.timeText} testID="graph-day">{asOf === undefined ? "What we know now" : `What we knew on ${sliderText(step, now)}`}</Text>
              <View style={m.grow} />
              {asOf !== undefined ? <Pressable accessibilityRole="button" testID="graph-now" onPress={() => setStep(SLIDER_DAYS)}><Text style={m.link}>Back to now</Text></Pressable> : null}
            </View>
            {web
              ? createElement("input", { type: "range", min: 0, max: SLIDER_DAYS, value: step, "aria-label": "Date", "aria-valuetext": sliderText(step, now), "data-testid": "graph-slider", onChange: (e: { target: { value: string } }) => setStep(Number(e.target.value)), style: { width: "100%", margin: "8px 0 0", accentColor: "var(--accent)" } })
              : null}
            <View style={m.ticks}>{each(ticks, (t) => <Text key={t.label} style={m.tick}>{t.label}</Text>)}</View>
          </View>
        </View>
      </View>
      {menu.element}
    </View>
  );
}

const m = StyleSheet.create({
  grow: { flex: 1 },
  loadHead: { height: 48, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 18, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  loadTitle: { margin: 0, fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  over: { backgroundColor: "var(--hover)" as string },
  seg: { flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  segBtn: { height: 24, paddingHorizontal: 10, borderRadius: 6, justifyContent: "center" },
  segOn: { backgroundColor: "var(--raised)" as string },
  segText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  segTextOn: { color: "var(--ink)" as string, fontWeight: "500" },
  div: { width: 1, height: 18, marginHorizontal: 6, backgroundColor: "var(--line)" as string },
  more: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  chipWrap: { position: "relative", zIndex: 30 },
  pick: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, borderRadius: 7 },
  pickText: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string, maxWidth: 220 },
  spaceTile: { width: 18, height: 18, borderRadius: 5, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent-wash)" as string },
  spaceLetter: { fontSize: 10, fontWeight: "700", color: "var(--accent)" as string },
  away: { position: "fixed" as "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: 40 },
  picker: { position: "absolute", top: 32, left: 0, width: 280, padding: 6, borderRadius: 10, zIndex: 50, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" } as object,
  pickHead: { paddingTop: 4, paddingBottom: 6, lineHeight: 16, paddingHorizontal: 9, fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  pickFind: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 3, marginBottom: 4, paddingHorizontal: 8, borderRadius: 7, backgroundColor: "var(--sunk)" as string },
  pickList: { maxHeight: 300, overflow: "scroll" as "hidden" },
  pickRow: { height: 30, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, borderRadius: 6 },
  pickName: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  pickKind: { fontSize: 11.5, color: "var(--ink-3)" as string },
  pickNone: { padding: 12, fontSize: 13, color: "var(--ink-3)" as string },
  note: { fontSize: 12.5, color: "var(--ink-2)" as string, paddingHorizontal: 18, paddingVertical: 6 },
  // below the header (RN web gives every View its own stacking layer), so the subject picker opens over the picture
  wrap: { flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", zIndex: -1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  statWrap: { position: "absolute", left: 18, top: 12, gap: 6, alignItems: "flex-start" },
  stat: { fontSize: 12.5, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, height: 26, paddingHorizontal: 10, borderRadius: 7, backgroundColor: "var(--accent-wash)" as string },
  bannerText: { fontSize: 12.5, color: "var(--ink)" as string },
  link: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  legend: { position: "absolute", left: 16, bottom: 16, minWidth: 128, padding: 6, borderRadius: 12, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-1), inset 0 0 0 1px var(--line)" } as object,
  lrow: { height: 22, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 6, borderRadius: 6 },
  off: { opacity: 0.4 },
  ldot: { width: 9, height: 9, borderRadius: 5 },
  lsq: { borderRadius: 3 },
  ltext: { flex: 1, fontSize: 12, color: "var(--ink-2)" as string },
  lcount: { paddingLeft: 12, fontSize: 12, color: "var(--ink-4)" as string, fontVariant: ["tabular-nums"] },
  zoom: { position: "absolute", right: 14, bottom: 14, borderRadius: 9, backgroundColor: "var(--raised)" as string, overflow: "hidden", boxShadow: "var(--sh-1), inset 0 0 0 1px var(--line)" } as object,
  zBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 14, alignItems: "center", gap: 10, paddingHorizontal: 80 },
  time: { width: "100%", maxWidth: 520, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, borderRadius: 12, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-1), inset 0 0 0 1px var(--line)" } as object,
  timeTop: { flexDirection: "row", alignItems: "center", minHeight: 18 },
  timeText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  ticks: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  tick: { fontSize: 11, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  card: { width: "100%", maxWidth: 462, padding: 14, gap: 10, borderRadius: 12, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop), inset 0 0 0 1px var(--line)" } as object,
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1, fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  cardLabel: { color: "var(--accent)" as string, fontStyle: "normal" },
  dot: { width: 9, height: 9, borderRadius: 5 },
  badge: { fontSize: 11.5, color: "var(--ink-3)" as string },
  ib: { width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  quote: { borderLeftWidth: 2, borderLeftColor: "var(--accent)" as string, paddingLeft: 10, marginLeft: 2 },
  quoteText: { fontSize: 13.5, lineHeight: 20, color: "var(--ink)" as string },
  cardFoot: { flexDirection: "row", alignItems: "center", gap: 10 },
  src: { height: 20, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, borderRadius: 6, backgroundColor: "var(--sunk)" as string, maxWidth: 220 },
  srcOver: { backgroundColor: "var(--hover)" as string },
  srcText: { fontSize: 12, color: "var(--ink-2)" as string },
  cardDate: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  hm: { height: 26, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 7, borderRadius: 6 },
  hmText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
});

/** The screen, or its frame while the shell has not provided the data yet. */
export function MemoryGraph(props: MemoryGraphProps): ReactElement {
  const data = useOptionalMemoryData();
  if (!data) return <View style={frame.main} testID="memory-graph-loading" accessibilityLabel="Loading"><View style={m.loadHead}><Icon name="graph" size={15} color="var(--ink-3)" /><Text accessibilityRole="header" aria-level={1} style={m.loadTitle}>Graph</Text></View></View>;
  return <GraphBody {...props} />;
}
