// memory graph (spec 2.15, 3.5; ARCH 6.10 and 7.5): the consumer that keeps graph nodes and edges up to date (memory.index_graph), and the reads built per viewer through access
// checks (memory.graph, memory.graph_everything, memory.graph_export, memory.layout.get/save).
// Nodes are memory notes (agent, project and Space layers only; a personal layer is never indexed), records and chats. Edges are [[links]] between notes, relations between records,
// and "came from" (a note holding a fact that came from a chat or record). Clusters are named after their hub (the node with the most edges). The client draws it with sigma.js.
// DECISION: a note's layer comes from its folder path (Agents/<agent>/memory, Projects/<project>/memory, People/<person>/memory/<agent>, Knowledge/Memory); the agent or project id is found by name.
// DECISION: graph_export writes its JSON into the agent's folder, or the first Space root for a Space graph, because the contract takes no folder.
import { headings, frontmatter, links as mdLinks } from "../../../lib/md.ts";
import { actorOf, ensure, mintId, num, orNull, raise, rowsOf, sealText, str } from "../projections.ts";
import type { Layer, MemCtx, Row } from "../projections.ts";

type NodeKind = "note" | "person" | "client" | "project" | "site" | "decision" | "record" | "chat";

interface GNode {
  nodeId: string; kind: NodeKind; title: string; layer: Layer | null; agentId: string | null; projectId: string | null; resType: string; resId: string; link: string | null; createdAt: number;
}
interface GEdge { from: string; to: string; kind: "link" | "relation" | "came_from" }

const KIND_OF_TYPE: Readonly<Record<string, NodeKind>> = {
  person: "person", contact: "person", client: "client", company: "client", account: "client", project: "project", site: "site", decision: "decision",
};

// ---- index_graph

export async function indexGraph(ctx: MemCtx, input: { entity: string; id: string; seq: number }) {
  ensure(ctx.db);
  const seen = rowsOf(ctx.db, "SELECT seq FROM memory_graph_seen WHERE entity = ? AND ref = ?", input.entity, input.id)[0];
  if (seen && num(seen["seq"]) >= input.seq) return { nodes: 0, edges: 0 };
  const [base, sub] = input.entity.split(":");
  let out: { nodes: number; edges: number };
  if (base === "file") out = await indexFile(ctx, input.id);
  else if (base === "record") {
    if (!sub) raise(ctx, "validation.bad_input", "A record is indexed as record:<type>.", { entity: input.entity });
    out = await indexRecord(ctx, sub, input.id);
  } else if (base === "chat" || base === "thread") out = await indexChat(ctx, input.id);
  else raise(ctx, "validation.bad_input", "Memory indexes files, records and chats.", { entity: input.entity });
  ctx.db.run("INSERT OR REPLACE INTO memory_graph_seen (entity, ref, seq) VALUES (?, ?, ?)", input.entity, input.id, input.seq);
  return out;
}

function removeNode(ctx: MemCtx, nodeId: string): void {
  ctx.db.run("DELETE FROM memory_graph_nodes WHERE node_id = ?", nodeId);
  ctx.db.run("DELETE FROM memory_graph_edges WHERE from_id = ?", nodeId);
  ctx.db.run("DELETE FROM memory_graph_edges WHERE to_id = ?", nodeId);
  ctx.db.run("DELETE FROM memory_graph_links WHERE from_id = ?", nodeId);
}

function putNode(ctx: MemCtx, n: GNode): void {
  ctx.db.run(
    "INSERT INTO memory_graph_nodes (node_id, kind, title, layer, agent_id, project_id, res_type, res_id, link, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT (node_id) DO UPDATE SET kind = excluded.kind, title = excluded.title, layer = excluded.layer, agent_id = excluded.agent_id, project_id = excluded.project_id, res_type = excluded.res_type, res_id = excluded.res_id, link = excluded.link, updated_at = excluded.updated_at",
    n.nodeId, n.kind, n.title, n.layer, n.agentId, n.projectId, n.resType, n.resId, n.link, n.createdAt, ctx.now(),
  );
}

