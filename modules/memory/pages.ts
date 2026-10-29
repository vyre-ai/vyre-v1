// Living pages (owner design 30 Oct 2026, ruling 4), the data side: one page per subject (a person, a record, a project, an agent, a topic) whose facts are the rows in memory_facts and whose Notes are
// free text that people and agents edit. Notes are versioned (each save adds a version and keeps the old ones). [[links]] written in the Notes become labelled edges to other pages, each with the line
// it was written in as its evidence. A personal page keeps its Notes, link labels and evidence sealed under its owner's key; nothing about its words is in a plain column.
import { trail, whoIs } from "./trail.ts";
import type { Who } from "./trail.ts";
import { actorOf, mintId, num, openText, orNull, rowsOf, sealText, str } from "./projections.ts";
import type { Layer, MemCtx, Row } from "./projections.ts";

export type PageKind = "person" | "client" | "project" | "agent" | "record" | "topic" | "decision" | "site";

export interface Page {
  id: string; subject: string; title: string; kind: PageKind; layer: Layer; ownerRef: string; agentId: string | null; projectId: string | null; subjectRef: string | null;
  /** The Notes. Empty for a personal page the caller does not own. */
  notes: string; enc: number; version: number; createdAt: number; updatedAt: number; trashedAt: number | null; trashReason: string | null; archivedAt: number | null;
}

/** The key a title is found by: case, spacing and a leading or trailing dot do not matter. */
export const subjectKey = (title: string): string => title.toLowerCase().replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "");

const KINDS: readonly PageKind[] = ["person", "client", "project", "agent", "record", "topic", "decision", "site"];
export const pageKind = (v: unknown): PageKind => (KINDS.includes(v as PageKind) ? (v as PageKind) : "topic");

export function readPage(ctx: Pick<MemCtx, "seal" | "principal" | "actingFor">, r: Row): Page {
  const layer = str(r["layer"]) as Layer;
  const owner = str(r["owner_ref"]);
  let notes = str(r["notes"]);
  const sealed = orNull(r["sealed"]);
  if (num(r["enc"]) === 2 && sealed !== null) {
    if (owner === actorOf(ctx)) { try { notes = openText(ctx, sealed); } catch { notes = ""; } } else notes = "";
  }
  return {
    id: str(r["page_id"]), subject: str(r["subject"]), title: str(r["title"]), kind: pageKind(r["kind"]), layer, ownerRef: owner, agentId: orNull(r["agent_id"]), projectId: orNull(r["project_id"]),
    subjectRef: orNull(r["subject_ref"]), notes, enc: num(r["enc"]), version: num(r["version"]), createdAt: num(r["created_at"]), updatedAt: num(r["updated_at"]),
    trashedAt: r["trashed_at"] === null || r["trashed_at"] === undefined ? null : num(r["trashed_at"]), trashReason: orNull(r["trash_reason"]),
    archivedAt: r["archived_at"] === null || r["archived_at"] === undefined ? null : num(r["archived_at"]),
  };
}

export function loadPage(ctx: MemCtx, id: string): Page | null {
  const r = rowsOf(ctx.db, "SELECT * FROM memory_pages WHERE page_id = ?", id)[0];
  return r ? readPage(ctx, r) : null;
}

export function findPage(ctx: MemCtx, layer: Layer, owner: string, subject: string): Page | null {
  const r = rowsOf(ctx.db, "SELECT * FROM memory_pages WHERE layer = ? AND owner_ref = ? AND subject = ?", layer, owner, subject)[0];
  return r ? readPage(ctx, r) : null;
}

// ---- links in the Notes

export interface ParsedLink { target: string; label: string; evidence: string }

/**
 * Every [[link]] in a text, with its label and the line it was written in. A label is written before the link as `works with:: [[Dana Ortiz]]`; a link with none has the label "". `[[Page|shown]]` and
 * `[[Page#section]]` link to Page. The same target with the same label on two lines counts once, with the first line as its evidence.
 */
