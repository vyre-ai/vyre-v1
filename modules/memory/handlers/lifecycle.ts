// The life of a fact after it is learned (owner design 30 Oct 2026, rulings 2 and 5): the Learned feed with Undo, Trash and restore, Archive, and the trail.
// A deleted or merged-away fact goes to Trash: not recalled, not in normal search, found by Trash search, restored by one call by anyone (a person or an agent) who can see it. A fact untouched in Trash
// for the Space's number of days (30 to 90, default 60) moves to Archive: out of all search, restorable by an admin. Only memory.erase removes content, and it leaves a contentless trail line.
// Reading a trashed fact, finding it in Trash search or restoring it counts as touching it, which starts its days again.
import { trashDays } from "../policy.ts";
import { factRows } from "../enrich.ts";
import { loadPage, pageRowOut, readPage, untrashPage } from "../pages.ts";
import { trail, whoIs } from "../trail.ts";
import type { Who } from "../trail.ts";
import { actorOf, bm25, ensure, factOut, loadFact, makeAccess, num, orNull, pageOf, raise, readFact, rowsOf, sourceLinkOf, str, trigramSim } from "../projections.ts";
import type { Access, Fact, Layer, MemCtx, Row } from "../projections.ts";

const DAY = 86_400_000;
type Page = { cursor?: string; limit?: number };

const scopeOf = (f: Fact) => ({ layer: f.layer, ownerRef: f.ownerRef, agentId: f.agentId, projectId: f.projectId });

/** May the caller see this fact: a personal fact only its owner, a shared one by access on its layer. */
export async function canSee(ctx: MemCtx, access: Access, f: Fact): Promise<boolean> {
  if (f.layer === "person") return f.ownerRef === actorOf(ctx);
  return access.can(f.layer, f.ownerRef, f.agentId, f.projectId, "view");
}

export interface TrashOpts { reason: string; action?: "delete" | "merge" | "undo" | "reject"; source?: string; who?: Who; mergedInto?: string; runId?: string }

/** Move a live or waiting fact to Trash. Nothing is overwritten: its text stays, its status says it is out of answers, and the trail says who did it and why. Returns false when it was already there. */
export function trashFact(ctx: MemCtx, f: Fact, o: TrashOpts): boolean {
  if (f.trashedAt !== null || f.status === "removed") return false;
  const now = ctx.now();
  const who = o.who ?? whoIs(ctx);
  ctx.db.run(
    "UPDATE memory_facts SET status = 'removed', closed_at = ?, valid_to = COALESCE(valid_to, ?), trashed_at = ?, trash_reason = ?, trashed_by = ?, prev_status = ?, prev_valid_to = ?, merged_into = ?, touched_at = NULL, archived_at = NULL WHERE id = ?",
    now, now, now, o.reason, who.actor, f.status, f.validTo, o.mergedInto ?? null, f.id,
  );
  ctx.db.run("DELETE FROM memory_vectors WHERE doc_kind = 'fact' AND doc_id = ?", f.id);
  trail(ctx, {
    action: o.action ?? "delete", factId: f.id, ...scopeOf(f), who, reason: o.reason, ...(o.source ? { source: o.source } : {}), ...(o.runId ? { runId: o.runId } : {}),
    detail: { from: f.status, ...(o.mergedInto ? { mergedInto: o.mergedInto } : {}) },
  });
  return true;
}

/** Put a trashed or archived fact back as it was before it was trashed. */
function untrash(ctx: MemCtx, f: Fact, from: "trash" | "archive", who: Who, source?: string): Fact {
  const row = rowsOf(ctx.db, "SELECT prev_status, prev_valid_to FROM memory_facts WHERE id = ?", f.id)[0];
  const prev = str(row?.["prev_status"]);
  const status = prev === "proposed" || prev === "closed" ? prev : "current";
  const validTo = row?.["prev_valid_to"] === null || row?.["prev_valid_to"] === undefined ? null : num(row["prev_valid_to"]);
  const now = ctx.now();
  ctx.db.run(
    "UPDATE memory_facts SET status = ?, valid_to = ?, closed_at = ?, trashed_at = NULL, trash_reason = NULL, trashed_by = NULL, prev_status = NULL, prev_valid_to = NULL, merged_into = NULL, archived_at = NULL, archived_by = NULL, touched_at = ? WHERE id = ?",
    status, validTo, status === "current" || status === "proposed" ? null : f.closedAt, now, f.id,
  );
  trail(ctx, { action: "restore", factId: f.id, ...scopeOf(f), who, reason: from === "archive" ? "restored from Archive" : "restored from Trash", ...(source ? { source } : {}), detail: { from, status } });
  return { ...f, status, validTo, closedAt: status === "current" || status === "proposed" ? null : f.closedAt, trashedAt: null, trashReason: null, mergedInto: null, archivedAt: null };
}

