// Memory graph and proposed facts: the pure part. The notes, people, projects and chats a graph draws (never a personal layer), the layers and kinds that filter it, the time slider, a layout that
// is the same every time, the view (pan and zoom), what a pointer hits, and the proposed facts waiting for Accept or Reject. No React and no clock; every rule here is tested without a renderer.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { KnowRoute } from "./know.ts";

export type GraphOut = CapMap["memory.graph"]["out"];
export type GNode = GraphOut["nodes"][number];
export type GEdge = GraphOut["edges"][number];
export type Fact = CapMap["memory.facts.list"]["out"]["facts"][number];
export type NoteRow = CapMap["memory.notes.list"]["out"]["notes"][number];
export type Layer = Fact["layer"];
export type Kind = GNode["kind"];
export type Positions = Record<string, { x: number; y: number }>;

// ---------------------------------------------------------------- kinds and layers

/** The kinds in the order the Types menu and the legend list them. */
export const KINDS: readonly Kind[] = ["person", "client", "project", "topic", "agent", "record", "chat", "note", "decision", "site"];
export const KIND_LABEL: Record<Kind, string> = { person: "People", client: "Clients", project: "Projects", topic: "Topics", agent: "Agents", record: "Records", chat: "Chats", note: "Notes", decision: "Decisions", site: "Sites" };
/** One colour per kind, the same in every Space and every skin (a hue; the skin sets the lightness). Chats are a quiet grey-green so they sit behind the people and projects they are about. */
/** "Person", "Client", "Chat": one of a kind, as the card of a node says it. */
export const kindOne = (k: Kind): string => (k === "person" ? "Person" : KIND_LABEL[k].replace(/s$/, ""));
export const KIND_HUE: Record<Kind, number> = { person: 36, client: 340, project: 245, topic: 280, agent: 170, record: 212, chat: 150, note: 110, decision: 14, site: 190 };
const KIND_SAT: Partial<Record<Kind, number>> = { chat: 16 };
export const kindColor = (k: Kind): string => `hsl(${KIND_HUE[k]}, ${KIND_SAT[k] ?? 62}%, ${k === "chat" ? 60 : 58}%)`;
/** The same colour as #rrggbb, for a canvas. */
export const kindHex = (k: Kind): string => hslHex(KIND_HUE[k], KIND_SAT[k] ?? 62, k === "chat" ? 60 : 58);

/** The layers a graph can show. Personal layers are private and are never in a graph, an export or the admin view. */
export const GRAPH_LAYERS: readonly Exclude<Layer, "person">[] = ["agent", "project", "space"];
export const LAYER_LABEL: Record<Layer, string> = { person: "Personal", agent: "Agent", project: "Project", space: "Space" };

export interface GraphFilter { layers: ReadonlySet<string>; kinds: ReadonlySet<string>; q: string }
export const ALL_LAYERS: GraphFilter["layers"] = new Set(GRAPH_LAYERS);
export const NO_FILTER: GraphFilter = { layers: ALL_LAYERS, kinds: new Set(), q: "" };

