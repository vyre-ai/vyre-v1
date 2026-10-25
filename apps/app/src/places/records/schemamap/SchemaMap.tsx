// The Schema map (spec 3.4, screen records.schema-map): every record type as a card on a pannable, zoomable canvas, a curve for each link, a minimap. Read only: structure is
// edited in the Console, so there are no add, drag-to-link or delete controls. What you can do:
//   - drag the canvas to pan, Ctrl/Cmd and wheel (or the + and - buttons) to zoom, the expand button or 0 to fit everything, press the minimap to jump;
//   - hover a card or press it to light its links and dim the rest; "+N more" opens all of a card's fields;
//   - double press a card, or press Enter on the selected one, to open the type in Records; right-click it for Open and Open in the Console;
//   - arrow keys move the selection between cards, Escape clears it.
// Reads: schema.map through the screen's live query, and schema.types.get once per type for the field lists.
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { MAP_SCREEN, useSchemaData, useSchemaQuery, useTypeDetails } from "./data.tsx";
import { Glyph } from "./icons.tsx";
import type { IconName } from "./icons.tsx";
import {
  CARD_W, MINI_H, MINI_W, cardDim, cardHeight, edgeGeometry, emphasis, fieldRows, fitView, hueOf, layout, miniGo, miniModel, moreCount, neighbor, panBy, shownCount, summary, zoomAt,
} from "./model.ts";
import type { EdgeGeometry, FieldRow, MapEdge, MapNode, Rect, TypeDetail, View as Viewport } from "./model.ts";
import { TypeTile, sx, webProps } from "./parts.tsx";

type MapOut = CapMap["schema.map"]["out"];

export interface SchemaMapProps {
  /** Start with this type selected. */
  selected?: string | null;
  /** Start with these cards showing all their fields. */
  expanded?: readonly string[];
  /** Field lists already in hand (tests): nothing is fetched for these. */
  details?: ReadonlyMap<string, TypeDetail>;
  /** The canvas size to lay out for until it is measured (the static first frame). */
  size?: { width: number; height: number };
}

const DOUBLE_MS = 450;
const DEFAULT_SIZE = { width: 1100, height: 700 };

interface Pt { clientX: number; clientY: number; target: unknown; ctrlKey?: boolean; metaKey?: boolean; deltaY?: number; deltaX?: number; preventDefault?: () => void }
interface Host {
  addEventListener(type: string, fn: (e: Pt) => void, opts?: { passive: boolean }): void;
  removeEventListener(type: string, fn: (e: Pt) => void): void;
  getBoundingClientRect?: () => { left: number; top: number };
}
const insideControl = (t: unknown): boolean => {
  const el = t as { closest?: (s: string) => unknown } | null;
  return typeof el?.closest === "function" && el.closest("[data-card],[data-ctl]") != null;
};