// ---- restore

export async function restore(ctx: MemCtx, input: { factId?: string; pageId?: string }) {
  ensure(ctx.db);
  const access = makeAccess(ctx);
  if ((input.factId === undefined) === (input.pageId === undefined)) raise(ctx, "validation.bad_input", "Name one fact or one page to restore.");
  if (input.pageId !== undefined) {
    const p = loadPage(ctx, input.pageId);
    if (!p) raise(ctx, "validation.not_found", "There is no such page.", { pageId: input.pageId });
    if (p.trashedAt === null) raise(ctx, "validation.precondition_failed", "This page is not in Trash.");
    const archived = p.archivedAt !== null;
    const mine = p.layer === "person" && p.ownerRef === actorOf(ctx);
    if (archived) { if (!mine && !access.isAdmin()) raise(ctx, "permission.role_lacks_permission", "An admin restores a page from Archive."); }
    else if (!(p.layer === "person" ? mine : await access.can(p.layer, p.ownerRef, p.agentId, p.projectId, "view"))) raise(ctx, "validation.not_found", "There is no such page.", { pageId: input.pageId });
    const back = untrashPage(ctx, p, archived ? "archive" : "trash", { who: whoIs(ctx) });
    ctx.emit("memory.page_restored", p.id, { pageId: p.id, from: archived ? "archive" : "trash", by: actorOf(ctx) });
    return { page: pageRowOut(back), restoredFrom: archived ? ("archive" as const) : ("trash" as const) };
  }
  const f = loadFact(ctx, input.factId as string);
  if (!f) raise(ctx, "validation.not_found", "There is no such fact.", { factId: input.factId });
  const archived = f.archivedAt !== null;
  if (f.trashedAt === null) raise(ctx, "validation.precondition_failed", "This fact is not in Trash.", { status: f.status });
  if (archived) {
    // Archive is out of all search; an admin brings a shared fact back, and a person brings back their own personal one.
    const mine = f.layer === "person" && f.ownerRef === actorOf(ctx);
    if (!mine && !access.isAdmin()) raise(ctx, "permission.role_lacks_permission", "An admin restores a fact from Archive.");
  } else if (!(await canSee(ctx, access, f))) raise(ctx, "validation.not_found", "There is no such fact.", { factId: input.factId });
  const back = untrash(ctx, f, archived ? "archive" : "trash", whoIs(ctx));
  ctx.emit("memory.restored", f.id, { factId: f.id, from: archived ? "archive" : "trash", by: actorOf(ctx) });
  return { fact: factOut(back), restoredFrom: archived ? ("archive" as const) : ("trash" as const) };
}

// ---- Trash and Archive search

