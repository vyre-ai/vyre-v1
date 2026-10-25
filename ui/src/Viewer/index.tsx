// ui/Viewer: one viewer for every file type (spec 2.16, 3.5; ARCH 7.5). Image, document (md and code), CSV, plan and a quiet "no preview" state.
// Find in file highlights every match and steps through them. Images take markup: Draw (freehand) and Comment on an area (drag a box, type a note);
// notes are numbered pins kept in unit coordinates (0..1 of the image), so they stay on the same spot at any zoom. Plans and documents edit in place
// and take highlight-and-comment. The Ask control is the shared AskButton. Colours are skin tokens (CSS variables on web).

import { createElement, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AskButton } from "../AskButton/index.tsx";
import type { AskButtonProps } from "../AskButton/index.tsx";
import { MenuIcon } from "../Menu/index.tsx";
import { MONO_VAR } from "../theme/fonts.ts";
import { Row } from "../Row/index.tsx";
import { viewerLabel } from "./props.ts";
import type { MarkupTool, ViewerPin, ViewerProps } from "./props.ts";

export type { MarkupTool, ViewerKind, ViewerPane, ViewerPin, ViewerProps } from "./props.ts";
export { MARKUP_TOOLS, VIEWER_KINDS, viewerLabel } from "./props.ts";

/* ---------- pure logic ---------- */

/** A pin or box anchor in unit coordinates of the image (0..1). Zoom never changes it. */
export interface Anchor { x: number; y: number; w: number; h: number }
export interface Stroke { points: readonly (readonly [number, number])[] }
export interface MarkupBox extends Anchor { id: string; text: string }
export interface DocBlock { id: string; tag: "h1" | "h2" | "p" | "li" | "code" | "meta"; text: string }
export interface ViewerDetails {
  rows: readonly (readonly [string, string])[];
  sections?: readonly { title: string; count?: number; items: readonly { id: string; title: string; note?: string }[] }[];
}
/** The memory graph the Viewer reads links from: the nodes and edges `memory.graph` returns, as the viewer may see them. */
export interface GraphNode { nodeId: string; title: string; kind?: string; link?: string }
export interface GraphEdge { from: string; to: string; kind: "link" | "relation" | "came_from" }
export interface ViewerGraph { nodes: readonly GraphNode[]; edges: readonly GraphEdge[] }
export interface LinkRow { id: string; title: string; note?: string }

/** What a note links to ("Links to") and what links to it ("Linked from"), from the graph's `link` edges. Each node once, in graph order; nodes the viewer cannot see are not in the graph, so they never show. */
export function linksOf(graph: ViewerGraph, nodeId: string): { to: readonly LinkRow[]; from: readonly LinkRow[] } {
  const byId = new Map<string, GraphNode>();
  for (const n of graph.nodes) byId.set(n.nodeId, n);
  const row = (id: string): LinkRow | null => { const n = byId.get(id); return n === undefined || id === nodeId ? null : { id: n.nodeId, title: n.title, ...(n.link !== undefined ? { note: n.link } : {}) }; };
  const pick = (want: "to" | "from"): LinkRow[] => {
    const seen = new Set<string>();
    const out: LinkRow[] = [];
    for (const e of graph.edges) {
      if (e.kind !== "link") continue;
      const other = want === "to" ? (e.from === nodeId ? e.to : null) : (e.to === nodeId ? e.from : null);
      if (other === null || seen.has(other)) continue;
      const r = row(other);
      if (r !== null) { seen.add(other); out.push(r); }
    }
    return out;
  };
  return { to: pick("to"), from: pick("from") };
}

export interface Sheet { cols: readonly string[]; rows: readonly (readonly string[])[] }

/** The text a person sees: **bold** and [[link]] markers removed. Find reads this, so a match is always something on screen. */
export function stripInline(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[\[(.+?)\]\]/g, "$1");
}
export interface InlineRun { text: string; bold?: boolean; link?: boolean }
/** Splits **bold** and [[link]] into runs; the runs' text joins to stripInline(s). */
export function inlineRuns(s: string): readonly InlineRun[] {
  const out: InlineRun[] = [];
  let at = 0;
  for (const m of s.matchAll(/\*\*(.+?)\*\*|\[\[(.+?)\]\]/g)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: s.slice(at, i) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true }); else out.push({ text: m[2] ?? "", link: true });
    at = i + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4;
export const IMAGE_W = 1000;
export const IMAGE_H = 750;

export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
export const stepZoom = (z: number, dir: -1 | 0 | 1): number => (dir === 0 ? 1 : clampZoom(z + dir * 0.25));

/** Where a pin draws, in image pixels at the given zoom. The anchor itself never changes. */
export function pinAt(a: Anchor, zoom: number): { left: number; top: number } {
  return { left: a.x * IMAGE_W * zoom, top: a.y * IMAGE_H * zoom };
}

/** A pointer position inside the stage (px, with the stage's own size) as a unit coordinate. */
export function toUnit(px: number, py: number, stageW: number, stageH: number): [number, number] {
  return [Math.min(1, Math.max(0, px / Math.max(1, stageW))), Math.min(1, Math.max(0, py / Math.max(1, stageH)))];
}