const noteIdOf = (fileId: string): string => `not_${fileId.replace(/^[a-z]+_/, "").replace(/[^a-z0-9]/g, "") || "x"}`;

interface Where { layer: Layer; area: string; agentName: string | null; projectName: string | null; personFolder: string | null }

/** Which memory layer a file sits in, from its path. Null when the file is not memory. */
export function classify(path: string): Where | null {
  const p = path.replace(/^\/+/, "");
  const area = (m: string | undefined): string => m ?? "notes";
  let m = /^Agents\/([^/]+)\/memory(?:\/(notes|proposed|recipes|journal))?(?:\/|$)/.exec(p);
  if (m) return { layer: "agent", area: area(m[2]), agentName: m[1] ?? null, projectName: null, personFolder: null };
  m = /^Projects\/([^/]+)\/memory(?:\/(notes|proposed|recipes|journal))?(?:\/|$)/.exec(p);
  if (m) return { layer: "project", area: area(m[2]), agentName: null, projectName: m[1] ?? null, personFolder: null };
  m = /^People\/([^/]+)\/memory\/([^/]+)(?:\/(notes|proposed|recipes|journal))?(?:\/|$)/.exec(p);
  if (m) return { layer: "person", area: area(m[3]), agentName: m[2] ?? null, projectName: null, personFolder: m[1] ?? null };
  m = /^(?:Knowledge\/)?Memory(?:\/(notes|proposed|recipes|journal))?(?:\/|$)/.exec(p);
  if (m) return { layer: "space", area: area(m[1]), agentName: null, projectName: null, personFolder: null };
  return null;
}

async function idByName(ctx: MemCtx, kind: "agent" | "project", name: string): Promise<string | null> {
  try {
    const want = name.trim().toLowerCase();
    if (kind === "agent") {
      const out = (await ctx.call("agents.list", {})) as { agents: Array<{ agentId: string; name: string }> };
      return out.agents.find((a) => a.name.toLowerCase() === want)?.agentId ?? null;
    }
    const out = (await ctx.call("projects.list", {})) as { projects: Array<{ projectId: string; title: string }> };
    return out.projects.find((p) => p.title.toLowerCase() === want)?.projectId ?? null;
  } catch { return null; }
}