export function toggled(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

/** A press on a type (a legend row or a menu row): from "all on" it turns that one off, otherwise it flips it (taking the last one off leaves the set empty, which is every type on). */
export function toggleKindSet(kinds: ReadonlySet<string>, k: Kind): Set<string> {
  if (kinds.size === 0) return new Set(KINDS.filter((x) => x !== k));
  return toggled(kinds, k);
}

/** A node is drawn when it is not personal, its layer is on (a node with no layer is the Space's), its kind is on (none chosen means all). */
export function visibleNode(n: GNode, f: GraphFilter): boolean {
  if (n.layer === "person") return false;
  if (!f.layers.has(n.layer ?? "space")) return false;
  return f.kinds.size === 0 || f.kinds.has(n.kind);
}

export interface Shown { nodes: GNode[]; edges: GEdge[]; hidden: number }

/** The nodes and the edges between them that the filter lets through; `hidden` counts what it took out (not counting personal nodes, which no one is told about). */
export function shown(g: GraphOut, f: GraphFilter): Shown {
  const nodes = g.nodes.filter((n) => visibleNode(n, f));
  const ids = new Set(nodes.map((n) => n.nodeId));
  const edges = g.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  return { nodes, edges, hidden: g.nodes.filter((n) => n.layer !== "person").length - nodes.length };
}

/** Nodes whose title has the text in it, in the order they are drawn. Empty text matches nothing (the search is lit, not a filter). */
export function matches(nodes: readonly GNode[], q: string): Set<string> {
  const t = q.trim().toLowerCase();
  const out = new Set<string>();
  if (t === "") return out;
  for (const n of nodes) if (n.title.toLowerCase().includes(t)) out.add(n.nodeId);
  return out;
}

// ---------------------------------------------------------------- time

export const DAY = 86_400_000;
export const SLIDER_DAYS = 30;

/** The time slider: 0 is thirty days ago and SLIDER_DAYS is now. Now is `undefined`, so the graph asks for the live copy and says nothing about a date. */
export function asOfOf(step: number, now: number): number | undefined {
  if (step >= SLIDER_DAYS) return undefined;
  const day = Math.floor(now / DAY) * DAY;
  return day + (Math.max(0, step) - SLIDER_DAYS + 1) * DAY - 1;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export function dayText(ms: number): string {
  const d = new Date(ms);
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Now", or the day the slider is on. */
export function sliderText(step: number, now: number): string {
  const at = asOfOf(step, now);
  return at === undefined ? "Now" : dayText(at);
}

// ---------------------------------------------------------------- layout

export const WORLD = 1000;
const LAYOUT_MAX = 400;

function seed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/**
 * Where each node sits: the position the server or the person saved, else a force layout that is the same every time (nodes start on a ring by a hash of their id, hubs of the same cluster
 * pull together, linked nodes attract, all repel). Past 400 nodes the start ring is kept as it is, so a huge graph still opens at once.
 */
export function layout(nodes: readonly GNode[], edges: readonly GEdge[], saved: Positions = {}): Positions {
  const out: Positions = {};
  const free: GNode[] = [];
  for (const n of nodes) {
    const p = saved[n.nodeId] ?? (n.x !== undefined && n.y !== undefined ? { x: n.x, y: n.y } : undefined);
    if (p) out[n.nodeId] = { x: p.x, y: p.y }; else free.push(n);
  }
  if (free.length === 0) return out;
  const clusters = [...new Set(nodes.map((n) => n.cluster ?? ""))].sort();
  const pos = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  for (const n of free) {
    const s = seed(n.nodeId);
    const c = clusters.indexOf(n.cluster ?? "");
    const ang = (c / Math.max(1, clusters.length)) * Math.PI * 2 + ((s % 1000) / 1000) * 0.9;
    const rad = 220 + ((s >>> 10) % 260);
    pos.set(n.nodeId, { x: WORLD / 2 + Math.cos(ang) * rad, y: WORLD / 2 + Math.sin(ang) * rad, vx: 0, vy: 0 });
  }
  if (free.length <= LAYOUT_MAX) {
    const fixed = (id: string): { x: number; y: number } | undefined => pos.get(id) ?? out[id];
    for (let step = 0; step < 90; step++) {
      const cool = 1 - step / 90;
      for (let i = 0; i < free.length; i++) {
        const a = pos.get(free[i]!.nodeId)!;
        for (let j = i + 1; j < free.length; j++) {
          const b = pos.get(free[j]!.nodeId)!;
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = (i % 2 ? 1 : -1); dy = (j % 2 ? 1 : -1); d2 = 2; }
          const f = (2600 / d2) * cool;
          const d = Math.sqrt(d2);
          a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
        }
        a.vx += (WORLD / 2 - a.x) * 0.002; a.vy += (WORLD / 2 - a.y) * 0.002;
      }
      for (const e of edges) {
        const a = fixed(e.from), b = fixed(e.to);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const f = (d - 110) * 0.012 * cool;
        const pa = pos.get(e.from), pb = pos.get(e.to);
        if (pa) { pa.vx += (dx / d) * f; pa.vy += (dy / d) * f; }
        if (pb) { pb.vx -= (dx / d) * f; pb.vy -= (dy / d) * f; }
      }
      for (const p of pos.values()) { p.x += Math.max(-24, Math.min(24, p.vx)); p.y += Math.max(-24, Math.min(24, p.vy)); p.vx *= 0.55; p.vy *= 0.55; }
    }
  }
  for (const [id, p] of pos) out[id] = { x: Math.round(p.x), y: Math.round(p.y) };
  return out;
}


/** Hops from a subject to every node it reaches along the edges (the subject is 0). */
export function hopsFrom(center: string, edges: readonly GEdge[], max = HOPS): Map<string, number> {
  const out = new Map<string, number>([[center, 0]]);
  let front = [center];
  for (let h = 1; h <= max; h++) {
    const next: string[] = [];
    for (const e of edges) for (const [a, b] of [[e.from, e.to], [e.to, e.from]] as const) if (front.includes(a) && !out.has(b)) { out.set(b, h); next.push(b); }
    front = next;
  }
  return out;
}

/**
 * The layout of a graph of up to a hundred or so nodes. Around a subject: the subject in the middle at (WORLD/2, WORLD/2), what it links to on a ring around it, what those link to on a wider one, then a relaxation (nodes push
 * apart, links pull to a length, the subject stays put). With no subject (the Whole Space) the nodes start scattered and relax the same way. The same every time for the same graph. Quadratic, so past 150 nodes the caller uses `layout` instead.
 */
export function layoutAround(nodes: readonly GNode[], edges: readonly GEdge[], center: string | null): Positions {
  const hop = center ? hopsFrom(center, edges) : new Map<string, number>();
  let s = seed(center ?? "whole space") | 0;
  const rnd = (): number => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ids = nodes.map((n) => n.nodeId);
  const P: Record<string, { x: number; y: number; vx: number; vy: number }> = {};
  for (const id of ids) {
    const h = hop.get(id) ?? HOPS + 1, a = rnd() * Math.PI * 2, r = center ? h * 1.15 + (rnd() - 0.5) * 0.3 : 1 + rnd() * 2.6;
    P[id] = id === center ? { x: 0, y: 0, vx: 0, vy: 0 } : { x: Math.cos(a) * r, y: Math.sin(a) * r * (center ? 0.78 : 1), vx: 0, vy: 0 };
  }
  const ed = edges.filter((e) => P[e.from] && P[e.to]);
  for (let it = 0; it < 360; it++) {
    const al = 1 - it / 360;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = P[ids[i]!]!, b = P[ids[j]!]!;
      let dx = a.x - b.x, dy = a.y - b.y;
      const d2 = dx * dx + dy * dy + 0.02, d = Math.sqrt(d2), f = ((center ? 0.5 : 0.42) / d2) * (0.3 + al);
      dx /= d; dy /= d;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    for (const e of ed) {
      const a = P[e.from]!, b = P[e.to]!;
      let dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.001, f = (d - (center ? 1.15 : 1)) * 0.08;
      dx /= d; dy /= d;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    for (const id of ids) { const p = P[id]!; p.vx -= p.x * 0.01; p.vy -= p.y * 0.01; p.vx *= 0.78; p.vy *= 0.78; if (id === center) { p.x = 0; p.y = 0; p.vx = p.vy = 0; } else { p.x += p.vx; p.y += p.vy; } }
  }
  const out: Positions = {};
  for (const id of ids) out[id] = { x: Math.round(WORLD / 2 + P[id]!.x * 130), y: Math.round(WORLD / 2 + P[id]!.y * 130) };
  return out;
}

// ---------------------------------------------------------------- nodes

export const NODE_R = 7;
/** A node's radius: bigger for a hub, up to twice the base. */
export function radiusOf(degree: number): number {
  return NODE_R + Math.min(NODE_R, Math.sqrt(degree) * 1.6);
}

/** A hue, saturation and lightness (0 to 360, 0 to 100, 0 to 100) as #rrggbb, for the WebGL surface, which does not read CSS colours. */
export function hslHex(h: number, s: number, l: number): string {
  const sat = s / 100, light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const c = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function degrees(edges: readonly GEdge[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of edges) { out.set(e.from, (out.get(e.from) ?? 0) + 1); out.set(e.to, (out.get(e.to) ?? 0) + 1); }
  return out;
}

export function neighborsOf(id: string, edges: readonly GEdge[]): Set<string> {
  const out = new Set<string>([id]);
  for (const e of edges) { if (e.from === id) out.add(e.to); else if (e.to === id) out.add(e.from); }
  return out;
}

/** Tab walks the nodes left to right, then top to bottom. */
export function tabOrder(nodes: readonly GNode[], pos: Positions): string[] {
  return nodes.filter((n) => pos[n.nodeId]).sort((a, b) => pos[a.nodeId]!.x - pos[b.nodeId]!.x || pos[a.nodeId]!.y - pos[b.nodeId]!.y).map((n) => n.nodeId);
}

export interface Cluster { name: string; hub: string; size: number }

/** The clusters of what is drawn, named after their hub (the node with the most links in it), biggest first. Counted here, from the nodes that are shown, so a hidden layer never leaks into a count. */
export function clustersOf(nodes: readonly GNode[], edges: readonly GEdge[]): Cluster[] {
  const deg = degrees(edges);
  const by = new Map<string, GNode[]>();
  for (const n of nodes) {
    const k = n.cluster ?? "";
    const list = by.get(k);
    if (list) list.push(n); else by.set(k, [n]);
  }
  const out: Cluster[] = [];
  for (const [name, list] of by) {
    const hub = list.slice().sort((a, b) => (deg.get(b.nodeId) ?? 0) - (deg.get(a.nodeId) ?? 0) || a.title.localeCompare(b.title))[0]!;
    out.push({ name: name === "" ? hub.title : name, hub: hub.nodeId, size: list.length });
  }
  return out.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
}

export function statText(s: Shown, clusters: readonly Cluster[]): string {
  const n = s.nodes.length, e = s.edges.length;
  return `${n} ${n === 1 ? "note" : "notes"}, ${e} ${e === 1 ? "link" : "links"}${clusters.length ? `, ${clusters.length} ${clusters.length === 1 ? "cluster" : "clusters"}` : ""}`;
}

// ---------------------------------------------------------------- the knowledge graph: typed nodes, labelled edges, evidence, the camera and what a pointer hits

/** Where an edge's words were said (typed here because the generated edge has `evidence` and `at` but not yet the source). */
export interface EdgeSource { title: string; link?: string; kind: "chat" | "channel" | "record" }
export type KGNode = GNode & { pageId?: string };
export type KGEdge = GEdge & { source?: EdgeSource };

/** How far around a subject the graph reaches. */
export const HOPS = 2;

/** An edge is named by its two ends; the route and the selection carry this key. */
export const edgeKey = (e: { from: string; to: string }): string => `${e.from}>${e.to}`;
export const edgeByKey = <E extends { from: string; to: string }>(edges: readonly E[], key: string | null | undefined): E | undefined => (key ? edges.find((e) => edgeKey(e) === key) : undefined);

/** The page a node opens: its own `pageId`, else its node id when that is a page the Space has. A chat or a bare record has none. */
export function pageOf(n: KGNode, pageIds: ReadonlySet<string>): string | undefined {
  return n.pageId ?? (pageIds.has(n.nodeId) ? n.nodeId : undefined);
}

export const firstName = (title: string): string => title.trim().split(/\s+/)[0] ?? title;

/** The page the graph opens on when none is asked for: the person's own page if they have one, else the first page. */
export function startSubject(pages: readonly { pageId: string; title: string; kind: string; ownerRef?: string }[], me?: { id: string; name: string }): string | undefined {
  const own = me ? pages.find((p) => p.kind === "person" && (p.ownerRef === me.id || p.title === me.name)) : undefined;
  return (own ?? pages[0])?.pageId;
}

/** "10 nodes · 13 links · around Ian Brooks, two hops" or "25 nodes · 30 links · the whole Space". */
export function statLine(nodes: number, edges: number, around: string | null): string {
  return `${nodes} ${nodes === 1 ? "node" : "nodes"} · ${edges} ${edges === 1 ? "link" : "links"} · ${around ? `around ${around}, two hops` : "the whole Space"}`;
}

/** With a filter or a date on, a node left with no link to anything shown is dropped (the subject stays), as the mockup does. */
export function dropOrphans(s: Shown, keep?: string): Shown {
  const used = new Set<string>();
  for (const e of s.edges) { used.add(e.from); used.add(e.to); }
  const nodes = s.nodes.filter((n) => used.has(n.nodeId) || n.nodeId === keep);
  return { nodes, edges: s.edges, hidden: s.hidden + (s.nodes.length - nodes.length) };
}

export function kindCounts(nodes: readonly GNode[]): Map<Kind, number> {
  const out = new Map<Kind, number>();
  for (const n of nodes) if (n.layer !== "person") out.set(n.kind, (out.get(n.kind) ?? 0) + 1);
  return out;
}

/** How many drawn nodes each layer has (a node with no layer is the Space's; personal ones are not counted, nobody is told). */
export function layerCounts(nodes: readonly GNode[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of nodes) { if (n.layer === "person") continue; const l = n.layer ?? "space"; out[l] = (out[l] ?? 0) + 1; }
  return out;
}

/** The line under the stat when a layer or a type is off: what is hidden when that is the shorter list ("Hiding Chats"), else what is shown ("Showing People, Clients"). Empty when nothing is narrowed. */
export function filterBanner(layers: ReadonlySet<string>, kinds: ReadonlySet<string>): string {
  const layersOff = layers.size < GRAPH_LAYERS.length, kindsOff = kinds.size > 0;
  if (!layersOff && !kindsOff) return "";
  const on = [...(layersOff ? LAYER_MENU.filter((l) => layers.has(l)).map((l) => LAYER_LABEL[l]) : []), ...(kindsOff ? KINDS.filter((k) => kinds.has(k)).map((k) => KIND_LABEL[k]) : [])];
  const off = [...(layersOff ? LAYER_MENU.filter((l) => !layers.has(l)).map((l) => LAYER_LABEL[l]) : []), ...(kindsOff ? KINDS.filter((k) => !kinds.has(k)).map((k) => KIND_LABEL[k]) : [])];
  return off.length <= on.length ? `Hiding ${off.join(", ")}` : `Showing ${on.join(", ")}`;
}

/** The order the Layers menu lists them in (Personal is not a row: it is private and never drawn). */
export const LAYER_MENU: readonly Exclude<Layer, "person">[] = ["space", "project", "agent"];

/** The date ticks under the slider: the first of the four is 23 days back, then 16 and 8, then Today (Oct 1, Oct 8, Oct 16, Today on Oct 24). `step` is where each sits on the 0 to 30 range. */
export function sliderTicks(now: number): { label: string; step: number }[] {
  const day = Math.floor(now / DAY) * DAY;
  return [23, 16, 8].map((back) => ({ label: dayText(day - back * DAY), step: SLIDER_DAYS - back })).concat([{ label: "Today", step: SLIDER_DAYS }]);
}

/** A node's radius in pixels: a hub is bigger, the subject biggest; a crowd of thousands shrinks them so they stay separate. */
export function nodeRadius(degree: number, center: boolean, crowd = 0): number {
  const base = center ? 12.5 : 7.5 + Math.min(4.5, degree * 0.8);
  return base * (crowd > 300 ? Math.max(0.35, Math.sqrt(300 / crowd)) : 1);
}

// ---------------------------------------------------------------- the camera

/** Screen = world * k + (x, y). */
export interface Cam { x: number; y: number; k: number }
export const ZOOM_MIN = 0.02;
export const ZOOM_MAX = 40;
const clampK = (k: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));

/** The camera that frames the nodes in a w by h box, leaving room for the legend (left), the controls (right), the stat line (top) and the cards (bottom). A narrow box drops the legend's room. */
export function fitCam(pos: Positions, ids: readonly string[], w: number, h: number): Cam {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const id of ids) { const p = pos[id]; if (!p) continue; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  if (!Number.isFinite(x0)) return { x: w / 2, y: h / 2, k: 1 };
  const narrow = w < 760;
  const padL = narrow ? 40 : 190, padR = narrow ? 40 : 90, padT = 60, padB = h < 420 ? 40 : 190;
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  const k = clampK(Math.min(Math.max(40, w - padL - padR) / bw, Math.max(40, h - padT - padB) / bh, 2.4));
  return { k, x: padL + (Math.max(40, w - padL - padR) - bw * k) / 2 - x0 * k, y: padT + (Math.max(40, h - padT - padB) - bh * k) / 2 - y0 * k };
}

/** Zooms by a factor about a screen point, which stays under the pointer. */
export function zoomAt(c: Cam, f: number, px: number, py: number): Cam {
  const k = clampK(c.k * f), q = k / c.k;
  return { k, x: px - (px - c.x) * q, y: py - (py - c.y) * q };
}

export const panBy = (c: Cam, dx: number, dy: number): Cam => ({ ...c, x: c.x + dx, y: c.y + dy });
/** The camera centred on a world point at a zoom no lower than `k`. */
export const centreOn = (c: Cam, p: { x: number; y: number }, w: number, h: number, k = 0): Cam => { const kk = clampK(Math.max(c.k, k)); return { k: kk, x: w / 2 - p.x * kk, y: h / 2 - p.y * kk }; };
export const toScreen = (c: Cam, p: { x: number; y: number }): { x: number; y: number } => ({ x: p.x * c.k + c.x, y: p.y * c.k + c.y });
export const toWorld = (c: Cam, x: number, y: number): { x: number; y: number } => ({ x: (x - c.x) / c.k, y: (y - c.y) / c.k });

// ---------------------------------------------------------------- labels

/** Edge labels need room: past this many edges in view they are left off, so thousands of links stay fast and readable; zoom in and they return. */
export const EDGE_LABELS_MAX = 400;
/** Every node keeps its name up to this many in view; past it only the hubs, the selected one and its neighbours do. */
export const NODE_LABELS_MAX = 160;
export function labelPlan(edgesInView: number, nodesInView: number): { edges: boolean; nodes: boolean } {
  return { edges: edgesInView <= EDGE_LABELS_MAX, nodes: nodesInView <= NODE_LABELS_MAX };
}

// ---------------------------------------------------------------- what a pointer hits

/** The distance from a point to a segment. */
export function segDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Liang-Barsky: the part of a segment inside a box, or null when none of it is. */
export function clipSeg(x1: number, y1: number, x2: number, y2: number, bx0: number, by0: number, bx1: number, by1: number): [number, number, number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy], q = [x1 - bx0, bx1 - x1, y1 - by0, by1 - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i]! < 0) return null; continue; }
    const r = q[i]! / p[i]!;
    if (p[i]! < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
}

interface GridPoint { id: string; x: number; y: number; r: number }
interface GridSeg { id: string; x1: number; y1: number; x2: number; y2: number }

/**
 * A spatial grid over screen space: nodes go in the cell of their centre, edges in every cell they cross (the part inside the box only), so a pointer asks three by three cells rather than every
 * node and edge. Built once per picture and camera; asking is O(1) however many thousands there are.
 */
export class HitGrid {
  private readonly points = new Map<number, GridPoint[]>();
  private readonly segs = new Map<number, GridSeg[]>();
  readonly cell: number;
  private readonly box: [number, number, number, number];
  constructor(cell = 48, box: [number, number, number, number] = [-100, -100, 4000, 4000]) { this.cell = cell; this.box = box; }
  private key(cx: number, cy: number): number { return (cx + 32768) * 65536 + (cy + 32768); }
  addPoint(id: string, x: number, y: number, r: number): void {
    const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    const list = this.points.get(k);
    const pt = { id, x, y, r };
    if (list) list.push(pt); else this.points.set(k, [pt]);
  }
  addSeg(id: string, x1: number, y1: number, x2: number, y2: number): void {
    const c = clipSeg(x1, y1, x2, y2, this.box[0], this.box[1], this.box[2], this.box[3]);
    if (!c) return;
    const seg = { id, x1, y1, x2, y2 };
    const len = Math.hypot(c[2] - c[0], c[3] - c[1]);
    const steps = Math.max(1, Math.ceil(len / (this.cell / 2)));
    let last = -1;
    for (let i = 0; i <= steps; i++) {
      const x = c[0] + ((c[2] - c[0]) * i) / steps, y = c[1] + ((c[3] - c[1]) * i) / steps;
      const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
      if (k === last) continue;
      last = k;
      const list = this.segs.get(k);
      if (list) list.push(seg); else this.segs.set(k, [seg]);
    }
  }
  /** The node under (x, y) within `slop` extra pixels, the nearest when several. */
  nodeAt(x: number, y: number, slop = 3): string | null {
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    let best: string | null = null, bd = Infinity;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const p of this.points.get(this.key(cx + i, cy + j)) ?? []) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= p.r + slop && d < bd) { bd = d; best = p.id; }
    }
    return best;
  }
  /** The edge within `tol` pixels of (x, y), the nearest when several. */
  edgeAt(x: number, y: number, tol = 5): string | null {
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    let best: string | null = null, bd = Infinity;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of this.segs.get(this.key(cx + i, cy + j)) ?? []) {
      const d = segDistance(x, y, s.x1, s.y1, s.x2, s.y2);
      if (d <= tol && d < bd) { bd = d; best = s.id; }
    }
    return best;
  }
}