export async function trashSearch(ctx: MemCtx, input: Page & { q?: string; area?: "trash" | "archive"; layer?: Layer; agentId?: string; projectId?: string }) {
  ensure(ctx.db);
  const area = input.area ?? "trash";
  const access = makeAccess(ctx);
  if (area === "archive" && !access.isAdmin()) raise(ctx, "permission.role_lacks_permission", "An admin searches Archive.");
  const args: unknown[] = [];
  let sql = `SELECT * FROM memory_facts WHERE trashed_at IS NOT NULL AND archived_at IS ${area === "archive" ? "NOT NULL" : "NULL"}`;
  if (input.layer) { sql += " AND layer = ?"; args.push(input.layer); }
  if (input.agentId) { sql += " AND agent_id = ?"; args.push(input.agentId); }
  if (input.projectId) { sql += " AND project_id = ?"; args.push(input.projectId); }
  sql += " ORDER BY trashed_at DESC, id";
  const pool: Fact[] = [];
  for (const r of rowsOf(ctx.db, sql, ...args)) {
    const f = readFact(ctx, r);
    // An admin reads Archive without opening anyone's personal memory: the owner's own rows are the only personal ones listed.
    if (f.layer === "person") { if (f.ownerRef !== actorOf(ctx)) continue; }
    else if (area === "trash" && !(await access.can(f.layer, f.ownerRef, f.agentId, f.projectId, "view"))) continue;
    pool.push(f);
  }
  let facts = pool;
  const q = (input.q ?? "").trim();
  if (q !== "") {
    const ranked = bm25(pool.map((f) => ({ title: f.kind ?? "", text: f.text, shared: f.layer !== "person" })), q);
    const needle = q.toLowerCase();
    facts = pool
      .map((f, i) => ({ f, s: (ranked[i]?.score ?? 0) + (f.text.toLowerCase().includes(needle) ? 1 : 0) + trigramSim(q, f.text) * 0.3, m: ranked[i]?.matched ?? 0 }))
      .filter((x) => x.m > 0 || x.f.text.toLowerCase().includes(needle) || x.s >= 0.35)
      .sort((a, b) => b.s - a.s || b.f.trashedAt! - a.f.trashedAt!)
      .map((x) => x.f);
  }
  const p = pageOf(facts, input.cursor, input.limit);
  // Finding a trashed fact counts as touching it: its days in Trash start again.
  if (area === "trash" && p.page.length > 0) {
    const now = ctx.now();
    for (const f of p.page) ctx.db.run("UPDATE memory_facts SET touched_at = ? WHERE id = ?", now, f.id);
  }
  // Pages in Trash (or Archive) are found the same way, by their title and, for a shared page, their Notes.
  const pages = [];
  {
    const pargs: unknown[] = [];
    let psql = `SELECT * FROM memory_pages WHERE trashed_at IS NOT NULL AND archived_at IS ${area === "archive" ? "NOT NULL" : "NULL"}`;
    if (input.layer) { psql += " AND layer = ?"; pargs.push(input.layer); }
    if (input.agentId) { psql += " AND agent_id = ?"; pargs.push(input.agentId); }
    if (input.projectId) { psql += " AND project_id = ?"; pargs.push(input.projectId); }
    psql += " ORDER BY trashed_at DESC, page_id";
    for (const r of rowsOf(ctx.db, psql, ...pargs)) {
      const pg = readPage(ctx, r);
      if (pg.layer === "person" ? pg.ownerRef !== actorOf(ctx) : area === "trash" && !(await access.can(pg.layer, pg.ownerRef, pg.agentId, pg.projectId, "view"))) continue;
      if (q !== "" && !pg.subject.includes(q.toLowerCase()) && !pg.notes.toLowerCase().includes(q.toLowerCase())) continue;
      pages.push(pageRowOut(pg));
    }
  }
  return { facts: factRows(ctx, p.page), pages, ...(p.next ? { next: p.next } : {}), total: p.total };
}

/** Reading one trashed fact counts as touching it (memory.fact.get calls this). */
export function touchIfTrashed(ctx: MemCtx, f: Fact): void {
  if (f.trashedAt !== null && f.archivedAt === null) ctx.db.run("UPDATE memory_facts SET touched_at = ? WHERE id = ?", ctx.now(), f.id);
}

// ---- the daily sweep: Trash to Archive

export async function archiveSweep(ctx: MemCtx): Promise<{ archived: number; days: number }> {
  ensure(ctx.db);
  const days = await trashDays(ctx);
  const now = ctx.now();
  const due = rowsOf(
    ctx.db,
    "SELECT * FROM memory_facts WHERE trashed_at IS NOT NULL AND archived_at IS NULL AND COALESCE(touched_at, trashed_at) <= ? ORDER BY trashed_at, id",
    now - days * DAY,
  );
  for (const r of due) {
    const id = str(r["id"]);
    ctx.db.run("UPDATE memory_facts SET archived_at = ?, archived_by = 'upkeep' WHERE id = ?", now, id);
    trail(ctx, {
      action: "archive", factId: id, layer: str(r["layer"]) as Layer, ownerRef: str(r["owner_ref"]), agentId: orNull(r["agent_id"]), projectId: orNull(r["project_id"]),
      who: { actor: "upkeep", kind: "upkeep" }, reason: `untouched in Trash for ${days} days`, detail: { days },
    });
  }
  const duePages = rowsOf(ctx.db, "SELECT * FROM memory_pages WHERE trashed_at IS NOT NULL AND archived_at IS NULL AND COALESCE(touched_at, trashed_at) <= ? ORDER BY trashed_at, page_id", now - days * DAY);
  for (const r of duePages) {
    const id = str(r["page_id"]);
    ctx.db.run("UPDATE memory_pages SET archived_at = ? WHERE page_id = ?", now, id);
    trail(ctx, {
      action: "archive", pageId: id, layer: str(r["layer"]) as Layer, ownerRef: str(r["owner_ref"]), agentId: orNull(r["agent_id"]), projectId: orNull(r["project_id"]),
      who: { actor: "upkeep", kind: "upkeep" }, reason: `untouched in Trash for ${days} days`, detail: { days },
    });
  }
  const total = due.length + duePages.length;
  if (total > 0) ctx.emit("memory.archived", ctx.space, { count: total, days });
  return { archived: total, days };
}