export function SchemaMap({ selected = null, expanded = [], details: preload, size }: SchemaMapProps): ReactElement {
  const data = useSchemaData();
  const menu = useMenu();
  const q = useSchemaQuery<MapOut>(MAP_SCREEN, "map");
  const nodes: MapNode[] = q.status === "ready" ? q.data.nodes : [];
  const edges: MapEdge[] = q.status === "ready" ? q.data.edges : [];
  const keys: string[] = [];
  for (const n of nodes) keys.push(n.type);
  const details = useTypeDetails(preload ? [] : keys, preload);
  const titles = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) m.set(n.type, n.title);
    return m;
  }, [nodes]);
  const titleOf = (t: string): string => titles.get(t) ?? t;

  const [sel, setSel] = useState<string | null>(selected);
  const [hover, setHover] = useState<string | null>(null);
  const [exp, setExp] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const t of expanded) m[t] = true;
    return m;
  });
  const [view, setView] = useState<Viewport | null>(null);
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const dim = measured ?? size ?? DEFAULT_SIZE;
  const hot = hover ?? sel;
  const canvas = useRef<unknown>(null);
  const last = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const live = useRef({ view: null as Viewport | null, dim });

  // rows of every card, then the layout, then each card's rectangle
  const rowsOf = new Map<string, FieldRow[]>();
  for (const n of nodes) rowsOf.set(n.type, fieldRows(n.type, edges, titleOf, details.get(n.type)));
  const heights = new Map<string, number>();
  for (const n of nodes) heights.set(n.type, cardHeight((rowsOf.get(n.type) as FieldRow[]).length, false));
  let nodeKey = `#${edges.length}`;
  for (const n of nodes) nodeKey += `|${n.type}:${(rowsOf.get(n.type) as FieldRow[]).length}`;
  const pos = useMemo(() => layout(nodes, edges, heights), [nodeKey]);
  const rects = new Map<string, Rect>();
  for (const n of nodes) {
    const p = pos.get(n.type) ?? [70, 40];
    rects.set(n.type, { x: p[0], y: p[1], w: CARD_W, h: cardHeight((rowsOf.get(n.type) as FieldRow[]).length, exp[n.type] === true) });
  }
  const rectList: Rect[] = [...rects.values()];
  const v: Viewport = view ?? fitView(rectList, dim.width, dim.height);
  live.current = { view: v, dim };

  // web: drag to pan, wheel to pan or zoom
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const host = canvas.current as Host | null;
    if (!host || typeof host.addEventListener !== "function") return;
    let drag: { x: number; y: number } | null = null;
    const down = (e: Pt): void => { if (insideControl(e.target)) return; drag = { x: e.clientX, y: e.clientY }; };
    const move = (e: Pt): void => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY };
      setView(panBy(live.current.view as Viewport, dx, dy));
    };
    const up = (): void => { drag = null; };
    const wheel = (e: Pt): void => {
      e.preventDefault?.();
      const cur = live.current.view as Viewport;
      if (e.ctrlKey === true || e.metaKey === true) {
        const box = host.getBoundingClientRect?.() ?? { left: 0, top: 0 };
        setView(zoomAt(cur, Math.exp(-(e.deltaY ?? 0) * 0.01), e.clientX - box.left, e.clientY - box.top));
      } else setView(panBy(cur, -(e.deltaX ?? 0), -(e.deltaY ?? 0)));
    };
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", up);
    host.addEventListener("pointercancel", up);
    host.addEventListener("wheel", wheel, { passive: false });
    return () => {
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
      host.removeEventListener("wheel", wheel);
    };
  }, []);

  const open = (type: string): void => data.nav.openType(type);
  const zoom = (f: number): void => setView(zoomAt(v, f, dim.width / 2, dim.height / 2));
  const fit = (): void => setView(null);

  const select = (type: string): void => {
    const now = Date.now();
    const twice = last.current.key === type && now - last.current.at < DOUBLE_MS;
    last.current = { key: type, at: now };
    if (twice) { open(type); return; }
    setSel((s) => (s === type ? null : type));
  };

  const onKeyDown = (e: { key: string; preventDefault?: () => void }): void => {
    const dir = e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : null;
    if (dir) { e.preventDefault?.(); setSel(neighbor(rects, sel, dir)); return; }
    if (e.key === "Enter" && sel) { e.preventDefault?.(); open(sel); return; }
    if (e.key === "Escape") { setSel(null); return; }
    if (e.key === "+" || e.key === "=") { e.preventDefault?.(); zoom(1.2); return; }
    if (e.key === "-") { e.preventDefault?.(); zoom(1 / 1.2); return; }
    if (e.key === "0") { e.preventDefault?.(); fit(); }
  };

  const cardMenu = (type: string, x: number, y: number): void => {
    menu.show([{ label: "Open", onSelect: () => open(type) }, { label: "Open in the Console", onSelect: () => data.nav.openConsole(type) }], x, y, "context", { label: titleOf(type) });
  };

  // curves
  const geometry: EdgeGeometry[] = [];
  for (const e of edges) {
    const a = rects.get(e.from), b = rects.get(e.to);
    if (!a || !b) continue;
    const rows = rowsOf.get(e.from) as FieldRow[];
    let at = -1;
    for (let i = 0; i < rows.length; i++) if ((rows[i] as FieldRow).key === e.field) { at = i; break; }
    geometry.push(edgeGeometry(e, a, b, at, shownCount(rows.length, exp[e.from] === true)));
  }

  const cards: ReactElement[] = [];
  for (const n of nodes) {
    const r = rects.get(n.type) as Rect;
    cards.push(
      <Card
        key={n.type}
        node={n}
        rect={r}
        rows={rowsOf.get(n.type) as FieldRow[]}
        selected={sel === n.type}
        lit={hover === n.type}
        dim={cardDim(hot, n.type, edges)}
        expanded={exp[n.type] === true}
        onHover={(on) => setHover(on ? n.type : null)}
        onPress={() => select(n.type)}
        onToggle={() => setExp((m) => ({ ...m, [n.type]: !m[n.type] }))}
        onMenu={(x, y) => cardMenu(n.type, x, y)}
      />,
    );
  }

  const fieldTotal = nodes.length && keys.every((k) => details.has(k)) ? keys.reduce((s, k) => s + (details.get(k)?.fields.length ?? 0), 0) : null;
  const mini = miniModel(rects, v, dim.width, dim.height);

  return (
    <View style={st.page} testID="schema-map-place">
      <View style={st.head} accessibilityRole="header">
        <Glyph name="schema" size={15} color="var(--ink)" />
        <Text style={st.crumb}>Schema map</Text>
        <Text style={st.sl}>/</Text>
        <Text style={st.dimText} testID="schema-map-summary">{summary(nodes.length, fieldTotal)}</Text>
        <View style={st.grow} />
        <Pressable accessibilityRole="button" accessibilityLabel="Structure is edited in the Console" onPress={() => data.nav.openConsole()} testID="schema-map-console" style={st.consoleBtn}>
          <Glyph name="lock" size={12} />
          <Text style={st.consoleText}>Edit in the Console</Text>
        </Pressable>
      </View>
      <View
        ref={canvas as never}
        style={st.canvas}
        testID="schema-map"
        accessibilityLabel="Schema map. Arrow keys move between tables, Enter opens one."
        onLayout={(e) => { const { width, height } = e.nativeEvent.layout; if (width > 0 && height > 0 && (width !== dim.width || height !== dim.height)) setMeasured({ width, height }); }}
        {...webProps({ tabIndex: 0, onKeyDown })}
      >
        <View style={[st.world, sx({ transform: [{ translateX: v.x }, { translateY: v.y }, { scale: v.k }] })]} testID="schema-world">
          <Edges geometry={geometry} hot={hot} />
          {cards}
        </View>
        {q.status === "ready" && nodes.length === 0 ? (
          <View style={st.empty} testID="schema-map-empty"><Text style={st.emptyTitle}>No tables yet</Text><Text style={st.emptyText}>Record types are created in the Console.</Text></View>
        ) : null}
        <View style={st.ctl} testID="schema-controls" {...webProps({ dataSet: { ctl: "1" } })}>
          <Ctl glyph="plus" label="Zoom in" onPress={() => zoom(1.2)} testID="schema-zoom-in" />
          <Ctl glyph="minus" label="Zoom out" onPress={() => zoom(1 / 1.2)} testID="schema-zoom-out" second />
          <Ctl glyph="expand" label="Fit to screen" onPress={fit} testID="schema-fit" second />
        </View>
        <Minimap mini={mini} sel={sel} onGo={(mx, my) => setView(miniGo(mini, mx, my, v, dim.width, dim.height))} />
      </View>
      {menu.element}
    </View>
  );
}