/** The thing at a pointer: a node first (it sits on top), else an edge, else the background. */
export function hitAt(g: HitGrid, x: number, y: number): { node: string } | { edge: string } | null {
  const n = g.nodeAt(x, y);
  if (n) return { node: n };
  const e = g.edgeAt(x, y);
  return e ? { edge: e } : null;
}

/** The graph as the screen draws it: a grid built from where the camera puts every node and edge. */
export function buildGrid(nodes: readonly KGNode[], edges: readonly KGEdge[], at: (id: string) => { x: number; y: number } | undefined, cam: Cam, radius: (id: string) => number, w: number, h: number): HitGrid {
  const g = new HitGrid(48, [-60, -60, w + 60, h + 60]);
  for (const n of nodes) { const p = at(n.nodeId); if (!p) continue; const s = toScreen(cam, p); if (s.x > -40 && s.y > -40 && s.x < w + 40 && s.y < h + 40) g.addPoint(n.nodeId, s.x, s.y, radius(n.nodeId)); }
  for (const e of edges) { const a = at(e.from), b = at(e.to); if (!a || !b) continue; const sa = toScreen(cam, a), sb = toScreen(cam, b); g.addSeg(edgeKey(e), sa.x, sa.y, sb.x, sb.y); }
  return g;
}