/** A dragged box between two unit points, or null when it is too small to be an area. */
export function boxFrom(a: readonly [number, number], b: readonly [number, number]): Anchor | null {
  const w = Math.abs(b[0] - a[0]);
  const h = Math.abs(b[1] - a[1]);
  if (w < 0.02 || h < 0.02) return null;
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w, h };
}

export interface FindHit { block: number; at: number; len: number }

/** Every case-insensitive match of the query, in reading order. */
export function findMatches(texts: readonly string[], query: string): readonly FindHit[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const hits: FindHit[] = [];
  texts.forEach((t, block) => {
    const low = t.toLowerCase();
    for (let at = low.indexOf(q); at >= 0; at = low.indexOf(q, at + q.length)) hits.push({ block, at, len: q.length });
  });
  return hits;
}

/** Splits one block's text into plain and marked runs; `current` marks the run that is the active match. */
export function markRuns(text: string, hits: readonly FindHit[], block: number, current: number, all: readonly FindHit[]): readonly { text: string; hit?: boolean; on?: boolean }[] {
  const mine = hits.filter((h) => h.block === block);
  const runs: { text: string; hit?: boolean; on?: boolean }[] = [];
  let at = 0;
  for (const h of mine) {
    if (h.at > at) runs.push({ text: text.slice(at, h.at) });
    runs.push({ text: text.slice(h.at, h.at + h.len), hit: true, on: all[current] === h });
    at = h.at + h.len;
  }
  if (at < text.length) runs.push({ text: text.slice(at) });
  return runs.length === 0 ? [{ text }] : runs;
}

const num = (v: string): number => Number.parseFloat(v.replace(/[^0-9.-]/g, ""));
const isNum = (v: string): boolean => v !== "" && /^[$\d.,-]+$/.test(v);

/** Rows sorted by one column; numbers by value, the rest by text. Direction 1 up, -1 down. */
export function sortRows(rows: readonly (readonly string[])[], col: number, dir: 1 | -1): readonly (readonly string[])[] {
  return [...rows].sort((a, b) => {
    const x = a[col] ?? "";
    const y = b[col] ?? "";
    const r = isNum(x) && isNum(y) ? num(x) - num(y) : x.localeCompare(y);
    return r * dir;
  });
}

/** The sheet footer line: counts, and sum and average for a selected numeric column. */
export function sheetFoot(sheet: Sheet, col: number | null): string {
  let out = `${sheet.rows.length} rows · ${sheet.cols.length} columns`;
  if (col !== null) {
    const vals = each(sheet.rows, (r) => num(r[col] ?? "")).filter((n) => !Number.isNaN(n));
    if (vals.length > 1) {
      const sum = vals.reduce((a, b) => a + b, 0);
      out += ` · ${sheet.cols[col] ?? ""}: sum ${sum.toLocaleString("en-US")}, average ${(sum / vals.length).toFixed(1)}`;
    }
  }
  return out;
}

/* ---------- icons ---------- */

const SVG = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">`;
const ICON = {
  draw: `${SVG}<path d="M3 13l1-3.500L11.500 2 14 4.500 6.500 12 3 13z"/></svg>`,
  area: `${SVG}<path d="M2.500 5.500v-3h3M10.500 2.500h3v3M13.500 10.500v3h-3M5.500 13.500h-3v-3"/></svg>`,
  find: `${SVG}<circle cx="7" cy="7" r="4"/><path d="M10 10l3.500 3.500"/></svg>`,
  up: `${SVG}<path d="M4 10l4-4 4 4"/></svg>`,
  down: `${SVG}<path d="M4 6l4 4 4-4"/></svg>`,
  info: `${SVG}<circle cx="8" cy="8" r="5.500"/><path d="M8 7.500V11M8 5.200v.1"/></svg>`,
  history: `${SVG}<path d="M2.500 8a5.500 5.500 0 105.500-5.500A5.500 5.500 0 004 4.500M2 2.500v2.500h2.500M8 5v3l2 1.200"/></svg>`,
  more: `${SVG}<path d="M3.500 8h.1M8 8h.1M12.500 8h.1"/></svg>`,
} as const;

/* ---------- the view ---------- */