async function indexFile(ctx: MemCtx, fileId: string): Promise<{ nodes: number; edges: number }> {
  const nodeId = `note:${fileId}`;
  const gone = (): { nodes: number; edges: number } => {
    removeNode(ctx, nodeId);
    ctx.db.run("DELETE FROM memory_notes WHERE file_id = ?", fileId);
    return { nodes: 0, edges: 0 };
  };
  let file: { fileId: string; folderId: string; name: string; ownerId: string; createdAt: number; updatedAt: number; deletedAt?: number; kind: string };
  let folderPath: string;
  try {
    file = ((await ctx.call("files.get", { fileId })) as { file: typeof file }).file;
    if (file.deletedAt !== undefined) return gone();
    folderPath = ((await ctx.call("files.folder.get", { folderId: file.folderId })) as { folder: { path: string } }).folder.path;
  } catch { return gone(); }
  const where = classify(`${folderPath}/${file.name}`);
  if (!where || (file.kind !== "markdown" && file.kind !== "text" && !/\.(md|markdown|txt)$/i.test(file.name))) return gone();

  let md = "";
  try { md = str(((await ctx.call("files.read", { fileId, as: "text" })) as { text?: string }).text); } catch { md = ""; }
  const fm = frontmatter(md);
  const title = fm.data["title"] ?? headings(fm.body).find((h) => h.level === 1)?.text ?? file.name.replace(/\.[a-z0-9]+$/i, "");
  const agentId = where.agentName ? await idByName(ctx, "agent", where.agentName) : null;
  const projectId = where.projectName ? await idByName(ctx, "project", where.projectName) : null;
  const owner = where.layer === "person" ? file.ownerId : where.layer === "agent" ? agentId ?? where.agentName ?? "" : where.layer === "project" ? projectId ?? where.projectName ?? "" : ctx.space;
  const noteId = noteIdOf(fileId);
  const personal = where.layer === "person";
  ctx.db.run(
    "INSERT INTO memory_notes (note_id, file_id, path, title, sealed_title, layer, owner_ref, agent_id, project_id, area, body, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT (note_id) DO UPDATE SET path = excluded.path, title = excluded.title, sealed_title = excluded.sealed_title, layer = excluded.layer, owner_ref = excluded.owner_ref, agent_id = excluded.agent_id, project_id = excluded.project_id, area = excluded.area, body = excluded.body, updated_at = excluded.updated_at",
    noteId, fileId, `${folderPath}/${file.name}`, personal ? "" : title, personal ? sealText(ctx, owner, title) : null, where.layer, owner, agentId, projectId, where.area, personal ? "" : fm.body, file.updatedAt,
  );
  // A personal layer is never in the graph; if the file was a node before it moved here, it goes.
  if (personal) {
    removeNode(ctx, nodeId);
    return { nodes: 0, edges: 0 };
  }
  putNode(ctx, { nodeId, kind: "note", title, layer: where.layer, agentId, projectId, resType: "file", resId: fileId, link: `/files/${fileId}`, createdAt: file.createdAt });
  ctx.db.run("DELETE FROM memory_graph_edges WHERE from_id = ? AND kind = 'link'", nodeId);
  ctx.db.run("DELETE FROM memory_graph_links WHERE from_id = ?", nodeId);
  let edges = 0;
  for (const target of new Set(mdLinks(fm.body).wiki)) {
    const hit = rowsOf(ctx.db, "SELECT node_id FROM memory_graph_nodes WHERE kind = 'note' AND LOWER(title) = ? AND node_id != ?", target.toLowerCase(), nodeId)[0];
    if (hit) {
      ctx.db.run("INSERT OR IGNORE INTO memory_graph_edges (from_id, to_id, kind) VALUES (?, ?, 'link')", nodeId, str(hit["node_id"]));
      edges++;
    } else ctx.db.run("INSERT OR IGNORE INTO memory_graph_links (from_id, target) VALUES (?, ?)", nodeId, target.toLowerCase());
  }
  // Notes that linked to this title before it existed.
  for (const r of rowsOf(ctx.db, "SELECT from_id FROM memory_graph_links WHERE target = ?", title.toLowerCase())) {
    ctx.db.run("INSERT OR IGNORE INTO memory_graph_edges (from_id, to_id, kind) VALUES (?, ?, 'link')", str(r["from_id"]), nodeId);
    ctx.db.run("DELETE FROM memory_graph_links WHERE from_id = ? AND target = ?", str(r["from_id"]), title.toLowerCase());
    edges++;
  }
  return { nodes: 1, edges };
}

async function indexRecord(ctx: MemCtx, type: string, id: string): Promise<{ nodes: number; edges: number }> {
  const nodeId = `record:${id}`;
  let rec: { id: string; type: string; fields: Record<string, unknown>; createdAt: number; deletedAt?: number };
  try {
    rec = ((await ctx.call("records.get", { recordId: id, type })) as { record: typeof rec }).record;
    if (rec.deletedAt !== undefined) throw new Error("deleted");
  } catch {
    removeNode(ctx, nodeId);
    return { nodes: 0, edges: 0 };
  }
  const f = rec.fields;
  const named = ["name", "title", "full_name", "subject"].map((k) => f[k]).find((v) => typeof v === "string" && v.trim() !== "");
  putNode(ctx, {
    nodeId, kind: KIND_OF_TYPE[type] ?? "record", title: typeof named === "string" ? named : id, layer: null, agentId: null, projectId: null, resType: "record", resId: id, link: `/records/${id}`, createdAt: rec.createdAt,
  });
  ctx.db.run("DELETE FROM memory_graph_edges WHERE from_id = ? AND kind = 'relation'", nodeId);
  let edges = 0;
  for (const v of Object.values(f)) {
    for (const x of Array.isArray(v) ? v : [v]) {
      if (typeof x === "string" && /^rec_[a-z0-9]+$/.test(x) && x !== id) {
        ctx.db.run("INSERT OR IGNORE INTO memory_graph_edges (from_id, to_id, kind) VALUES (?, ?, 'relation')", nodeId, `record:${x}`);
        edges++;
      }
    }
  }
  return { nodes: 1, edges };
}

