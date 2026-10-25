// The graph surface: sigma.js (WebGL) over a graphology graph, so ten thousand notes pan and zoom at the frame rate. This is the one place sigma is used; everything around it (layers, kinds, the
// time slider, Find, saving where a node was left, export) is in MemoryGraph and reaches the surface through these props. Sigma and graphology load when the surface mounts, never on the server or
// in a test, and colours are read from the skin's tokens when it draws, so a skin switch repaints. No WebGL, no surface: the screen says so and the same nodes are in the list beneath it.
import { createElement, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type Graph from "graphology";
import type Sigma from "sigma";
import { KINDS, KIND_HUE, KIND_LABEL, hslHex, kindColor, neighborsOf, radiusOf } from "./model.ts";
import type { GEdge, GNode, Positions } from "./model.ts";

export interface SurfaceProps {
  nodes: readonly GNode[];
  edges: readonly GEdge[];
  pos: Positions;
  deg: ReadonlyMap<string, number>;
  sel: string | null;
  lit: ReadonlySet<string>;
  /** Changes whenever the picture is a new one (another scope, day, filter), so the camera fits it again. */
  fitKey: string;
  /** A one-shot request from the zoom buttons and keys. */
  command: { id: number; kind: "in" | "out" | "fit" | "focus"; node?: string } | null;
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void;
  /** A node was dragged and let go: where it is now. */
  onDrop: (id: string, p: { x: number; y: number }) => void;
  onMenu: (id: string, x: number, y: number) => void;
  onKey: (e: { key: string; shiftKey?: boolean; preventDefault?: () => void }) => void;
  /** The kinds the legend shows as on (none chosen means every kind), and a click on one of its rows. */
  kinds?: ReadonlySet<string>;
  onKind?: (k: GNode["kind"]) => void;
  /** A window too narrow for the legend card: it is left out, as in the prototype. */
  narrow?: boolean;
}

/** The family the root font set on this host (canvas text cannot inherit it, so it is read once from the computed style). */
function family(el: Element): string {
  const css = (globalThis as { getComputedStyle?: (e: Element) => { fontFamily: string } }).getComputedStyle?.(el).fontFamily;
  return css && css.trim() ? css : "sans-serif";
}

/** A colour from the skin as a value WebGL can use (#rrggbb or rgba), whatever form the token is written in. */
function resolve(el: Element, token: string, fallback: string): string {
  const css = (globalThis as { getComputedStyle?: (e: Element) => { getPropertyValue(p: string): string } }).getComputedStyle?.(el).getPropertyValue(token).trim();
  if (!css) return fallback;
  const doc = (globalThis as { document?: { createElement(t: string): { getContext(k: string): { fillStyle: string } | null } } }).document;
  const ctx = doc?.createElement("canvas").getContext("2d");
  if (!ctx) return fallback;
  ctx.fillStyle = "#000000";
  ctx.fillStyle = css;
  return ctx.fillStyle;
}

interface Live { sel: string | null; hover: string | null; lit: ReadonlySet<string>; near: ReadonlySet<string> | null; hubs: ReadonlySet<string>; ink: string; ink3: string; line: string; faint: string; accent: string; edgeInk: string; font: string }

/** How many of the most linked notes keep their name on screen when nothing is selected. */
const HUBS = 12;
/** A group needs this many notes to get a halo. */
const HALO_MIN = 3;

export function GraphSurface(p: SurfaceProps): ReactElement | null {
  const el = useRef<HTMLElement | null>(null);
  const sigma = useRef<Sigma | null>(null);
  const graph = useRef<Graph | null>(null);
  const live = useRef<Live>({ sel: null, hover: null, lit: new Set(), near: null, hubs: new Set(), ink: "#555555", ink3: "#777777", line: "#cccccc", faint: "#aaaaaa", accent: "#5b50e8", edgeInk: "#a1a1aa", font: "sans-serif" });
  const props = useRef(p);
  props.current = p;
  const [failed, setFailed] = useState<string | null>(null);
  const [ready, setReady] = useState(0);
  const haloEl = useRef<HTMLCanvasElement | null>(null);
  const seen = useRef({ fit: "", command: 0 });

  // sigma and graphology are loaded when the surface is on screen
  useEffect(() => {
    const node = el.current;
    if (!node || Platform.OS !== "web") return;
    let dead = false;
    let renderer: Sigma | null = null;
    void Promise.all([import("sigma"), import("graphology")]).then(([sg, gr]) => {
      if (dead) return;
      try {
        const g = new gr.default();
        graph.current = g;
        const r = new sg.default(g, node, {
          renderEdgeLabels: false, labelRenderedSizeThreshold: 8, labelSize: 12, labelWeight: "500", labelFont: family(node), zIndex: true, minCameraRatio: 0.08, maxCameraRatio: 4, allowInvalidContainer: true,
          nodeReducer: (id, d) => {
            const s = live.current;
            const dim = (s.near !== null && !s.near.has(id)) || (s.lit.size > 0 && !s.lit.has(id));
            const on = s.sel === id || s.hover === id;
            return { ...d, color: dim ? fade(d.color, s.faint) : d.color, label: dim && !s.lit.has(id) ? "" : d.label, forceLabel: on || s.lit.has(id) || (!dim && s.hubs.has(id)), highlighted: s.sel === id, zIndex: on ? 2 : dim ? 0 : 1 };
          },
          edgeReducer: (id, d) => {
            const s = live.current;
            const [a, b] = g.extremities(id);
            const hot = s.sel !== null && (a === s.sel || b === s.sel);
            return { ...d, color: hot ? s.accent : s.near !== null ? fade(s.edgeInk, s.faint) : s.edgeInk, size: hot ? 2.4 : d.size, zIndex: hot ? 1 : 0 };
          },
          defaultEdgeColor: "#a1a1aa",
          // the hovered or selected note keeps the quiet label (no white box over a dark skin): its name beside it in the full ink
          defaultDrawNodeHover: (ctx, d, st) => {
            if (!d.label) return;
            ctx.font = `${st.labelWeight} ${st.labelSize}px ${st.labelFont}`;
            ctx.fillStyle = live.current.ink;
            ctx.fillText(d.label, d.x + d.size + 3, d.y + st.labelSize / 3);
          },
        });
        renderer = r;
        sigma.current = r;
        // the cluster halos sit on a canvas under sigma's own, redrawn after every frame it draws
        const halo = (globalThis as { document: Document }).document.createElement("canvas");
        halo.setAttribute("data-testid", "graph-halos");
        halo.setAttribute("aria-hidden", "true");
        halo.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
        node.insertBefore(halo, node.firstChild);
        haloEl.current = halo;
        r.on("afterRender", () => drawHalos(halo, r, g, live.current));
        let drag: { id: string; moved: boolean } | null = null;
        r.on("downNode", (e) => { drag = { id: e.node, moved: false }; g.setNodeAttribute(e.node, "highlighted", true); if (!r.getCustomBBox()) r.setCustomBBox(r.getBBox()); r.getCamera().disable(); });
        r.getMouseCaptor().on("mousemovebody", (e) => {
          if (!drag) return;
          drag.moved = true;
          const q = r.viewportToGraph(e);
          g.setNodeAttribute(drag.id, "x", q.x);
          g.setNodeAttribute(drag.id, "y", q.y);
          e.preventSigmaDefault();
          e.original.preventDefault();
          e.original.stopPropagation();
        });
        const up = (): void => {
          const d = drag;
          drag = null;
          r.getCamera().enable();
          if (!d) return;
          g.removeNodeAttribute(d.id, "highlighted");
          if (d.moved) props.current.onDrop(d.id, { x: Math.round(g.getNodeAttribute(d.id, "x") as number), y: Math.round(g.getNodeAttribute(d.id, "y") as number) });
          else props.current.onSelect(d.id);
        };
        r.getMouseCaptor().on("mouseup", up);
        r.on("clickStage", () => props.current.onSelect(null));
        r.on("doubleClickNode", (e) => { e.preventSigmaDefault(); props.current.onOpen(e.node); });
        r.on("rightClickNode", (e) => { e.preventSigmaDefault(); e.event.original.preventDefault(); { const o = e.event.original as MouseEvent; props.current.onMenu(e.node, o.clientX, o.clientY); } });
        r.on("enterNode", (e) => { live.current.hover = e.node; r.refresh({ skipIndexation: true }); });
        r.on("leaveNode", () => { live.current.hover = null; r.refresh({ skipIndexation: true }); });
        setReady((n) => n + 1);
      } catch (e) {
        setFailed(e instanceof Error ? e.message : "WebGL is not available");
      }
    }).catch((e: unknown) => setFailed(e instanceof Error ? e.message : "The graph could not load"));
    return () => { dead = true; renderer?.kill(); haloEl.current?.remove(); haloEl.current = null; sigma.current = null; graph.current = null; };
  }, []);

  // the nodes and the links: rebuilt when the picture changes
  useEffect(() => {
    const g = graph.current, r = sigma.current, node = el.current;
    if (!g || !r || !node) return;
    const kind = (k: GNode["kind"]): string => hslHex(KIND_HUE[k], 62, 55);
    g.clear();
    for (const n of p.nodes) {
      const at = p.pos[n.nodeId];
      if (!at) continue;
      g.addNode(n.nodeId, { x: at.x, y: at.y, size: radiusOf(p.deg.get(n.nodeId) ?? 0) * 0.62, label: n.title, color: kind(n.kind), kind: n.kind, cluster: n.cluster ?? "" });
    }
    for (const e of p.edges) if (g.hasNode(e.from) && g.hasNode(e.to) && !g.hasEdge(e.from, e.to)) g.addEdge(e.from, e.to, { size: e.kind === "came_from" ? 0.8 : 1.3, kind: e.kind });
    live.current.hubs = new Set([...p.nodes].sort((a, b) => (p.deg.get(b.nodeId) ?? 0) - (p.deg.get(a.nodeId) ?? 0) || a.title.localeCompare(b.title)).slice(0, HUBS).filter((n) => (p.deg.get(n.nodeId) ?? 0) > 0).map((n) => n.nodeId));
    live.current.font = family(node);
    live.current.ink = resolve(node, "--ink-2", "#555555");
    live.current.ink3 = resolve(node, "--ink-3", "#777777");
    live.current.line = resolve(node, "--line", "#cccccc");
    live.current.faint = resolve(node, "--win", "#ffffff");
    live.current.accent = resolve(node, "--accent", "#5b50e8");
    live.current.edgeInk = resolve(node, "--ink-4", "#a1a1aa");
    r.setSetting("labelColor", { color: live.current.ink });
    r.setSetting("defaultEdgeColor", live.current.edgeInk);
    r.setCustomBBox(null);
    r.refresh();
    if (seen.current.fit !== p.fitKey) { seen.current.fit = p.fitKey; void r.getCamera().animatedReset({ duration: 220 }); }
  }, [p.nodes, p.edges, p.pos, p.deg, p.fitKey, ready]);

  // selection, search and the neighbours of the selected node: only a repaint
  useEffect(() => {
    const r = sigma.current;
    live.current.sel = p.sel;
    live.current.lit = p.lit;
    live.current.near = p.sel ? neighborsOf(p.sel, p.edges) : null;
    r?.refresh({ skipIndexation: true });
  }, [p.sel, p.lit, p.edges, ready]);

  // zoom buttons, keys and focus
  useEffect(() => {
    const r = sigma.current, c = p.command;
    if (!r || !c || seen.current.command === c.id) return;
    seen.current.command = c.id;
    const cam = r.getCamera();
    if (c.kind === "in") void cam.animatedZoom({ duration: 160 });
    else if (c.kind === "out") void cam.animatedUnzoom({ duration: 160 });
    else if (c.kind === "fit") void cam.animatedReset({ duration: 220 });
    else if (c.node) { const d = r.getNodeDisplayData(c.node); if (d) void cam.animate({ x: d.x, y: d.y, ratio: Math.min(cam.ratio, 0.7) }, { duration: 220 }); }
  }, [p.command, ready]);

  if (Platform.OS !== "web") return null;
  if (failed) return <View style={s.fail} testID="graph-nowebgl"><Text style={s.failText}>{`The graph needs WebGL, which this window does not have (${failed}).`}</Text></View>;
  const near = p.sel ? neighborsOf(p.sel, p.edges) : null;
  // the canvas cannot be read by a screen reader, so the same notes are a listbox beside it: the selected one says so, and so do the ones it links to
  const options: ReactElement[] = [];
  for (const n of p.nodes) {
    options.push(createElement("div", {
      key: n.nodeId, role: "option", tabIndex: -1, "aria-selected": p.sel === n.nodeId, "aria-label": `${n.title}, ${KIND_LABEL[n.kind]}, ${p.deg.get(n.nodeId) ?? 0} links`, "data-testid": `gnode-${n.nodeId}`, "data-kind": n.kind,
      "data-linked": near !== null && near.has(n.nodeId) && p.sel !== n.nodeId ? "true" : "false", "data-lit": p.lit.has(n.nodeId) ? "true" : "false",
      onClick: () => p.onSelect(n.nodeId), onDoubleClick: () => p.onOpen(n.nodeId),
    }, n.title));
  }
  return createElement(
    "div",
    { style: { position: "absolute", inset: 0 } },
    createElement("div", {
      ref: (n: HTMLElement | null) => { el.current = n; }, tabIndex: 0, role: "application", "aria-label": "Memory graph. Tab walks the notes, Enter opens one, plus and minus zoom.", "data-testid": "graph-surface",
      onKeyDown: p.onKey, style: { position: "absolute", inset: 0, outline: "none" },
    }),
    p.narrow ? null : kindsLegend(p),
    createElement("div", { role: "listbox", "aria-label": "Notes in the graph", "data-testid": "graph-notes", style: { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } }, ...options),
  );
}

/** The legend as a card in the lower left corner: one row per kind with its colour and how many notes of it are drawn. A row turns that kind off and on. */
function kindsLegend(p: SurfaceProps): ReactElement {
  const count = new Map<string, number>();
  for (const n of p.nodes) count.set(n.kind, (count.get(n.kind) ?? 0) + 1);
  const chosen = p.kinds ?? new Set<string>();
  const rows: ReactElement[] = [];
  for (const k of KINDS) {
    const off = chosen.size > 0 && !chosen.has(k);
    rows.push(createElement("button", {
      key: k, type: "button", "data-testid": `legend-${k}`, "aria-pressed": !off, "aria-label": `${KIND_LABEL[k]}, ${count.get(k) ?? 0}`, onClick: () => p.onKind?.(k),
      style: { display: "flex", alignItems: "center", gap: 8, height: 22, width: "100%", padding: "0 4px", border: 0, borderRadius: 6, background: "transparent", font: "inherit", fontSize: 12, color: "var(--ink-2)", textAlign: "left", cursor: "pointer", opacity: off ? 0.4 : 1 },
    },
    createElement("i", { style: { width: 9, height: 9, borderRadius: 9, flex: "none", background: kindColor(k), display: "inline-block" } }),
    KIND_LABEL[k],
    createElement("span", { style: { marginLeft: "auto", paddingLeft: 14, color: "var(--ink-4)", fontVariantNumeric: "tabular-nums" } }, String(count.get(k) ?? 0))));
  }
  return createElement("div", { key: "legend", "data-testid": "graph-legend", role: "group", "aria-label": "Kinds", style: { position: "absolute", left: 16, bottom: 16, display: "flex", flexDirection: "column", gap: 1, padding: "8px 10px", borderRadius: 12, background: "color-mix(in srgb, var(--raised) 86%, transparent)", backdropFilter: "blur(10px)", boxShadow: "var(--sh-1), inset 0 0 0 1px var(--line)", minWidth: 150 } }, ...rows);
}

/** The halos: a soft disc behind each group of notes that share a cluster, with the cluster's name over it. The group's size and place come from where sigma has put its notes on screen. */
function drawHalos(cv: HTMLCanvasElement, r: Sigma, g: Graph, live: Live): void {
  const host = cv.parentElement;
  if (!host) return;
  const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
  const w = host.clientWidth, h = host.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext("2d");
  if (!c) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const by = new Map<string, { x: number; y: number }[]>();
  g.forEachNode((id, a) => {
    const name = a.cluster as string;
    if (!name) return;
    const d = r.getNodeDisplayData(id);
    if (!d) return;
    const at = r.framedGraphToViewport({ x: d.x, y: d.y });
    const list = by.get(name);
    if (list) list.push(at); else by.set(name, [at]);
  });
  for (const [name, pts] of by) {
    if (pts.length < HALO_MIN) continue;
    let cx = 0, cy = 0;
    for (const q of pts) { cx += q.x; cy += q.y; }
    cx /= pts.length; cy /= pts.length;
    let far = 0, sum = 0;
    for (const q of pts) { const d = Math.hypot(q.x - cx, q.y - cy); far = Math.max(far, d); sum += d; }
    const rad = Math.min(far, (sum / pts.length) * 1.35) + 40;
    const grd = c.createRadialGradient(cx, cy, rad * 0.2, cx, cy, rad);
    grd.addColorStop(0, "rgba(128,128,255,.075)");
    grd.addColorStop(1, "rgba(128,128,255,.02)");
    c.fillStyle = grd;
    c.beginPath(); c.arc(cx, cy, rad, 0, Math.PI * 2); c.fill();
    c.strokeStyle = live.line; c.globalAlpha = 0.55; c.lineWidth = 1; c.setLineDash([2, 5]); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
    c.font = `600 11.5px ${live.font}`; c.fillStyle = live.ink3; c.textAlign = "center";
    c.fillText(name, cx, Math.max(14, cy - rad - 7));
  }
}

/** A colour mixed toward the background by a third: how a node or link that is not in focus looks. */
function fade(color: string | undefined, bg: string): string {
  const a = rgbOf(color ?? "#888888"), b = rgbOf(bg);
  const m = (x: number, y: number): number => Math.round(x * 0.22 + y * 0.78);
  return `rgb(${m(a[0], b[0])},${m(a[1], b[1])},${m(a[2], b[2])})`;
}

function rgbOf(c: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex) { const n = parseInt(hex[1]!, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const rgb = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : [136, 136, 136];
}

const s = StyleSheet.create({
  fail: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  failText: { fontSize: 13, color: "var(--ink-3)" as string, textAlign: "center" },
});