export interface ViewerViewProps extends ViewerProps {
  ask?: AskButtonProps;
  /** Image: the picture (a uri), its marked boxes and strokes. */
  src?: string;
  boxes?: readonly MarkupBox[];
  strokes?: readonly Stroke[];
  /** Document, plan and code: the blocks. */
  blocks?: readonly DocBlock[];
  /** CSV. */
  sheet?: Sheet;
  zoom?: number;
  /** The memory graph and this file's node in it: Links to and Linked from come from here. */
  graph?: ViewerGraph;
  nodeId?: string;
  onOpenLink?: (nodeId: string) => void;
  /** The Details panel (the info button): path, kind, size and the file's links. */
  details?: ViewerDetails;
  detailsOpen?: boolean;
  /** The selected cell when the sheet opens. */
  initialCell?: { r: number; c: number };
  /** The file's tile letters ("PNG", "CSV"), and the line under its name (path and when it changed). */
  kindLabel?: string;
  subtitle?: string;
  /** The agent that reads the markup: the markup bar offers "Ask <agent>" once something is marked. */
  agentName?: string;
  onAskMarkup?: (boxes: readonly MarkupBox[]) => void;
  /** Other images in the same folder, shown as a strip under the picture. */
  siblings?: readonly { id: string; title: string }[];
  current?: string;
  onSibling?: (id: string) => void;
  /** CSV and plan: View or Edit, and the saved version shown beside it. */
  edit?: boolean;
  saved?: number;
  onEditMode?: (edit: boolean) => void;
  onInfo?: () => void;
  onHistory?: () => void;
  onMore?: () => void;
  onBoxes?: (boxes: readonly MarkupBox[]) => void;
  onStrokes?: (strokes: readonly Stroke[]) => void;
  onEdit?: (blocks: readonly DocBlock[]) => void;
  onZoom?: (zoom: number) => void;
}

/** Web-only attributes. react-native-web drops unknown props, so `data-x` becomes `dataSet.x` and `data-testid` becomes `testID`. */
const web = (p: Record<string, unknown>): Record<string, unknown> => {
  if (Platform.OS !== "web") return {};
  const out: Record<string, unknown> = {};
  const dataSet: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === "data-testid") out["testID"] = v;
    else if (k.startsWith("data-")) dataSet[k.slice(5)] = v;
    else out[k] = v;
  }
  if (Object.keys(dataSet).length > 0) out["dataSet"] = dataSet;
  return out;
};

/** A plain loop that builds children from data. Lists of things a person selects are the shared ui/Row (the ui-rows lint holds the line); this builds marks, blocks and cells. */
function each<T, R>(items: readonly T[], make: (item: T, index: number) => R): R[] {
  const out: R[] = [];
  for (let i = 0; i < items.length; i++) out.push(make(items[i] as T, i));
  return out;
}

function Tool(p: { label: string; icon: string; on?: boolean; onPress: () => void; testID: string }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={p.label} aria-selected={p.on === true} accessibilityState={{ selected: p.on === true }} testID={p.testID} onPress={p.onPress}
      style={({ hovered }: { hovered?: boolean }) => [s.tool, p.on === true && s.toolOn, hovered === true && s.toolOver]}>
      <MenuIcon icon={p.icon} />
      <Text style={s.toolText}>{p.label}</Text>
    </Pressable>
  );
}