async function indexChat(ctx: MemCtx, threadId: string): Promise<{ nodes: number; edges: number }> {
  const nodeId = `chat:${threadId}`;
  try {
    const t = ((await ctx.call("threads.get", { threadId })) as { thread: { title?: string; createdAt: number } }).thread;
    putNode(ctx, { nodeId, kind: "chat", title: t.title ?? "Chat", layer: null, agentId: null, projectId: null, resType: "thread", resId: threadId, link: `/chats/${threadId}`, createdAt: t.createdAt });
    return { nodes: 1, edges: 0 };
  } catch {
    removeNode(ctx, nodeId);
    return { nodes: 0, edges: 0 };
  }
}

// ---- build the graph

interface Built {
  nodes: Array<{ nodeId: string; kind: NodeKind; title: string; layer?: Layer; cluster?: string; x: number; y: number; link?: string }>;
  edges: GEdge[];
  clusters: Array<{ name: string; hub: string; size: number }>;
}

function nodeOf(r: Row): GNode {
  return {
    nodeId: str(r["node_id"]), kind: str(r["kind"]) as NodeKind, title: str(r["title"]), layer: (orNull(r["layer"]) as Layer | null), agentId: orNull(r["agent_id"]), projectId: orNull(r["project_id"]),
    resType: str(r["res_type"]), resId: str(r["res_id"]), link: orNull(r["link"]), createdAt: num(r["created_at"]),
  };
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Positions the client can draw straight away; saved positions replace them. Deterministic for one set of nodes. */
function layout(groups: GNode[][], hubs: string[]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  groups.forEach((g, gi) => {
    const R = gi === 0 ? 0 : 140 * Math.sqrt(gi);
    const cx = R * Math.cos(gi * GOLDEN);
    const cy = R * Math.sin(gi * GOLDEN);
    const hub = hubs[gi];
    const rest = g.filter((n) => n.nodeId !== hub);
    if (hub) out.set(hub, { x: round1(cx), y: round1(cy) });
    const ring = 36 + 7 * Math.sqrt(rest.length);
    rest.forEach((n, k) => {
      const a = (2 * Math.PI * k) / Math.max(1, rest.length);
      out.set(n.nodeId, { x: round1(cx + ring * Math.cos(a)), y: round1(cy + ring * Math.sin(a)) });
    });
  });
  return out;
}

interface BuildOpts { scope: "agent" | "space"; agentId?: string | undefined; asOf?: number | undefined; kinds?: string[] | undefined; forViewer: boolean }

async function build(ctx: MemCtx, o: BuildOpts): Promise<Built> {
  const all = rowsOf(ctx.db, "SELECT * FROM memory_graph_nodes WHERE layer IS NULL OR layer != 'person'").map(nodeOf);
  const byId = new Map(all.map((n) => [n.nodeId, n] as const));
  const stored = rowsOf(ctx.db, "SELECT from_id, to_id, kind FROM memory_graph_edges").map((r) => ({ from: str(r["from_id"]), to: str(r["to_id"]), kind: str(r["kind"]) as GEdge["kind"] }));

  // "Came from": a note that holds a fact which came from a chat or a record.
  const came: GEdge[] = [];
  for (const r of rowsOf(
    ctx.db,
    "SELECT f.source_kind AS source_kind, f.source_ref AS source_ref, n.file_id AS file_id FROM memory_facts f JOIN memory_notes n ON n.note_id = f.note_id WHERE f.note_id IS NOT NULL AND f.status = 'current' AND f.enc = 0",
  )) {
    const k = str(r["source_kind"]);
    const target = k === "record" ? `record:${str(r["source_ref"])}` : k === "chat" || k === "channel" ? `chat:${str(r["source_ref"])}` : null;
    if (target) came.push({ from: `note:${str(r["file_id"])}`, to: target, kind: "came_from" });
  }

  let seed = all;
  if (o.scope === "agent") {
    if (!o.agentId) raise(ctx, "validation.bad_input", "Name the agent whose graph this is.");
    const keep = new Set(all.filter((n) => n.kind === "note" && (n.layer === "space" || n.layer === "project" || (n.layer === "agent" && n.agentId === o.agentId))).map((n) => n.nodeId));
    const near = new Set(keep);
    for (const e of [...stored, ...came]) {
      if (keep.has(e.from) && byId.has(e.to)) near.add(e.to);
      if (keep.has(e.to) && byId.has(e.from)) near.add(e.from);
    }
    seed = all.filter((n) => near.has(n.nodeId));
  }
  const kinds = o.kinds && o.kinds.length > 0 ? new Set(o.kinds) : null;
  const memo = new Map<string, boolean>();
  const visible: GNode[] = [];
  for (const n of seed) {
    if (o.asOf !== undefined && n.createdAt > o.asOf) continue;
    if (kinds && !kinds.has(n.kind)) continue;
    if (o.forViewer) {
      const key = `${n.resType}:${n.resId}`;
      let ok = memo.get(key);
      if (ok === undefined) {
        ok = ctx.authorize({ perm: null, level: "view" }, { type: n.resType, id: n.resId }).effect === "allow";
        memo.set(key, ok);
      }
      if (!ok) continue;
    }
    visible.push(n);
  }
  const ids = new Set(visible.map((n) => n.nodeId));
  const seen = new Set<string>();
  const edges: GEdge[] = [];
  for (const e of [...stored, ...came]) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    const k = `${e.from}|${e.to}|${e.kind}`;
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push(e);
  }
  edges.sort((a, b) => (a.from + a.to + a.kind).localeCompare(b.from + b.to + b.kind));

  // Clusters: connected groups of two or more, named after the node with the most edges.
  const parent = new Map<string, string>(visible.map((n) => [n.nodeId, n.nodeId] as const));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    for (let c = x; parent.get(c) !== r;) { const nx = parent.get(c)!; parent.set(c, r); c = nx; }
    return r;
  };
  for (const e of edges) parent.set(find(e.from), find(e.to));
  const degree = new Map<string, number>();
  for (const e of edges) { degree.set(e.from, (degree.get(e.from) ?? 0) + 1); degree.set(e.to, (degree.get(e.to) ?? 0) + 1); }
  const groups = new Map<string, GNode[]>();
  for (const n of visible) { const r = find(n.nodeId); groups.set(r, [...(groups.get(r) ?? []), n]); }
  const multi = [...groups.values()].filter((g) => g.length >= 2).map((g) => g.sort((a, b) => a.nodeId.localeCompare(b.nodeId)));
  const hubOf = (g: GNode[]): GNode => [...g].sort((a, b) => (degree.get(b.nodeId) ?? 0) - (degree.get(a.nodeId) ?? 0) || a.title.localeCompare(b.title) || a.nodeId.localeCompare(b.nodeId))[0]!;
  multi.sort((a, b) => b.length - a.length || hubOf(a).title.localeCompare(hubOf(b).title));
  const single = visible.filter((n) => (groups.get(find(n.nodeId))?.length ?? 0) < 2).sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const hubs = multi.map((g) => hubOf(g).nodeId);
  const clusterOf = new Map<string, string>();
  for (const g of multi) { const name = hubOf(g).title; for (const n of g) clusterOf.set(n.nodeId, name); }
  const pos = layout([...multi, single], [...hubs, ""]);

  return {
    nodes: [...visible].sort((a, b) => a.nodeId.localeCompare(b.nodeId)).map((n) => {
      const p = pos.get(n.nodeId) ?? { x: 0, y: 0 };
      const cluster = clusterOf.get(n.nodeId);
      return { nodeId: n.nodeId, kind: n.kind, title: n.title, ...(n.layer ? { layer: n.layer } : {}), ...(cluster ? { cluster } : {}), x: p.x, y: p.y, ...(n.link ? { link: n.link } : {}) };
    }),
    edges,
    clusters: multi.map((g) => ({ name: hubOf(g).title, hub: hubOf(g).nodeId, size: g.length })),
  };
}