// ---------------------------------------------------------------- the route, the keys and the menus (pure, so each is tested without a renderer)

/** The route that names a graph: `focus` is the subject (a page id), `around` picks "Around <subject>" or "Whole Space", `edge` is the selected edge. */
export function graphRoute(focus: string | undefined, around: boolean, edge: string | null): KnowRoute {
  return { v: "graph", ...(focus ? { focus } : {}), scope: around ? "around" : "space", ...(edge ? { edge } : {}) };
}

/** The pages the subject picker lists for what was typed: the title has the text in it, the first forty. */
export function pickPages<P extends { title: string }>(pages: readonly P[], q: string, limit = 40): P[] {
  const t = q.trim().toLowerCase();
  return pages.filter((p) => t === "" || p.title.toLowerCase().includes(t)).slice(0, limit);
}

export type KeyAction = { k: "tab"; back: boolean } | { k: "open" } | { k: "clear" } | { k: "in" } | { k: "out" } | { k: "fit" } | { k: "pan"; dx: number; dy: number };

/** What a key does on the graph: Tab and Shift-Tab walk the nodes, Enter opens the selected one, Escape closes the card, + - 0 zoom and fit, the arrows pan (the picture moves the way the key points). */
export function keyAction(e: { key: string; shiftKey?: boolean }, hasSelection: boolean): KeyAction | null {
  switch (e.key) {
    case "Tab": return { k: "tab", back: e.shiftKey === true };
    case "Enter": return hasSelection ? { k: "open" } : null;
    case "Escape": return { k: "clear" };
    case "+": case "=": return { k: "in" };
    case "-": return { k: "out" };
    case "0": return { k: "fit" };
    case "ArrowLeft": return { k: "pan", dx: 60, dy: 0 };
    case "ArrowRight": return { k: "pan", dx: -60, dy: 0 };
    case "ArrowUp": return { k: "pan", dx: 0, dy: 60 };
    case "ArrowDown": return { k: "pan", dx: 0, dy: -60 };
    default: return null;
  }
}