export function Viewer(props: ViewerViewProps): ReactElement {
  const [find, setFind] = useState(props.find ?? "");
  const [cur, setCur] = useState(0);
  const [findOpen, setFindOpen] = useState((props.find ?? "") !== "");
  const [editMode, setEditMode] = useState(props.edit === true);
  const [tool, setTool] = useState<MarkupTool | null>(props.tool ?? null);
  const [zoom, setZoom] = useState(props.zoom ?? 1);
  const [boxes, setBoxes] = useState<readonly MarkupBox[]>(props.boxes ?? []);
  const [strokes, setStrokes] = useState<readonly Stroke[]>(props.strokes ?? []);
  const [blocks, setBlocks] = useState<readonly DocBlock[]>(props.blocks ?? []);
  const [drag, setDrag] = useState<{ a: readonly [number, number]; b: readonly [number, number] } | null>(null);
  const [line, setLine] = useState<readonly (readonly [number, number])[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [cell, setCell] = useState<{ r: number; c: number } | null>(props.initialCell ?? null);
  const [detailsOpen, setDetailsOpen] = useState(props.detailsOpen === true);
  const stage = useRef<{ w: number; h: number }>({ w: IMAGE_W, h: IMAGE_H });

  const texts = useMemo(() => each(blocks, (b) => stripInline(b.text)), [blocks]);
  const hits = useMemo(() => findMatches(texts, find), [texts, find]);
  const at = hits.length === 0 ? 0 : cur % hits.length;
  const pins: readonly ViewerPin[] = props.pins ?? each(boxes, (b, i) => ({ id: b.id, n: i + 1, text: b.text }));
  const links = useMemo(() => (props.graph !== undefined && props.nodeId !== undefined ? linksOf(props.graph, props.nodeId) : { to: [] as readonly LinkRow[], from: [] as readonly LinkRow[] }), [props.graph, props.nodeId]);
  const editing = props.editing === true || ((props.kind === "document" || props.kind === "plan") && editMode);

  const setZ = (z: number): void => { setZoom(z); props.onZoom?.(z); };
  const changeBoxes = (next: readonly MarkupBox[]): void => { setBoxes(next); props.onBoxes?.(next); };
  const changeStrokes = (next: readonly Stroke[]): void => { setStrokes(next); props.onStrokes?.(next); };
  const changeBlocks = (next: readonly DocBlock[]): void => { setBlocks(next); props.onEdit?.(next); };
  const pick = (t: MarkupTool): void => setTool((x) => (x === t ? null : t));

  const iconBtn = (label: string, icon: string, testID: string, onPress?: () => void, on = false): ReactElement => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} aria-selected={on} accessibilityState={{ selected: on }} testID={testID} onPress={onPress}
      style={({ hovered }: { hovered?: boolean }) => [s.iconBtn, on && s.toolOn, hovered === true && s.toolOver]}><MenuIcon icon={icon} /></Pressable>
  );
  const bar = (
    <View style={s.bar} testID="vw-bar">
      {props.kindLabel !== undefined ? <View style={s.tile} testID="vw-tile"><Text style={s.tileText}>{props.kindLabel}</Text></View> : null}
      <View style={s.titleCol}>
        <Text style={s.title} numberOfLines={1}>{viewerLabel(props)}</Text>
        {props.subtitle !== undefined ? <Text style={s.sub} numberOfLines={1} testID="vw-sub">{props.subtitle}</Text> : null}
      </View>
      <View style={s.grow} />
      {findOpen ? (
        <View style={s.findBox} testID="vw-find">
          <MenuIcon icon={ICON.find} />
          <TextInput autoFocus={props.find === undefined} accessibilityLabel="Find in file" testID="vw-find-input" value={find} placeholder="Find in file" placeholderTextColor="var(--ink-4)" style={s.findInput}
            onChangeText={(t) => { setFind(t); setCur(0); props.onFind?.(t); }} onSubmitEditing={() => setCur((c) => c + 1)} />
          {find !== "" ? <Text style={s.count} testID="vw-count">{hits.length === 0 ? "No matches" : `${at + 1} of ${hits.length}`}</Text> : null}
          {hits.length > 1 ? (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous match" testID="vw-prev" onPress={() => setCur((c) => (c - 1 + hits.length) % hits.length)}><MenuIcon icon={ICON.up} /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Next match" testID="vw-next" onPress={() => setCur((c) => c + 1)}><MenuIcon icon={ICON.down} /></Pressable>
            </>
          ) : null}
        </View>
      ) : null}
      {props.kind === "image" ? (
        <View style={s.zoom} testID="vw-zoom">
          <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" testID="vw-zoom-out" onPress={() => setZ(stepZoom(zoom, -1))}><Text style={s.zoomText}>{"−"}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Reset zoom" testID="vw-zoom-reset" onPress={() => setZ(stepZoom(zoom, 0))}><Text style={s.zoomText}>{`${Math.round(zoom * 100)}%`}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" testID="vw-zoom-in" onPress={() => setZ(stepZoom(zoom, 1))}><Text style={s.zoomText}>{"+"}</Text></Pressable>
        </View>
      ) : null}
      {props.kind === "csv" || props.kind === "plan" || (props.kind === "document" && blocks.some((b) => b.tag !== "code")) ? (
        <View style={s.modeRow} testID="vw-mode">
          {props.saved !== undefined ? <Text style={s.saved} testID="vw-saved">{`✓ v${props.saved}`}</Text> : null}
          <View style={s.seg} accessibilityRole="tablist">
            {each(["View", "Edit"] as const, (m) => (
              <Pressable key={m} accessibilityRole="tab" aria-selected={(m === "Edit") === editMode} accessibilityState={{ selected: (m === "Edit") === editMode }} testID={`vw-mode-${m.toLowerCase()}`}
                onPress={() => { setEditMode(m === "Edit"); props.onEditMode?.(m === "Edit"); }} style={[s.segBtn, (m === "Edit") === editMode && s.segOn]}>
                <Text style={[s.segText, (m === "Edit") === editMode && s.segTextOn]}>{m}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {iconBtn("Find in file", ICON.find, "vw-find-btn", () => setFindOpen((o) => !o), findOpen)}
      {iconBtn("Details", ICON.info, "vw-info", () => { setDetailsOpen((o) => !o); props.onInfo?.(); }, detailsOpen)}
      {iconBtn("History", ICON.history, "vw-history", props.onHistory)}
      {props.ask !== undefined ? <AskButton {...props.ask} compact /> : null}
      {iconBtn("More", ICON.more, "vw-more", props.onMore)}
    </View>
  );

  const markBar = props.kind === "image" ? (
    <View style={s.mark} testID="vw-markup" accessibilityRole="toolbar" accessibilityLabel="Mark up">
      <Tool label="Draw" icon={ICON.draw} on={tool === "draw"} onPress={() => pick("draw")} testID="vw-tool-draw" />
      <Tool label="Comment on an area" icon={ICON.area} on={tool === "comment"} onPress={() => pick("comment")} testID="vw-tool-comment" />
      <View style={s.grow} />
      {boxes.length + strokes.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Clear markup" testID="vw-clear" onPress={() => { changeBoxes([]); changeStrokes([]); setNote(null); }}><Text style={s.toolText}>Clear</Text></Pressable> : null}
      {boxes.length + strokes.length > 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Ask ${props.agentName ?? "the agent"}`} testID="vw-ask-markup" onPress={() => props.onAskMarkup?.(boxes)} style={s.askMark}>
          <Text style={s.askMarkText}>{`Ask ${props.agentName ?? "the agent"}`}</Text>
        </Pressable>
      ) : null}
    </View>
  ) : null;

  const pointer = (phase: "down" | "move" | "up", e: { nativeEvent: { locationX: number; locationY: number } }): void => {
    if (tool === null) return;
    const p = toUnit(e.nativeEvent.locationX, e.nativeEvent.locationY, stage.current.w * zoom, stage.current.h * zoom);
    if (phase === "down") { if (tool === "draw") setLine([p]); else setDrag({ a: p, b: p }); return; }
    if (phase === "move") { if (tool === "draw") setLine((l) => (l === null ? l : [...l, p])); else setDrag((d) => (d === null ? d : { a: d.a, b: p })); return; }
    if (tool === "draw") { if (line !== null && line.length > 1) changeStrokes([...strokes, { points: line }]); setLine(null); return; }
    const box = drag === null ? null : boxFrom(drag.a, drag.b);
    setDrag(null);
    if (box !== null) { const id = `bx${boxes.length + 1}-${Date.now().toString(36)}`; changeBoxes([...boxes, { id, text: "", ...box }]); setNote(id); }
  };

  const image = (
    <ScrollView style={s.scroll} contentContainerStyle={s.imgWrap} testID="vw-image">
      <View style={[s.stageBox, { width: `${Math.min(100, 100 * zoom)}%`, aspectRatio: IMAGE_W / IMAGE_H }]} testID="vw-stage"
        onLayout={(e) => { stage.current = { w: e.nativeEvent.layout.width / zoom, h: e.nativeEvent.layout.height / zoom }; }}
        onStartShouldSetResponder={() => tool !== null} onResponderGrant={(e) => pointer("down", e)} onResponderMove={(e) => pointer("move", e)} onResponderRelease={(e) => pointer("up", e)}>
        {props.src !== undefined
          ? <Image accessibilityIgnoresInvertColors accessibilityLabel={props.title} source={{ uri: props.src }} resizeMode="cover" style={s.pictureImg} testID="vw-picture" />
          : <View style={s.picture}><Text style={s.pictureText}>{props.title}</Text></View>}
        {Platform.OS === "web" && (strokes.length > 0 || (line !== null && line.length > 1)) ? createElement("svg", { viewBox: "0 0 1 1", preserveAspectRatio: "none", "data-testid": "vw-strokes", style: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 2 } },
          ...each([...each(strokes, (st) => st.points), ...(line !== null ? [line] : [])], (pts, i) => createElement("polyline", { key: i, points: each(pts, (q) => `${q[0]},${q[1]}`).join(" "), fill: "none", stroke: "#E5483A", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }))) : null}
        {each(strokes, (st, i) => <View key={i} testID={`vw-stroke-${i}`} style={s.strokeMark} {...web({ "data-points": each(st.points, (q) => `${q[0].toFixed(3)},${q[1].toFixed(3)}`).join(" ") })} />)}
        {each(boxes, (b, i) => (
          <View key={b.id} testID={`vw-box-${b.id}`} pointerEvents="none" style={[s.box, { left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }]}>
            <View style={s.handle} testID={`vw-handle-${i + 1}`} />
            <View style={s.pin} testID={`vw-pin-${i + 1}`} {...web({ "data-anchor": `${b.x.toFixed(3)},${b.y.toFixed(3)}` })}><Text style={s.pinText}>{i + 1}</Text></View>
            {b.text !== "" ? <View style={s.bubble} testID={`vw-bubble-${i + 1}`}><Text style={s.bubbleText} numberOfLines={1}>{b.text}</Text></View> : null}
          </View>
        ))}
        {drag !== null ? (() => { const d = boxFrom(drag.a, drag.b); return d === null ? null : <View pointerEvents="none" style={[s.box, s.boxLive, { left: `${d.x * 100}%`, top: `${d.y * 100}%`, width: `${d.w * 100}%`, height: `${d.h * 100}%` }]} />; })() : null}
      </View>
      {note !== null ? (
        <View style={s.noteBox} testID="vw-note">
          <TextInput autoFocus accessibilityLabel="Note for this area" placeholder="What should change here?" placeholderTextColor="var(--ink-4)" style={s.noteInput}
            onSubmitEditing={(e) => { const text = e.nativeEvent.text.trim(); changeBoxes(each(boxes, (b) => (b.id === note ? { ...b, text } : b))); setNote(null); }} />
        </View>
      ) : null}
      {pins.length > 0 ? (
        <View style={s.pinList} testID="vw-pins">
          {each(pins, (p) => <Text key={p.id} style={s.pinRow} testID={`vw-pinrow-${p.n}`}>{`${p.n}  ${p.text === "" ? "No note yet" : p.text}`}</Text>)}
        </View>
      ) : null}
    </ScrollView>
  );
  const strip = props.kind === "image" && (props.siblings?.length ?? 0) > 0 ? (
    <View style={s.strip} testID="vw-siblings">
      {each(props.siblings ?? [], (sb) => (
        <Pressable key={sb.id} accessibilityRole="button" accessibilityLabel={sb.title} aria-selected={sb.id === props.current} accessibilityState={{ selected: sb.id === props.current }} testID={`vw-sib-${sb.id}`}
          onPress={() => props.onSibling?.(sb.id)} style={[s.thumb, sb.id === props.current && s.thumbOn]}><Text style={s.thumbText} numberOfLines={1}>{sb.title}</Text></Pressable>
      ))}
    </View>
  ) : null;

  const docBody = (
    <ScrollView style={s.scroll} contentContainerStyle={s.docWrap} testID="vw-doc">
      <View style={s.doc}>
        {each(blocks, (b, bi) => {
          if (b.tag === "meta") {
            return (
              <View key={b.id} style={s.meta} testID={`vw-block-${b.id}`}>
                {each(b.text.split("\n"), (ln, li) => { const [k, ...v] = ln.split("\t"); return <View key={li} style={s.metaRow}><Text style={s.metaKey}>{k}</Text><Text style={s.metaVal}>{v.join(" ")}</Text></View>; })}
              </View>
            );
          }
          if (editing && find === "") {
            return <TextInput key={b.id} multiline value={b.text} accessibilityLabel={`${b.tag} block`} testID={`vw-block-${b.id}`} style={[s.block, s[b.tag]]}
              onChangeText={(t) => changeBlocks(each(blocks, (x) => (x.id === b.id ? { ...x, text: t } : x)))} />;
          }
          const lead = b.tag === "li" ? "•  " : "";
          if (find !== "") {
            const runs = markRuns(stripInline(b.text), hits, bi, at, hits);
            return (
              <Text key={b.id} testID={`vw-block-${b.id}`} style={[s.block, s[b.tag]]} {...web({ "data-tag": b.tag })}>
                {lead}
                {each(runs, (r, i) => (r.hit === true ? <Text key={i} style={[s.mark1, r.on === true && s.markOn]} {...web({ "data-find": r.on === true ? "current" : "match" })}>{r.text}</Text> : r.text))}
              </Text>
            );
          }
          return (
            <Text key={b.id} testID={`vw-block-${b.id}`} style={[s.block, s[b.tag]]} {...web({ "data-tag": b.tag })}>
              {lead}
              {each(inlineRuns(b.text), (r, i) => (r.bold === true ? <Text key={i} style={s.bold}>{r.text}</Text> : r.link === true ? <Text key={i} style={s.link} {...web({ "data-link": "true" })}>{r.text}</Text> : r.text))}
            </Text>
          );
        })}
        {blocks.length === 0 ? <Text style={s.empty}>This file is empty.</Text> : null}
        {links.from.length > 0 ? (
          <View style={s.linked} testID="vw-linkedfrom">
            <Text style={s.detailSec}>{`Linked from · ${links.from.length}`}</Text>
            {each(links.from, (l) => <Row key={l.id} id={`lf-${l.id}`} title={l.title} {...(l.note !== undefined ? { note: l.note } : {})} onPress={() => props.onOpenLink?.(l.id)} />)}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );

  const [edits, setEdits] = useState<Record<string, string>>({});
  const base = props.sheet;
  const sheet = useMemo<Sheet | undefined>(() => (base === undefined ? undefined : { cols: base.cols, rows: each(base.rows, (r, ri) => each(r, (v, ci) => edits[`${ri}:${ci}`] ?? v)) }), [base, edits]);
  const rows = useMemo(() => (sheet === undefined ? [] : sort === null ? sheet.rows : sortRows(sheet.rows, sort.col, sort.dir)), [sheet, sort]);
  const table = sheet === undefined ? null : (
    <View style={s.fill}>
      <ScrollView style={s.scroll} horizontal contentContainerStyle={s.sheetWrap} testID="vw-sheet">
        <View style={s.fill}>
          <View style={s.tr}>
            <Text style={[s.th, s.rn]}>{""}</Text>
            {each(sheet.cols, (c, ci) => (
              <Pressable key={c} accessibilityRole="button" accessibilityLabel={`Sort by ${c}`} testID={`vw-sort-${ci}`} style={s.thCell}
                onPress={() => setSort((x) => (x !== null && x.col === ci ? { col: ci, dir: x.dir === 1 ? -1 : 1 } : { col: ci, dir: 1 }))}>
                <Text style={s.th}>{`${c}${sort !== null && sort.col === ci ? (sort.dir === 1 ? " ↑" : " ↓") : ""}`}</Text>
              </Pressable>
            ))}
          </View>
          {each(rows, (r, ri) => (
            <View key={ri} style={s.tr}>
              <Text style={[s.td, s.rn]}>{ri + 1}</Text>
              {each(r, (v, ci) => {
                const on = cell !== null && cell.r === ri && cell.c === ci;
                const m = find !== "" && v.toLowerCase().includes(find.trim().toLowerCase());
                return (
                  <Pressable key={ci} accessibilityRole="button" aria-selected={on} accessibilityState={{ selected: on }} testID={`vw-cell-${ri}-${ci}`} onPress={() => setCell({ r: ri, c: ci })}
                    style={[s.tdCell, on && s.tdOn, m && s.mark1]}>
                    {on && editMode ? <TextInput autoFocus accessibilityLabel={`Edit cell ${ri + 1}, ${sheet.cols[ci] ?? ""}`} testID="vw-cell-input" value={v} style={[s.td, s.cellInput, isNum(v) && s.numCell]}
                      onChangeText={(x) => setEdits((e) => ({ ...e, [`${ri}:${ci}`]: x }))} />
                      : <Text style={[s.td, isNum(v) && s.numCell]}>{v}</Text>}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={s.footRow}><Text style={s.footText} testID="vw-foot">{sheetFoot(sheet, cell === null ? null : cell.c)}</Text>{editMode ? <Text style={s.footText} testID="vw-hint">Click a cell, then type or press Enter to edit · Tab moves right</Text> : null}</View>
    </View>
  );

  const body = props.kind === "image" ? image
    : props.kind === "csv" ? table
    : props.kind === "document" || props.kind === "plan" ? docBody
    : <View style={s.emptyBox} testID="vw-other"><Text style={s.empty}>No preview for this file. Open it in its own app.</Text></View>;

  return (
    <View accessibilityLabel={viewerLabel(props)} style={s.root} testID="viewer"
      {...web({ "data-testid": "viewer", "data-kind": props.kind, "data-pane": props.pane ?? "side", "data-tool": tool ?? "none", "data-zoom": String(zoom), "data-density": props.density ?? "regular" })}>
      {bar}
      {markBar}
      <View style={s.main}>
        <View style={s.fill}>{body}</View>
        {detailsOpen && (props.details !== undefined || links.to.length + links.from.length > 0) ? (
          <View style={s.details} testID="vw-details">
            <View style={s.detailsHead}>
              <Text style={s.detailsTitle}>Details</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close details" testID="vw-details-close" onPress={() => setDetailsOpen(false)}><Text style={s.zoomText}>{"×"}</Text></Pressable>
            </View>
            <ScrollView style={s.scroll} contentContainerStyle={s.detailsBody}>
              {each(props.details?.rows ?? [], ([k, v]) => <View key={k} style={s.metaRow} testID={`vw-detail-${k}`}><Text style={s.metaKey}>{k}</Text><Text style={s.metaVal}>{v}</Text></View>)}
              {each([...(props.details?.sections ?? []), ...(links.to.length > 0 ? [{ title: "Links to", count: links.to.length, items: links.to }] : []), ...(links.from.length > 0 ? [{ title: "Linked from", count: links.from.length, items: links.from }] : [])], (sec) => (
                <View key={sec.title} testID={`vw-detail-section-${sec.title}`}>
                  <Text style={s.detailSec}>{sec.count !== undefined ? `${sec.title}  ${sec.count}` : sec.title}</Text>
                  {each(sec.items, (it) => <Row key={it.id} id={`d-${it.id}`} title={it.title} {...(it.note !== undefined ? { note: it.note } : {})} onPress={() => props.onOpenLink?.(it.id)} />)}
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>
      {strip}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: "var(--win)" as string },
  fill: { flex: 1, minHeight: 0 },
  grow: { flex: 1 },
  scroll: { flex: 1 },
  bar: { height: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  title: { color: "var(--ink)" as string, fontSize: 13.5, fontWeight: "600", flexShrink: 1 },
  titleCol: { minWidth: 0, flexShrink: 1 },
  sub: { color: "var(--ink-3)" as string, fontSize: 11.5 },
  tile: { width: 28, height: 28, borderRadius: 6, backgroundColor: "var(--sunk)" as string, alignItems: "center", justifyContent: "center" },
  tileText: { color: "var(--ink-3)" as string, fontSize: 8.5, fontWeight: "700" },
  iconBtn: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  modeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  saved: { color: "var(--ok)" as string, fontSize: 12 },
  seg: { flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  segBtn: { paddingHorizontal: 10, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: "var(--win)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  segText: { color: "var(--ink-3)" as string, fontSize: 12.5, fontWeight: "500" },
  segTextOn: { color: "var(--ink)" as string },
  askMark: { height: 28, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "var(--ink)" as string, alignItems: "center", justifyContent: "center" },
  askMarkText: { color: "var(--win)" as string, fontSize: 12.5, fontWeight: "600" },
  bubble: { position: "absolute", top: -12, right: -4, transform: [{ translateX: "100%" as unknown as number }], backgroundColor: "var(--win)" as string, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: "var(--line)" as string, maxWidth: 220 },
  bubbleText: { color: "var(--ink)" as string, fontSize: 12 },
  strip: { flexDirection: "row", gap: 8, padding: 8, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  thumb: { width: 64, height: 40, borderRadius: 6, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--sunk)" as string, alignItems: "center", justifyContent: "center", padding: 3 },
  thumbOn: { borderColor: "var(--accent)" as string, borderWidth: 2 },
  thumbText: { color: "var(--ink-3)" as string, fontSize: 9 },
  cellInput: { padding: 0, margin: 0 },
  footRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  footText: { color: "var(--ink-3)" as string, fontSize: 12 },
  findBox: { flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingHorizontal: 8, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  findInput: { width: 140, color: "var(--ink)" as string, fontSize: 13, padding: 0 },
  count: { color: "var(--ink-3)" as string, fontSize: 11.5 },
  zoom: { flexDirection: "row", alignItems: "center", gap: 10 },
  zoomText: { color: "var(--ink-3)" as string, fontSize: 13 },
  mark: { height: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  tool: { flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingHorizontal: 10, borderRadius: 8 },
  toolOn: { backgroundColor: "var(--accent-wash)" as string },
  toolOver: { backgroundColor: "var(--hover)" as string },
  toolText: { color: "var(--ink-3)" as string, fontSize: 12.5, fontWeight: "500" },
  imgWrap: { padding: 24, alignItems: "center", gap: 14 },
  stageBox: { borderRadius: 10, overflow: "hidden", backgroundColor: "var(--sunk)" as string, ...(Platform.OS === "web" ? ({ backgroundImage: "conic-gradient(var(--sunk) 25%, var(--raised) 0 50%, var(--sunk) 0 75%, var(--raised) 0)", backgroundSize: "16px 16px" } as object) : {}), borderWidth: 1, borderColor: "var(--line)" as string },
  pictureImg: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  picture: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "var(--raised)" as string },
  pictureText: { color: "var(--ink-4)" as string, fontSize: 13 },
  strokeMark: { position: "absolute", left: 0, top: 0, width: 1, height: 1 },
  box: { position: "absolute", borderWidth: 2, borderColor: "#E5483A", backgroundColor: "rgba(229,72,58,0.12)", borderRadius: 6 },
  boxLive: { borderStyle: "dashed" },
  pin: { position: "absolute", left: -12, top: -12, width: 24, height: 24, borderRadius: 12, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  pinText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  noteBox: { width: "100%", maxWidth: 480, borderRadius: 10, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string, padding: 10 },
  noteInput: { color: "var(--ink)" as string, fontSize: 13, padding: 0 },
  pinList: { width: "100%", maxWidth: 480, gap: 6 },
  pinRow: { color: "var(--ink-2)" as string, fontSize: 13 },
  docWrap: { padding: 24, alignItems: "center" },
  main: { flex: 1, flexDirection: "row", minHeight: 0 },
  details: { width: 300, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string },
  detailsHead: { height: 40, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14 },
  detailsTitle: { color: "var(--ink)" as string, fontSize: 13, fontWeight: "600" },
  detailsBody: { paddingHorizontal: 14, paddingBottom: 20, gap: 8 },
  detailSec: { color: "var(--ink-3)" as string, fontSize: 12, fontWeight: "600", marginTop: 14, marginBottom: 4 },
  meta: { borderRadius: 10, backgroundColor: "var(--sunk)" as string, padding: 14, gap: 6, marginBottom: 6 },
  metaRow: { flexDirection: "row", gap: 12 },
  metaKey: { width: 84, color: "var(--ink-3)" as string, fontSize: 12.5 },
  metaVal: { flex: 1, color: "var(--ink)" as string, fontSize: 12.5 },
  bold: { fontWeight: "700" },
  link: { color: "var(--accent)" as string },
  handle: { position: "absolute", right: -7, top: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: "#E5483A", borderWidth: 2, borderColor: "#FFFFFF" },
  linked: { marginTop: 22, paddingTop: 6, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  doc: { width: "100%", maxWidth: 720, gap: 10 },
  block: { color: "var(--ink)" as string, fontSize: 15, lineHeight: 23, padding: 0 },
  h1: { fontSize: 24, lineHeight: 30, fontWeight: "700" },
  h2: { fontSize: 18, lineHeight: 26, fontWeight: "600" },
  p: {},
  li: { paddingLeft: 6 },
  code: { fontFamily: MONO_VAR, fontSize: 12.5, lineHeight: 19 },
  mark1: { backgroundColor: "var(--accent-wash)" as string },
  markOn: { backgroundColor: "var(--warn)" as string },
  sheetWrap: { padding: 14, flexGrow: 1 },
  tr: { flexDirection: "row" },
  th: { color: "var(--ink-3)" as string, fontSize: 12, fontWeight: "600", paddingVertical: 6 },
  thCell: { flex: 1, minWidth: 150, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, borderRightWidth: 1, borderRightColor: "var(--line)" as string, backgroundColor: "var(--sunk)" as string },
  rn: { width: 36, textAlign: "right", paddingRight: 8, color: "var(--ink-4)" as string },
  td: { color: "var(--ink)" as string, fontSize: 13, paddingVertical: 7 },
  tdCell: { flex: 1, minWidth: 150, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, borderRightWidth: 1, borderRightColor: "var(--line)" as string },
  tdOn: { borderWidth: 2, borderColor: "var(--accent)" as string },
  numCell: { textAlign: "right" },
  foot: { color: "var(--ink-3)" as string, fontSize: 12, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { color: "var(--ink-3)" as string, fontSize: 13, textAlign: "center", paddingVertical: 40 },
});