const scopeKey = (scope: string, agentId: string | undefined): string => `${scope}:${agentId ?? ""}`;

function savedPositions(ctx: MemCtx, key: string): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  for (const r of rowsOf(ctx.db, "SELECT node_id, x, y FROM memory_layouts WHERE scope_key = ? AND person = ?", key, actorOf(ctx))) out.set(str(r["node_id"]), { x: num(r["x"]), y: num(r["y"]) });
  return out;
}

function withSaved(ctx: MemCtx, g: Built, key: string): Built {
  const saved = savedPositions(ctx, key);
  if (saved.size === 0) return g;
  return { ...g, nodes: g.nodes.map((n) => { const p = saved.get(n.nodeId); return p ? { ...n, x: p.x, y: p.y } : n; }) };
}

export async function graph(ctx: MemCtx, input: { scope: "agent" | "space"; agentId?: string; asOf?: number; kinds?: string[] }) {
  ensure(ctx.db);
  const g = await build(ctx, { scope: input.scope, agentId: input.agentId, asOf: input.asOf, kinds: input.kinds, forViewer: true });
  return withSaved(ctx, g, scopeKey(input.scope, input.agentId));
}

export async function graphEverything(ctx: MemCtx, input: { asOf?: number }) {
  ensure(ctx.db);
  const me = actorOf(ctx);
  // Every open is logged: the event is the record, and the host adds the audit entry.
  ctx.emit("memory.everything_viewed", me, { by: me });
  return build(ctx, { scope: "space", asOf: input.asOf, forViewer: false });
}