/** The node Tab lands on: the next in `order` after the selected one (the first when none is selected), wrapping. */
export function nextTab(order: readonly string[], sel: string | null, back: boolean): string | undefined {
  if (order.length === 0) return undefined;
  const at = sel ? order.indexOf(sel) : -1;
  return order[(at + (back ? -1 : 1) + order.length) % order.length];
}

/** The Layers menu: Space, Project, Agent with a checkmark and a count each, Show all layers, and the note that Personal is private. */
export function layerMenu(layers: ReadonlySet<string>, counts: Record<string, number>, on: { toggle(l: string): void; all(): void }): MenuEntry[] {
  return [
    { head: "Layer" },
    ...LAYER_MENU.map((l): MenuEntry => ({ label: LAYER_LABEL[l], checked: layers.has(l), count: counts[l] ?? 0, onSelect: () => on.toggle(l) })),
    { separator: true },
    { label: "Show all layers", onSelect: on.all },
    { separator: true },
    { head: "Personal is private and never shown" },
  ];
}

/** The Types menu: every kind with a checkmark (none chosen means all are on) and how many nodes it has; Show all types. */
export function typeMenu(kinds: ReadonlySet<string>, counts: ReadonlyMap<Kind, number>, on: { toggle(k: Kind): void; all(): void }): MenuEntry[] {
  return [
    { head: "Show" },
    ...KINDS.map((k): MenuEntry => ({ label: KIND_LABEL[k], checked: kinds.size === 0 || kinds.has(k), count: counts.get(k) ?? 0, onSelect: () => on.toggle(k) })),
    { separator: true },
    { label: "Show all types", onSelect: on.all },
  ];
}