// ---------------------------------------------------------------- the curves

function Edges({ geometry, hot }: { geometry: readonly EdgeGeometry[]; hot: string | null }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const kids: ReactElement[] = [];
  for (let i = 0; i < geometry.length; i++) {
    const g = geometry[i] as EdgeGeometry;
    const e = emphasis(hot, g);
    const stroke = e === "hot" ? "var(--accent)" : "var(--ink-4)";
    const w = e === "hot" ? 2 : 1.5;
    kids.push(
      createElement(
        "g",
        { key: `${g.from}:${g.field}:${i}`, "data-edge": `${g.from}>${g.to}`, "data-emphasis": e, style: { opacity: e === "dim" ? 0.18 : 1 } },
        createElement("path", { d: g.d, fill: "none", stroke, strokeWidth: w }),
        createElement("path", { d: g.crow, fill: "none", stroke, strokeWidth: w }),
        createElement("path", { d: g.bar, fill: "none", stroke, strokeWidth: w }),
        createElement("circle", { cx: g.dot[0], cy: g.dot[1], r: 2.6, fill: stroke }),
      ),
    );
  }
  return createElement("svg", { width: 1, height: 1, "aria-hidden": true, "data-testid": "schema-edges", style: { position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" } }, ...kids);
}

// ---------------------------------------------------------------- a card

interface CardProps {
  node: MapNode;
  rect: Rect;
  rows: readonly FieldRow[];
  selected: boolean;
  lit: boolean;
  dim: boolean;
  expanded: boolean;
  onHover(on: boolean): void;
  onPress(): void;
  onToggle(): void;
  onMenu(x: number, y: number): void;
}

function Card({ node, rect, rows, selected, lit, dim, expanded, onHover, onPress, onToggle, onMenu }: CardProps): ReactElement {
  const shown = shownCount(rows.length, expanded);
  const fieldViews: ReactElement[] = [];
  for (let i = 0; i < shown; i++) {
    const f = rows[i] as FieldRow;
    fieldViews.push(
      <View key={f.key} style={st.field} testID={`field-${node.type}-${f.key}`}>
        <View style={st.gl}>{f.symbol ? <Text style={st.glText}>{f.symbol}</Text> : <Glyph name={f.icon as IconName} size={14} color="var(--ink-4)" />}</View>
        <Text numberOfLines={1} style={[st.fname, f.kind === "relation" && st.fnameRel]}>{f.title}</Text>
        <Text numberOfLines={1} style={[st.ftype, f.kind === "relation" && st.ftypeRel]}>{f.typeLabel}</Text>
        {f.kind === "relation" && f.outgoing ? <View style={st.sdot} aria-hidden /> : null}
      </View>,
    );
  }
  const more = moreCount(rows.length);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${node.title}, ${node.rowCount} ${node.rowCount === 1 ? "record" : "records"}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      onHoverIn={() => onHover(true)}
      onHoverOut={() => onHover(false)}
      testID={`schema-card-${node.type}`}
      style={[st.card, { left: rect.x, top: rect.y, width: rect.w }, selected ? st.cardSel : lit ? st.cardLit : null, dim && st.cardDim]}
      {...webProps({ dataSet: { card: node.type, selected: selected ? "true" : "false" } })}
      {...menuTrigger(onMenu)}
    >
      <View style={st.cardHead}>
        <TypeTile type={node.type} title={node.title} size={22} />
        <Text numberOfLines={1} style={st.cardTitle}>{node.title}</Text>
        <Text style={st.count} testID={`schema-count-${node.type}`}>{String(node.rowCount)}</Text>
      </View>
      {fieldViews}
      {more > 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "Show fewer fields" : `Show ${more} more fields`} onPress={onToggle} testID={`schema-more-${node.type}`} style={st.more}>
          <Text style={st.moreText}>{expanded ? "Show fewer" : `+${more} more`}</Text>
        </Pressable>
      ) : <View style={{ height: 6 }} />}
    </Pressable>
  );
}