// ---- the Learned feed and Undo

type What = "learned" | "merged" | "flagged";

/**
 * What memory did, newest first, as far as the reader can see: facts it learned (with their source and who learned them), and what upkeep merged away or flagged. Each learned row can be undone.
 * Filters: by layer, agent or project, by the chat, run or record a fact came from (`threadId` or `sourceRef`), by the kind of actor, by what happened, and by time.
 */
export async function learned(
  ctx: MemCtx,
  input: Page & { layer?: Layer; agentId?: string; projectId?: string; since?: number; threadId?: string; sourceRef?: string; actorKind?: string; what?: What[] },
) {
  ensure(ctx.db);
  const access = makeAccess(ctx);
  const want = new Set<What>(input.what && input.what.length > 0 ? input.what : ["learned", "merged", "flagged"]);
  const actions = [...(want.has("learned") ? ["'learn'"] : []), ...(want.has("merged") ? ["'merge'"] : []), ...(want.has("flagged") ? ["'flag'"] : [])];
  if (actions.length === 0) return { items: [], total: 0 };
  const args: unknown[] = [];
  let sql = `SELECT * FROM memory_trail WHERE action IN (${actions.join(", ")}) AND fact_id IS NOT NULL`;
  if (input.since !== undefined) { sql += " AND at >= ?"; args.push(input.since); }
  if (input.actorKind) { sql += " AND actor_kind = ?"; args.push(input.actorKind); }
  sql += " ORDER BY at DESC, rowid DESC LIMIT 5000";
  const wanted = input.threadId ?? input.sourceRef;
  const items: Array<Record<string, unknown>> = [];
  const facts: Fact[] = [];
  const seen = new Set<string>();
  for (const t of rowsOf(ctx.db, sql, ...args)) {
    const id = str(t["fact_id"]);
    const what: What = str(t["action"]) === "learn" ? "learned" : str(t["action"]) === "merge" ? "merged" : "flagged";
    if (seen.has(`${what}:${id}`)) continue;
    const f = loadFact(ctx, id);
    if (!f) continue;
    seen.add(`${what}:${id}`);
    if (input.layer && f.layer !== input.layer) continue;
    if (input.agentId && f.agentId !== input.agentId) continue;
    if (input.projectId && f.projectId !== input.projectId) continue;
    if (wanted && f.sourceRef !== wanted) continue;
    if (!(await canSee(ctx, access, f))) continue;
    let detail: { from?: string; mergedInto?: string; questionId?: string } = {};
    try { detail = JSON.parse(str(t["detail"]) || "{}") as typeof detail; } catch { detail = {}; }
    const link = f.sourceLink ?? sourceLinkOf(f.sourceKind, f.sourceRef);
    facts.push(f);
    items.push({
      what, at: num(t["at"]), actor: str(t["actor"]), actorKind: str(t["actor_kind"]), sourceKind: f.sourceKind, sourceRef: f.sourceRef, ...(link ? { sourceLink: link } : {}),
      ...(what === "learned" && detail.from ? { from: detail.from } : {}), undone: what === "learned" && (f.trashedAt !== null || f.status === "removed"),
      ...(what === "merged" ? { note: detail.mergedInto ? `Merged into ${detail.mergedInto}` : "Merged as a duplicate" } : what === "flagged" ? { note: str(t["reason"]) || "Needs a look" } : {}),
      ...(what === "merged" && detail.mergedInto ? { mergedInto: detail.mergedInto } : {}), ...(what === "flagged" && detail.questionId ? { questionId: detail.questionId } : {}),
    });
  }
  const p = pageOf(items.map((it, i) => ({ it, f: facts[i]! })), input.cursor, input.limit);
  const rows = factRows(ctx, p.page.map((x) => x.f));
  return { items: p.page.map((x, i) => ({ fact: rows[i]!, ...x.it })), ...(p.next ? { next: p.next } : {}), total: p.total };
}