/** Right-click on a node: Open page (a page), Show around this (a page that is not the subject), Open in Chats (a chat), Copy name. */
export function nodeMenu(n: KGNode, o: { page: boolean; subject: boolean }, on: { open(): void; around(): void; chats(): void; copy(): void }): MenuEntry[] {
  return [
    ...(o.page ? [{ label: "Open page", onSelect: on.open } as MenuEntry] : []),
    ...(o.page && !o.subject ? [{ label: "Show around this", onSelect: on.around } as MenuEntry] : []),
    ...(n.kind === "chat" && n.link ? [{ label: "Open in Chats", onSelect: on.chats } as MenuEntry] : []),
    { label: "Copy name", onSelect: on.copy },
  ];
}

/** Right-click on an edge: Show evidence, Copy quote (when it has one). */
export function edgeMenu(e: KGEdge, on: { evidence(): void; copy(): void }): MenuEntry[] {
  return [{ label: "Show evidence", onSelect: on.evidence }, ...(e.evidence ? [{ label: "Copy quote", onSelect: on.copy } as MenuEntry] : [])];
}

/** Right-click on the background: Fit to screen, Show the whole Space or around the subject, Back to now, Show all layers and types. */
export function backgroundMenu(o: { around: boolean; subject: string | null; past: boolean; narrowed: boolean }, on: { fit(): void; scope(): void; now(): void; reset(): void }): MenuEntry[] {
  return [
    { label: "Fit to screen", onSelect: on.fit },
    ...(o.subject ? [{ label: o.around ? "Show the whole Space" : `Show around ${o.subject}`, onSelect: on.scope } as MenuEntry] : []),
    ...(o.past ? [{ label: "Back to now", onSelect: on.now } as MenuEntry] : []),
    ...(o.narrowed ? [{ label: "Show all layers and types", onSelect: on.reset } as MenuEntry] : []),
  ];
}