// ---------------------------------------------------------------- controls and minimap

function Ctl({ glyph, label, onPress, testID, second = false }: { glyph: "plus" | "minus" | "expand"; label: string; onPress: () => void; testID: string; second?: boolean }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)} testID={testID} style={[st.ctlBtn, second && st.ctlSecond, over && st.ctlOver]} {...webProps({ title: label })}>
      <Glyph name={glyph} size={15} color={over ? "var(--ink)" : "var(--ink-2)"} />
    </Pressable>
  );
}

function Minimap({ mini, sel, onGo }: { mini: ReturnType<typeof miniModel>; sel: string | null; onGo(x: number, y: number): void }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const kids: ReactElement[] = [];
  for (const c of mini.cards) {
    kids.push(createElement("rect", { key: c.type, x: c.x, y: c.y, width: c.w, height: c.h, rx: 2, fill: `hsl(${hueOf(c.type)} 50% 55% / .7)`, stroke: c.type === sel ? "var(--ink)" : "none", strokeWidth: 1.2 }));
  }
  kids.push(createElement("rect", { key: "viewport", x: mini.viewport.x, y: mini.viewport.y, width: mini.viewport.w, height: mini.viewport.h, rx: 3, fill: "var(--accent-wash)", stroke: "var(--accent)", strokeWidth: 1.2 }));
  return (
    <Pressable
      accessible={false}
      onPress={(e) => { const n = e.nativeEvent as unknown as { locationX?: number; locationY?: number }; onGo(n.locationX ?? 0, n.locationY ?? 0); }}
      testID="schema-minimap"
      style={st.mini}
      {...webProps({ dataSet: { ctl: "1" }, "aria-hidden": true })}
    >
      {createElement("svg", { width: MINI_W, height: MINI_H, style: { display: "block", pointerEvents: "none" } }, ...kids)}
    </Pressable>
  );
}