/** Undo what was learned: the fact goes to Trash with the reason "undone", so a restore brings it back. One call, for the person it was learned from, the owner of the place it lives, or an admin. */
export async function undo(ctx: MemCtx, input: { factId: string }) {
  ensure(ctx.db);
  const f = loadFact(ctx, input.factId);
  if (!f) raise(ctx, "validation.not_found", "There is no such fact.", { factId: input.factId });
  const access = makeAccess(ctx);
  if (!(await canSee(ctx, access, f))) raise(ctx, "validation.not_found", "There is no such fact.", { factId: input.factId });
  const learnt = rowsOf(ctx.db, "SELECT id FROM memory_trail WHERE action = 'learn' AND fact_id = ? LIMIT 1", f.id)[0];
  if (!learnt) raise(ctx, "validation.precondition_failed", "Only a fact memory learned can be undone this way. Remove it instead.", { factId: f.id });
  const mayChange = f.layer === "person" ? f.ownerRef === actorOf(ctx) : (await access.can(f.layer, f.ownerRef, f.agentId, f.projectId, "edit")) || f.sourcePerson === actorOf(ctx) || access.isAdmin();
  if (!mayChange) raise(ctx, "permission.no_grant", "You cannot change this memory.");
  if (f.trashedAt !== null) return { fact: factOut(f), trashed: false };
  trashFact(ctx, f, { reason: "undone", action: "undo" });
  ctx.emit("memory.removed", actorOf(ctx), { factIds: [f.id], by: actorOf(ctx) });
  const after = loadFact(ctx, f.id) ?? f;
  return { fact: factOut({ ...after, text: f.text }), trashed: true };
}

// ---- the trail

export async function trailRead(ctx: MemCtx, input: Page & { factId?: string; pageId?: string; action?: string; actor?: string; since?: number }) {
  ensure(ctx.db);
  const access = makeAccess(ctx);
  const args: unknown[] = [];
  let sql = "SELECT * FROM memory_trail WHERE 1 = 1";
  if (input.factId) { sql += " AND fact_id = ?"; args.push(input.factId); }
  if (input.pageId) { sql += " AND page_id = ?"; args.push(input.pageId); }
  if (input.action) { sql += " AND action = ?"; args.push(input.action); }
  if (input.actor) { sql += " AND (actor = ? OR acting_for = ?)"; args.push(input.actor, input.actor); }
  if (input.since !== undefined) { sql += " AND at >= ?"; args.push(input.since); }
  sql += " ORDER BY at DESC, rowid DESC LIMIT 5000";
  const memo = new Map<string, boolean>();
  const rows: Array<Record<string, unknown>> = [];
  for (const r of rowsOf(ctx.db, sql, ...args)) {
    const layer = orNull(r["layer"]) as Layer | null;
    if (layer) {
      const owner = str(r["owner_ref"]);
      const key = `${layer}|${owner}|${str(r["agent_id"])}|${str(r["project_id"])}`;
      let ok = memo.get(key);
      if (ok === undefined) {
        ok = layer === "person" ? owner === actorOf(ctx) : await access.can(layer, owner, orNull(r["agent_id"]), orNull(r["project_id"]), "view");
        memo.set(key, ok);
      }
      if (!ok) continue;
    }
    rows.push(trailOut(r));
  }
  const p = pageOf(rows, input.cursor, input.limit);
  return { rows: p.page, ...(p.next ? { next: p.next } : {}), total: p.total };
}

function trailOut(r: Row): Record<string, unknown> {
  let detail: unknown;
  try { detail = r["detail"] ? JSON.parse(str(r["detail"])) : undefined; } catch { detail = undefined; }
  const opt = (k: string, v: unknown): Record<string, unknown> => (v === null || v === undefined || v === "" ? {} : { [k]: v });
  return {
    id: str(r["id"]), at: num(r["at"]), action: str(r["action"]), actor: str(r["actor"]), actorKind: str(r["actor_kind"]),
    ...opt("factId", r["fact_id"]), ...opt("pageId", r["page_id"]), ...opt("layer", r["layer"]), ...opt("actingFor", r["acting_for"]), ...opt("source", r["source"]), ...opt("reason", r["reason"]),
    ...opt("runId", r["run_id"]), ...opt("detail", detail),
  };
}