/** The "..." menu of the header. */
export function moreMenu(o: { past: boolean; narrowed: boolean }, on: { export(): void; fit(): void; now(): void; reset(): void }): MenuEntry[] {
  return [
    { label: "Export graph", onSelect: on.export },
    { label: "Fit to screen", onSelect: on.fit },
    ...(o.narrowed ? [{ label: "Show all layers and types", onSelect: on.reset } as MenuEntry] : []),
    ...(o.past ? [{ label: "Back to now", onSelect: on.now } as MenuEntry] : []),
  ];
}

/** Right-click on a legend row: hide or show that type, show only it, show all. */
export function legendMenu(k: Kind, hidden: boolean, on: { toggle(): void; only(): void; all(): void }): MenuEntry[] {
  return [
    { label: hidden ? `Show ${KIND_LABEL[k]}` : `Hide ${KIND_LABEL[k]}`, onSelect: on.toggle },
    { label: `Show only ${KIND_LABEL[k]}`, onSelect: on.only },
    { label: "Show all types", onSelect: on.all },
  ];
}

// ---------------------------------------------------------------- proposed facts

export const SOURCE_LABEL: Record<Fact["sourceKind"], string> = { chat: "a chat", channel: "a channel", task: "a task", record: "a record", run: "an automation run", journey: "a journey", manual: "a person" };