export async function graphExport(ctx: MemCtx, input: { scope: "agent" | "space"; agentId?: string; asOf?: number; kinds?: string[] }) {
  ensure(ctx.db);
  const g = withSaved(ctx, await build(ctx, { scope: input.scope, agentId: input.agentId, asOf: input.asOf, kinds: input.kinds, forViewer: true }), scopeKey(input.scope, input.agentId));
  let folderId: string | undefined;
  if (input.scope === "agent" && input.agentId) {
    folderId = str(((await ctx.call("agents.get", { agentId: input.agentId })) as { agent?: { folderId?: string } }).agent?.folderId) || undefined;
  } else {
    const roots = ((await ctx.call("files.tree", {})) as { roots: Array<{ key: string; kind: string; folderId?: string }> }).roots;
    folderId = (roots.find((r) => r.key === "space" && r.folderId) ?? roots.find((r) => r.kind === "folder" && r.folderId))?.folderId;
  }
  if (!folderId) raise(ctx, "validation.bad_input", "There is no folder to write the export into.");
  const day = new Date(ctx.now()).toISOString().slice(0, 10);
  const made = (await ctx.call("files.create", {
    folderId, name: `memory-graph-${input.scope}-${day}.json`, kind: "text", mime: "application/json", content: { text: JSON.stringify(g) }, idempotencyKey: `memgraph:${mintId("x", ctx.now())}`,
  })) as { file: { fileId: string } };
  return { fileId: made.file.fileId };
}

export async function layoutGet(ctx: MemCtx, input: { scope: "agent" | "space"; agentId?: string }) {
  ensure(ctx.db);
  const positions: Record<string, { x: number; y: number }> = {};
  for (const [k, v] of savedPositions(ctx, scopeKey(input.scope, input.agentId))) positions[k] = v;
  return { positions };
}

export async function layoutSave(ctx: MemCtx, input: { scope: "agent" | "space"; agentId?: string; positions: Record<string, { x: number; y: number }> }) {
  ensure(ctx.db);
  const key = scopeKey(input.scope, input.agentId);
  const me = actorOf(ctx);
  const entries = Object.entries(input.positions);
  for (const [, p] of entries) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) raise(ctx, "validation.bad_input", "A position needs two numbers.");
  ctx.db.run("DELETE FROM memory_layouts WHERE scope_key = ? AND person = ?", key, me);
  for (const [nodeId, p] of entries) ctx.db.run("INSERT INTO memory_layouts (scope_key, person, node_id, x, y) VALUES (?, ?, ?, ?, ?)", key, me, nodeId, p.x, p.y);
  return { ok: true };
}