const st = StyleSheet.create({
  page: { flex: 1, minHeight: 0 },
  head: { height: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14 },
  crumb: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  sl: { fontSize: 13.5, color: "var(--ink-4)" as string },
  dimText: { fontSize: 13, color: "var(--ink-3)" as string },
  grow: { flex: 1 },
  consoleBtn: { height: 28, paddingHorizontal: 8, borderRadius: 7, flexDirection: "row", alignItems: "center", gap: 6 },
  consoleText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-3)" as string },
  canvas: sx({
    flex: 1, minHeight: 0, overflow: "hidden", position: "relative", outlineStyle: "none", cursor: "grab", touchAction: "none",
    backgroundImage: "radial-gradient(circle at 1px 1px, var(--line-2) 1px, transparent 0)", backgroundSize: "22px 22px",
  }),
  world: { position: "absolute", left: 0, top: 0, width: 1, height: 1 },
  card: sx({ position: "absolute", borderRadius: 12, backgroundColor: "var(--raised)", boxShadow: "var(--sh-2)", overflow: "hidden", userSelect: "none", cursor: "default" }),
  cardLit: sx({ boxShadow: "var(--sh-2), 0 0 0 1.5px var(--accent-line)" }),
  cardSel: sx({ boxShadow: "var(--sh-2), 0 0 0 2px var(--accent)" }),
  cardDim: { opacity: 0.35 },
  cardHead: sx({ height: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, boxShadow: "inset 0 -1px var(--line)" }),
  cardTitle: { flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  count: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  field: { height: 26, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 22, position: "relative" },
  gl: { width: 14, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  glText: { fontSize: 11, fontWeight: "600", color: "var(--ink-4)" as string },
  fname: { flex: 1, minWidth: 0, fontSize: 12, color: "var(--ink-2)" as string },
  fnameRel: { color: "var(--ink)" as string },
  ftype: { fontSize: 11, color: "var(--ink-4)" as string },
  ftypeRel: { color: "var(--accent)" as string },
  sdot: sx({ position: "absolute", right: 7, top: 8.5, width: 9, height: 9, borderRadius: 99, backgroundColor: "var(--raised)", boxShadow: "inset 0 0 0 1.5px var(--accent)", opacity: 0.55 }),
  more: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 9 },
  moreText: { fontSize: 11.5, color: "var(--ink-3)" as string },
  ctl: sx({ position: "absolute", right: 14, bottom: 134, borderRadius: 10, backgroundColor: "var(--raised)", boxShadow: "var(--sh-pop)", overflow: "hidden", zIndex: 3 }),
  ctlBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  ctlSecond: sx({ boxShadow: "inset 0 1px var(--line)" }),
  ctlOver: { backgroundColor: "var(--hover)" as string },
  mini: sx({ position: "absolute", right: 14, bottom: 14, width: MINI_W, height: MINI_H, borderRadius: 10, backgroundColor: "var(--raised)", boxShadow: "var(--sh-pop)", overflow: "hidden", zIndex: 3 }),
  empty: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  emptyText: { fontSize: 13, color: "var(--ink-3)" as string },
});