/** Where an accepted fact lands: the layer it was proposed for. A person's own fact goes to their private layer; channel facts are already the project's. */
export function lands(f: Fact): string {
  return f.layer === "project" ? "the project's memory" : f.layer === "space" ? "the Space's memory" : f.layer === "agent" ? "the agent's memory" : "your own memory";
}

export interface ProposedGroup { layer: Layer; facts: Fact[] }
const ORDER: readonly Layer[] = ["project", "space", "agent", "person"];

/** Facts waiting for a decision, grouped by the layer they would join, newest first inside a group. */
export function proposedGroups(facts: readonly Fact[]): ProposedGroup[] {
  const by = new Map<Layer, Fact[]>();
  for (const f of facts) {
    if (f.status !== "proposed") continue;
    const list = by.get(f.layer);
    if (list) list.push(f); else by.set(f.layer, [f]);
  }
  return ORDER.filter((l) => by.has(l)).map((l) => ({ layer: l, facts: by.get(l)!.slice().sort((a, b) => b.learnedAt - a.learnedAt) }));
}

const AGO = [[86_400_000, "d"], [3_600_000, "h"], [60_000, "min"]] as const;
/** "3 h ago": how long since a fact was learned. */
export function ago(at: number, now: number): string {
  const d = Math.max(0, now - at);
  for (const [ms, u] of AGO) if (d >= ms) return `${Math.floor(d / ms)} ${u} ago`;
  return "Just now";
}

/** A list mapped with a plain loop: a node, a menu entry or a fact is not a list row, and the rows lint reads every `.map(` in a screen as one. */
export function each<T, R>(list: readonly T[], f: (x: T, i: number) => R): R[] {
  const out: R[] = [];
  for (let i = 0; i < list.length; i++) out.push(f(list[i]!, i));
  return out;
}