export function parseLinks(notes: string): ParsedLink[] {
  const out: ParsedLink[] = [];
  const seen = new Set<string>();
  for (const raw of notes.split("\n")) {
    const line = raw.trim();
    if (!line.includes("[[")) continue;
    const m = /^(?:[-*>\s]*)([A-Za-z][A-Za-z0-9 '/-]{0,40}?)::\s*(.*)$/.exec(line);
    const label = m ? subjectKey(m[1] ?? "") : "";
    const body = m ? (m[2] ?? "") : line;
    for (const l of body.matchAll(/\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]/g)) {
      const target = (l[1] ?? "").trim();
      if (target === "") continue;
      const key = `${subjectKey(target)}|${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ target, label, evidence: line.length > 240 ? `${line.slice(0, 237)}...` : line });
    }
  }
  return out;
}

/** The pages a title can mean: a page in the same place first, then any shared page, then (for a person's page) one of theirs. Never another person's personal page. */
function resolveTarget(ctx: MemCtx, from: Page, target: string): string | null {
  const key = subjectKey(target);
  const rows = rowsOf(ctx.db, "SELECT page_id, layer, owner_ref FROM memory_pages WHERE subject = ? AND trashed_at IS NULL", key);
  const pick = (f: (r: Row) => boolean): string | null => {
    const r = rows.find(f);
    return r ? str(r["page_id"]) : null;
  };
  return pick((r) => str(r["layer"]) === from.layer && str(r["owner_ref"]) === from.ownerRef && str(r["page_id"]) !== from.id)
    ?? pick((r) => str(r["layer"]) !== "person" && str(r["page_id"]) !== from.id)
    ?? (from.layer === "person" ? pick((r) => str(r["layer"]) === "person" && str(r["owner_ref"]) === from.ownerRef && str(r["page_id"]) !== from.id) : null);
}

const unresolved = (target: string): string => `~${subjectKey(target)}`;

/** Rewrite the link rows of a page from its Notes. A personal page seals label and evidence. */
export function indexLinks(ctx: MemCtx, p: Page, notes: string): number {
  ctx.db.run("DELETE FROM memory_page_links WHERE from_page = ?", p.id);
  const now = ctx.now();
  let n = 0;
  for (const l of parseLinks(notes)) {
    const to = resolveTarget(ctx, p, l.target) ?? unresolved(l.target);
    const sealed = p.layer === "person" ? sealText(ctx, p.ownerRef, JSON.stringify({ label: l.label, evidence: l.evidence, target: l.target })) : null;
    // label is part of the key; a personal page keys on a hash of nothing readable so two labels to one page stay two rows
    const label = p.layer === "person" ? `#${n}` : l.label;
    ctx.db.run(
      "INSERT OR REPLACE INTO memory_page_links (from_page, to_page, label, evidence, sealed, at) VALUES (?, ?, ?, ?, ?, ?)",
      p.id, to, label, p.layer === "person" ? "" : l.evidence, sealed, now,
    );
    n++;
  }
  return n;
}

/** Links and mentions that named this title before the page existed now point at it. */
function resolvePending(ctx: MemCtx, p: Page): void {
  if (p.layer === "person") return;
  const pending = unresolved(p.title);
  ctx.db.run("UPDATE memory_page_links SET to_page = ? WHERE to_page = ? AND from_page IN (SELECT page_id FROM memory_pages WHERE layer != 'person' OR owner_ref = ?)", p.id, pending, p.ownerRef);
  for (const m of rowsOf(ctx.db, "SELECT source_kind, source_ref FROM memory_mentions WHERE page_id = ?", pending)) {
    const there = rowsOf(ctx.db, "SELECT 1 AS x FROM memory_mentions WHERE page_id = ? AND source_kind = ? AND source_ref = ?", p.id, str(m["source_kind"]), str(m["source_ref"]))[0];
    if (there) ctx.db.run("DELETE FROM memory_mentions WHERE page_id = ? AND source_kind = ? AND source_ref = ?", pending, str(m["source_kind"]), str(m["source_ref"]));
    else ctx.db.run("UPDATE memory_mentions SET page_id = ? WHERE page_id = ? AND source_kind = ? AND source_ref = ?", p.id, pending, str(m["source_kind"]), str(m["source_ref"]));
  }
}

// ---- create, save, delete

export interface PageSave { who?: Who; reason?: string; source?: string; runId?: string }

export interface NewPage {
  title: string; kind: PageKind; layer: Layer; ownerRef: string; agentId: string | null; projectId: string | null; subjectRef?: string | null; notes?: string;
}

/** Put a graph node for the page so the graph draws it. A personal page is never in the graph. */
function graphNode(ctx: MemCtx, p: Page): void {
  const node = `page:${p.id}`;
  if (p.layer === "person" || p.trashedAt !== null) {
    ctx.db.run("DELETE FROM memory_graph_nodes WHERE node_id = ?", node);
    return;
  }
  ctx.db.run(
    "INSERT INTO memory_graph_nodes (node_id, kind, title, layer, agent_id, project_id, res_type, res_id, link, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'memory_page', ?, ?, ?, ?) " +
    "ON CONFLICT (node_id) DO UPDATE SET kind = excluded.kind, title = excluded.title, layer = excluded.layer, agent_id = excluded.agent_id, project_id = excluded.project_id, updated_at = excluded.updated_at",
    node, p.kind, p.title, p.layer, p.agentId, p.projectId, p.id, `/memory/pages/${p.id}`, p.createdAt, ctx.now(),
  );
}

export function createPage(ctx: MemCtx, n: NewPage, o: PageSave = {}): Page {
  const now = ctx.now();
  const id = mintId("pg", now);
  const sealed = n.layer === "person";
  const notes = n.notes ?? "";
  const who = o.who ?? whoIs(ctx);
  ctx.db.run(
    "INSERT INTO memory_pages (page_id, subject, title, kind, layer, owner_ref, agent_id, project_id, subject_ref, notes, sealed, enc, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
    id, subjectKey(n.title), n.title.trim(), n.kind, n.layer, n.ownerRef, n.agentId, n.projectId, n.subjectRef ?? null, sealed ? "" : notes, sealed ? sealText(ctx, n.ownerRef, notes) : null, sealed ? 2 : 0, now, now,
  );
  ctx.db.run(
    "INSERT INTO memory_page_versions (page_id, version, notes, sealed, enc, by_actor, actor_kind, at, reason) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)",
    id, sealed ? "" : notes, sealed ? sealText(ctx, n.ownerRef, notes) : null, sealed ? 2 : 0, who.actor, who.kind, now, o.reason ?? null,
  );
  const page = loadPage(ctx, id) as Page;
  page.notes = notes;
  resolvePending(ctx, page);
  indexLinks(ctx, page, notes);
  graphNode(ctx, page);
  trail(ctx, { action: "create", pageId: id, layer: page.layer, ownerRef: page.ownerRef, agentId: page.agentId, projectId: page.projectId, who, ...(o.source ? { source: o.source } : {}), ...(o.reason ? { reason: o.reason } : {}), detail: { version: 1, kind: page.kind } });
  return page;
}

/** Save the Notes of a page as a new version. The old versions stay. Returns the page, or the same page unchanged when the text is the same. */
export function saveNotes(ctx: MemCtx, p: Page, notes: string, o: PageSave = {}): Page {
  if (notes === p.notes) return p;
  const now = ctx.now();
  const version = p.version + 1;
  const who = o.who ?? whoIs(ctx);
  const sealed = p.layer === "person";
  ctx.db.run(
    "UPDATE memory_pages SET notes = ?, sealed = ?, enc = ?, version = ?, updated_at = ?, touched_at = NULL WHERE page_id = ?",
    sealed ? "" : notes, sealed ? sealText(ctx, p.ownerRef, notes) : null, sealed ? 2 : 0, version, now, p.id,
  );
  ctx.db.run(
    "INSERT INTO memory_page_versions (page_id, version, notes, sealed, enc, by_actor, actor_kind, at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    p.id, version, sealed ? "" : notes, sealed ? sealText(ctx, p.ownerRef, notes) : null, sealed ? 2 : 0, who.actor, who.kind, now, o.reason ?? null,
  );
  const next: Page = { ...p, notes, version, updatedAt: now };
  indexLinks(ctx, next, notes);
  graphNode(ctx, next);
  trail(ctx, { action: "edit", pageId: p.id, layer: p.layer, ownerRef: p.ownerRef, agentId: p.agentId, projectId: p.projectId, who, ...(o.source ? { source: o.source } : {}), ...(o.reason ? { reason: o.reason } : {}), ...(o.runId ? { runId: o.runId } : {}), detail: { version } });
  return next;
}

/** Move a page to Trash. Its versions and links stay; it leaves the graph and the lists. */
export function trashPage(ctx: MemCtx, p: Page, reason: string, o: PageSave = {}): boolean {
  if (p.trashedAt !== null) return false;
  const now = ctx.now();
  ctx.db.run("UPDATE memory_pages SET trashed_at = ?, trash_reason = ?, touched_at = NULL, archived_at = NULL WHERE page_id = ?", now, reason, p.id);
  ctx.db.run("DELETE FROM memory_graph_nodes WHERE node_id = ?", `page:${p.id}`);
  trail(ctx, { action: "delete", pageId: p.id, layer: p.layer, ownerRef: p.ownerRef, agentId: p.agentId, projectId: p.projectId, ...(o.who ? { who: o.who } : {}), reason, ...(o.source ? { source: o.source } : {}) });
  return true;
}

export function untrashPage(ctx: MemCtx, p: Page, from: "trash" | "archive", o: PageSave = {}): Page {
  const now = ctx.now();
  ctx.db.run("UPDATE memory_pages SET trashed_at = NULL, trash_reason = NULL, archived_at = NULL, touched_at = ? WHERE page_id = ?", now, p.id);
  const next: Page = { ...p, trashedAt: null, trashReason: null, archivedAt: null };
  graphNode(ctx, next);
  resolvePending(ctx, next);
  trail(ctx, { action: "restore", pageId: p.id, layer: p.layer, ownerRef: p.ownerRef, agentId: p.agentId, projectId: p.projectId, ...(o.who ? { who: o.who } : {}), reason: from === "archive" ? "restored from Archive" : "restored from Trash", detail: { from } });
  return next;
}
