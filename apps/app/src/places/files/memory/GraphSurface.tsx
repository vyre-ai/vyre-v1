// The graph surface: one 2D canvas that draws the typed nodes (a round dot per kind, a rounded square for a chat) and the labelled edges, and answers the pointer. This is the one place the picture is
// drawn; everything around it (stat line, legend, evidence card, time slider, menus, route) is MemoryGraph. Why a canvas and not sigma: sigma draws edge labels only through its own label pass and
// tests an edge hit against every edge on every mouse move, and neither holds at thousands of edges. Here the edges of a frame go into a handful of batched paths (one stroke per style), labels are
// left off past EDGE_LABELS_MAX edges in view, and a pointer asks a spatial grid (model.ts HitGrid: nodes by cell, edges by every cell they cross) that is built once per picture and camera, so a hover
// costs the same at ten nodes and at ten thousand. Colours are read from the skin's tokens while drawing, so a skin switch repaints. Pan by dragging the background, zoom with the wheel, drag a node to
// move it (the drop is reported), click a node or an edge to select it, double-click a node to open it, right-click for a menu. The same nodes and links are also a hidden list a screen reader walks.
import { createElement, useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { KIND_LABEL, buildGrid, centreOn, edgeKey, fitCam, hitAt, kindHex, labelPlan, neighborsOf, nodeRadius, panBy, toWorld, zoomAt } from "./model.ts";
import type { Cam, HitGrid, KGEdge, KGNode, Positions } from "./model.ts";

export interface SurfaceCommand { id: number; kind: "in" | "out" | "fit" | "focus" | "pan"; node?: string; dx?: number; dy?: number }
export interface SurfaceMenu { kind: "node" | "edge" | "bg"; id?: string; x: number; y: number }

export interface SurfaceProps {
  nodes: readonly KGNode[];
  edges: readonly KGEdge[];
  pos: Positions;
  deg: ReadonlyMap<string, number>;
  sel: string | null;
  /** The selected edge, `<from>><to>`. */
  selEdge: string | null;
  lit: ReadonlySet<string>;
  /** The subject of an "Around" graph: drawn biggest, with a ring. */
  center: string | null;
  /** Every edge shows its label (an Around graph); otherwise only the edge that is hovered or selected, or one of a hovered or selected node, does. */
  labelsAll: boolean;
  /** Changes whenever the picture is a new one (another subject, scope, day, filter), so the camera fits it again. */
  fitKey: string;
  /** A one-shot request from the zoom buttons and keys. */
  command: SurfaceCommand | null;
  onSelectNode: (id: string) => void;
  onSelectEdge: (key: string) => void;
  /** A click on the background. */
  onClear: () => void;
  onOpen: (id: string) => void;
  /** A node was dragged and let go: where it is now. */
  onDrop: (id: string, p: { x: number; y: number }) => void;
  onMenu: (m: SurfaceMenu) => void;
  onKey: (e: { key: string; shiftKey?: boolean; preventDefault?: () => void }) => void;
}

/** How many of the most linked nodes keep their name on screen when the picture is crowded. */
const HUBS = 12;
/** The most links the hidden list names (the canvas has all of them); the selected one is always in it. */
const LIST_EDGES = 300;

interface Colors { ink: string; ink2: string; ink3: string; ink4: string; line: string; win: string; accent: string; font: string; at: number }
interface Drag { mode: "node" | "pan"; id: string; sx: number; sy: number; cam: Cam; moved: boolean; hit: ReturnType<typeof hitAt> }
interface Live {
  cam: Cam; w: number; h: number; needFit: boolean; fitKey: string; command: number; raf: number; grid: HitGrid | null; moved: Positions; hover: ReturnType<typeof hitAt>; drag: Drag | null;
  near: ReadonlySet<string> | null; hubs: ReadonlySet<string>; colors: Colors | null; xs: Float64Array;
}

function token(el: Element, name: string, fallback: string): string {
  const css = (globalThis as { getComputedStyle?: (e: Element) => { getPropertyValue(p: string): string } }).getComputedStyle?.(el).getPropertyValue(name).trim();
  return css || fallback;
}

export function GraphSurface(p: SurfaceProps): ReactElement | null {
  const box = useRef<HTMLDivElement | null>(null);
  const cv = useRef<HTMLCanvasElement | null>(null);
  const props = useRef(p);
  props.current = p;
  const live = useRef<Live>({ cam: { x: 0, y: 0, k: 1 }, w: 0, h: 0, needFit: true, fitKey: "", command: 0, raf: 0, grid: null, moved: {}, hover: null, drag: null, near: null, hubs: new Set(), colors: null, xs: new Float64Array(0) });
  const draw = useRef<() => void>(() => undefined);
  const schedule = useRef<() => void>(() => undefined);

  // the drawing and the pointer: set up once, reading the latest props through a ref
  useEffect(() => {
    const host = box.current, canvas = cv.current;
    if (!host || !canvas || Platform.OS !== "web") return;
    const s = live.current;
    const at = (id: string): { x: number; y: number } | undefined => s.moved[id] ?? props.current.pos[id];
    const radius = (id: string): number => nodeRadius(props.current.deg.get(id) ?? 0, id === props.current.center, props.current.nodes.length);
    const colors = (): Colors => {
      const now = Date.now();
      if (s.colors && now - s.colors.at < 400) return s.colors;
      const fam = (globalThis as { getComputedStyle?: (e: Element) => { fontFamily: string } }).getComputedStyle?.(host).fontFamily || "sans-serif";
      return (s.colors = { ink: token(host, "--ink", "#222"), ink2: token(host, "--ink-2", "#555"), ink3: token(host, "--ink-3", "#777"), ink4: token(host, "--ink-4", "#aaa"), line: token(host, "--line", "#ccc"), win: token(host, "--win", "#fff"), accent: token(host, "--accent", "#5b50e8"), font: fam, at: now });
    };
    const grid = (): HitGrid => (s.grid ??= buildGrid(props.current.nodes, props.current.edges, at, s.cam, radius, s.w, s.h));
    const ask = (): void => { if (!s.raf) s.raf = requestAnimationFrame(() => { s.raf = 0; draw.current(); }); };
    schedule.current = ask;

    const render = (): void => {
      const P = props.current;
      const ctx = canvas.getContext("2d");
      if (!ctx || s.w === 0) return;
      const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
      if (canvas.width !== Math.round(s.w * dpr) || canvas.height !== Math.round(s.h * dpr)) { canvas.width = Math.round(s.w * dpr); canvas.height = Math.round(s.h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, s.w, s.h);
      if (s.needFit) { s.cam = fitCam({ ...P.pos, ...s.moved }, P.nodes.map((n) => n.nodeId), s.w, s.h); s.needFit = false; s.grid = null; }
      const c = colors(), cam = s.cam, W = s.w, H = s.h;
      const sel = P.sel, selEdge = P.selEdge, focusOn = sel !== null || selEdge !== null;
      const hoverEdge = s.hover && "edge" in s.hover ? s.hover.edge : null, hoverNode = s.hover && "node" in s.hover ? s.hover.node : null;
      const selEnds = selEdge ? selEdge.split(">") : null;

      // the edges in view, as screen coordinates in one reusable array
      if (s.xs.length < P.edges.length * 4) s.xs = new Float64Array(P.edges.length * 4);
      const xs = s.xs, view: number[] = [];
      for (let i = 0; i < P.edges.length; i++) {
        const e = P.edges[i]!, a = at(e.from), b = at(e.to);
        if (!a || !b) continue;
        const x1 = a.x * cam.k + cam.x, y1 = a.y * cam.k + cam.y, x2 = b.x * cam.k + cam.x, y2 = b.y * cam.k + cam.y;
        if ((x1 < -20 && x2 < -20) || (x1 > W + 20 && x2 > W + 20) || (y1 < -20 && y2 < -20) || (y1 > H + 20 && y2 > H + 20)) continue;
        xs[i * 4] = x1; xs[i * 4 + 1] = y1; xs[i * 4 + 2] = x2; xs[i * 4 + 3] = y2;
        view.push(i);
      }
      const inView = new Set<string>();
      let nodesInView = 0;
      for (const n of P.nodes) { const a = at(n.nodeId); if (!a) continue; const x = a.x * cam.k + cam.x, y = a.y * cam.k + cam.y; if (x > -30 && y > -30 && x < W + 30 && y < H + 30) { inView.add(n.nodeId); nodesInView += 1; } }
      const plan = labelPlan(view.length, nodesInView);

      // edges: quiet ones in one stroke, dimmed ones in another, the lit ones one by one
      const quiet: number[] = [], dimmed: number[] = [], hot: number[] = [];
      for (const i of view) {
        const e = P.edges[i]!, key = edgeKey(e);
        const isHot = key === selEdge || (sel !== null && (e.from === sel || e.to === sel));
        (isHot ? hot : focusOn ? dimmed : quiet).push(i);
      }
      ctx.lineCap = "round";
      const strokeBatch = (list: number[], color: string, alpha: number, width: number): void => {
        if (list.length === 0) return;
        ctx.beginPath();
        for (const i of list) { ctx.moveTo(xs[i * 4]!, xs[i * 4 + 1]!); ctx.lineTo(xs[i * 4 + 2]!, xs[i * 4 + 3]!); }
        ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
      };
      strokeBatch(quiet, c.ink4, quiet.length > 1500 ? 0.35 : 0.55, 1.1);
      strokeBatch(dimmed, c.ink4, 0.14, 1);
      for (const i of hot) { const key = edgeKey(P.edges[i]!); strokeBatch([i], c.accent, 1, key === selEdge ? 2.2 : 1.8); }
      if (hoverEdge) { const i = view.find((j) => edgeKey(P.edges[j]!) === hoverEdge); if (i !== undefined && hoverEdge !== selEdge) strokeBatch([i], c.ink2, 0.9, 1.8); }
      ctx.globalAlpha = 1;

      // edge labels: dim until the edge or one of its nodes is hovered or selected; none when zoomed out far
      const labelOf = (i: number, color: string, alpha: number, bold: boolean): void => {
        const e = P.edges[i]!;
        if (!e.label) return;
        const x1 = xs[i * 4]!, y1 = xs[i * 4 + 1]!, x2 = xs[i * 4 + 2]!, y2 = xs[i * 4 + 3]!;
        const need = e.label.length * 5.6 + 14;
        if (!bold && Math.hypot(x2 - x1, y2 - y1) < need) return;
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 5;
        ctx.font = `${bold ? 600 : 400} 10.5px ${c.font}`; ctx.textAlign = "center"; ctx.lineJoin = "round";
        ctx.globalAlpha = 1; ctx.lineWidth = 3.5; ctx.strokeStyle = c.win; ctx.strokeText(e.label, mx, my);
        ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fillText(e.label, mx, my);
        ctx.globalAlpha = 1;
      };
      if (plan.edges) {
        for (const i of quiet) { const e = P.edges[i]!, k = edgeKey(e), near = hoverNode !== null && (e.from === hoverNode || e.to === hoverNode); if (k === hoverEdge || near) labelOf(i, c.ink, 1, false); else if (P.labelsAll) labelOf(i, c.ink3, 0.62, false); }
        if (P.labelsAll) for (const i of dimmed) labelOf(i, c.ink3, 0.22, false);
      }
      for (const i of hot) labelOf(i, c.accent, 1, true);
      if (hoverEdge && hoverEdge !== selEdge) { const i = view.find((j) => edgeKey(P.edges[j]!) === hoverEdge); if (i !== undefined) labelOf(i, c.ink, 1, true); }

      // nodes: one path per kind and dim state
      const dimOf = (id: string): boolean => {
        if (selEnds) return !selEnds.includes(id);
        if (s.near) return !s.near.has(id);
        return P.lit.size > 0 && !P.lit.has(id);
      };
      const groups = new Map<string, { x: number; y: number; r: number }[]>();
      for (const n of P.nodes) {
        if (!inView.has(n.nodeId)) continue;
        const a = at(n.nodeId)!, d = dimOf(n.nodeId);
        const key = `${d ? 1 : 0}${n.kind}`;
        const item = { x: a.x * cam.k + cam.x, y: a.y * cam.k + cam.y, r: radius(n.nodeId) };
        const list = groups.get(key);
        if (list) list.push(item); else groups.set(key, [item]);
      }
      const rr = (ctx as unknown as { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect;
      for (const pass of [1, 0]) for (const [key, list] of groups) {
        if (key[0] !== String(pass)) continue;
        const kind = key.slice(1) as KGNode["kind"];
        ctx.beginPath();
        for (const q of list) {
          if (kind === "chat") { if (rr) rr.call(ctx, q.x - q.r, q.y - q.r * 0.82, q.r * 2, q.r * 1.64, 4); else ctx.rect(q.x - q.r, q.y - q.r * 0.82, q.r * 2, q.r * 1.64); }
          else { ctx.moveTo(q.x + q.r, q.y); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); }
        }
        ctx.globalAlpha = pass === 1 ? 0.22 : 1; ctx.fillStyle = kindHex(kind); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // rings and names
      const ringAt = (id: string, extra: number, color: string, width: number, alpha = 1): void => {
        const a = at(id); if (!a) return;
        ctx.beginPath(); ctx.arc(a.x * cam.k + cam.x, a.y * cam.k + cam.y, radius(id) + extra, 0, Math.PI * 2); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); ctx.globalAlpha = 1;
      };
      if (P.center && inView.has(P.center)) ringAt(P.center, 6, c.accent, 1.5, 0.55);
      if (sel && inView.has(sel)) ringAt(sel, 5, c.accent, 2);
      if (hoverNode && hoverNode !== sel) ringAt(hoverNode, 3, c.ink3, 1.5, 0.8);
      for (const id of P.lit) if (inView.has(id)) ringAt(id, 4, c.accent, 1.5, 0.9);
      ctx.textAlign = "center"; ctx.lineJoin = "round";
      for (const n of P.nodes) {
        const id = n.nodeId;
        if (!inView.has(id)) continue;
        const named = plan.nodes || s.hubs.has(id) || id === P.center || id === sel || id === hoverNode || P.lit.has(id) || (s.near?.has(id) ?? false) || (selEnds?.includes(id) ?? false);
        if (!named) continue;
        const a = at(id)!, x = a.x * cam.k + cam.x, y = a.y * cam.k + cam.y + radius(id) + 13, dim = dimOf(id) && id !== hoverNode;
        const big = id === P.center || id === sel || id === hoverNode;
        ctx.font = `${big ? 600 : 500} 11.5px ${c.font}`;
        ctx.globalAlpha = 1; ctx.lineWidth = 3.5; ctx.strokeStyle = c.win; ctx.strokeText(n.title, x, y);
        ctx.globalAlpha = dim ? 0.3 : 1; ctx.fillStyle = big ? c.ink : c.ink2; ctx.fillText(n.title, x, y);
        ctx.globalAlpha = 1;
      }
    };
    draw.current = render;

    const size = (): void => {
      const r = host.getBoundingClientRect();
      if (r.width === s.w && r.height === s.h) return;
      const first = s.w === 0;
      s.w = r.width; s.h = r.height; s.grid = null;
      if (first) s.needFit = true;
      ask();
    };
    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    const ro = RO ? new RO(size) : null;
    ro?.observe(host);
    size();

    const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      const q = local(e), hit = hitAt(grid(), q.x, q.y);
      s.drag = { mode: hit && "node" in hit ? "node" : "pan", id: hit && "node" in hit ? hit.node : "", sx: q.x, sy: q.y, cam: s.cam, moved: false, hit };
      canvas.setPointerCapture?.(e.pointerId);
      host.focus({ preventScroll: true });
    };
    const move = (e: PointerEvent): void => {
      const q = local(e), d = s.drag;
      if (d) {
        const dx = q.x - d.sx, dy = q.y - d.sy;
        if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true;
        if (d.moved) {
          if (d.mode === "node") s.moved = { ...s.moved, [d.id]: toWorld(s.cam, q.x, q.y) }; else s.cam = panBy(d.cam, dx, dy);
          s.grid = null; ask();
        }
        return;
      }
      const hit = hitAt(grid(), q.x, q.y);
      const same = (hit === null && s.hover === null) || (hit !== null && s.hover !== null && JSON.stringify(hit) === JSON.stringify(s.hover));
      if (!same) { s.hover = hit; canvas.style.cursor = hit ? "pointer" : "default"; ask(); }
    };
    const up = (e: PointerEvent): void => {
      const d = s.drag;
      s.drag = null;
      canvas.releasePointerCapture?.(e.pointerId);
      if (!d) return;
      const P = props.current;
      if (d.moved) {
        if (d.mode === "node") { const w = s.moved[d.id]; if (w) P.onDrop(d.id, { x: Math.round(w.x), y: Math.round(w.y) }); }
        return;
      }
      if (d.hit && "node" in d.hit) P.onSelectNode(d.hit.node);
      else if (d.hit && "edge" in d.hit) P.onSelectEdge(d.hit.edge);
      else P.onClear();
    };
    const dbl = (e: MouseEvent): void => { const q = local(e), hit = hitAt(grid(), q.x, q.y); if (hit && "node" in hit) props.current.onOpen(hit.node); };
    // the menu comes from ui/Menu's own trigger (right-click, long press, the menu key); its handlers are put on the canvas under the DOM event they are named for
    const trigger = menuTrigger((x, y) => {
      const q = local({ clientX: x, clientY: y }), hit = hitAt(grid(), q.x, q.y);
      props.current.onMenu(hit && "node" in hit ? { kind: "node", id: hit.node, x, y } : hit ? { kind: "edge", id: hit.edge, x, y } : { kind: "bg", x, y });
    });
    const triggers = Object.entries(trigger).filter(([k, f]) => k !== "onKeyDown" && k !== "onLongPress" && typeof f === "function").map(([k, f]) => [k.slice(2).toLowerCase(), f as EventListener] as const);
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      const q = local(e);
      s.cam = zoomAt(s.cam, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), q.x, q.y);
      s.grid = null; ask();
    };
    const leave = (): void => { if (s.hover && !s.drag) { s.hover = null; canvas.style.cursor = "default"; ask(); } };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("dblclick", dbl);
    for (const [name, f] of triggers) canvas.addEventListener(name, f);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      ro?.disconnect();
      if (s.raf) cancelAnimationFrame(s.raf);
      s.raf = 0;
      canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("dblclick", dbl); for (const [name, f] of triggers) canvas.removeEventListener(name, f); canvas.removeEventListener("wheel", wheel);
    };
  }, []);

  // a new picture: the grid is stale, a dropped node's own position is now in `pos`, the hubs are counted again, a new fitKey fits the camera
  useEffect(() => {
    const s = live.current;
    s.grid = null;
    s.moved = {};
    s.hubs = new Set([...p.nodes].sort((a, b) => (p.deg.get(b.nodeId) ?? 0) - (p.deg.get(a.nodeId) ?? 0) || a.title.localeCompare(b.title)).slice(0, HUBS).filter((n) => (p.deg.get(n.nodeId) ?? 0) > 0).map((n) => n.nodeId));
    if (s.fitKey !== p.fitKey) { s.fitKey = p.fitKey; s.needFit = true; }
    schedule.current();
  }, [p.nodes, p.edges, p.pos, p.deg, p.fitKey]);

  // selection and search: only a repaint (the neighbours of the selected node keep their names)
  useEffect(() => {
    live.current.near = p.sel ? neighborsOf(p.sel, p.edges) : null;
    schedule.current();
  }, [p.sel, p.selEdge, p.lit, p.center, p.edges]);

  // zoom buttons, keys, focus
  useEffect(() => {
    const s = live.current, c = p.command;
    if (!c || s.command === c.id) return;
    s.command = c.id;
    if (c.kind === "in") s.cam = zoomAt(s.cam, 1.25, s.w / 2, s.h / 2);
    else if (c.kind === "out") s.cam = zoomAt(s.cam, 1 / 1.25, s.w / 2, s.h / 2);
    else if (c.kind === "fit") s.needFit = true;
    else if (c.kind === "pan") s.cam = panBy(s.cam, c.dx ?? 0, c.dy ?? 0);
    else if (c.node) { const a = p.pos[c.node]; if (a) s.cam = centreOn(s.cam, s.moved[c.node] ?? a, s.w, s.h, 0.7); }
    s.grid = null;
    schedule.current();
  }, [p.command, p.pos]);

  if (Platform.OS !== "web") return null;
  const near = p.sel ? neighborsOf(p.sel, p.edges) : null;
  // the canvas cannot be read by a screen reader, so the same nodes and links are lists beside it
  const options: ReactElement[] = [];
  for (const n of p.nodes) {
    options.push(createElement("div", {
      key: n.nodeId, role: "option", tabIndex: -1, "aria-selected": p.sel === n.nodeId, "aria-label": `${n.title}, ${KIND_LABEL[n.kind]}, ${p.deg.get(n.nodeId) ?? 0} links`, "data-testid": `gnode-${n.nodeId}`, "data-kind": n.kind,
      "data-linked": near !== null && near.has(n.nodeId) && p.sel !== n.nodeId ? "true" : "false", "data-lit": p.lit.has(n.nodeId) ? "true" : "false",
      onClick: () => p.onSelectNode(n.nodeId), onDoubleClick: () => p.onOpen(n.nodeId),
    }, n.title));
  }
  const titles = new Map<string, string>();
  for (const n of p.nodes) titles.set(n.nodeId, n.title);
  const links: ReactElement[] = [];
  for (const e of p.edges) {
    const key = edgeKey(e);
    if (links.length >= LIST_EDGES && key !== p.selEdge) continue;
    links.push(createElement("div", {
      key, role: "option", tabIndex: -1, "aria-selected": p.selEdge === key, "aria-label": `${titles.get(e.from) ?? e.from} ${e.label ?? "links to"} ${titles.get(e.to) ?? e.to}`, "data-testid": `gedge-${key}`,
      onClick: () => p.onSelectEdge(key),
    }, e.label ?? ""));
  }
  const hidden = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;
  return createElement(
    "div",
    { style: { position: "absolute", inset: 0 } },
    createElement(
      "div",
      { ref: (n: HTMLDivElement | null) => { box.current = n; }, tabIndex: 0, role: "application", "aria-label": "Knowledge graph. Tab walks the nodes, Enter opens one, plus and minus zoom, the arrow keys pan.", "data-testid": "graph-surface", onKeyDown: p.onKey, style: { position: "absolute", inset: 0, outline: "none" } },
      createElement("canvas", { ref: (n: HTMLCanvasElement | null) => { cv.current = n; }, "data-testid": "graph-canvas", style: { position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" } }),
    ),
    createElement("div", { role: "listbox", "aria-label": "Nodes in the graph", "data-testid": "graph-notes", style: hidden }, ...options),
    createElement("div", { role: "listbox", "aria-label": "Links in the graph", "data-testid": "graph-links", style: hidden }, ...links),
  );
}
