// memory facts (spec 2.15, 4.15; ARCH 6.10): propose, accept, reject, correct, remove, erase; search, facts as of a date, lists, counts and layers; the pointer block;
// promotion to a shared layer with its task; capture at chat end and the nightly job; the note reads (read_note, versions, restore) and find_by_subject.
// Facts are rows in memory_facts and are never overwritten: a change closes the old row (valid_to, closed_at) and adds a new one. Person-layer text is sealed under its owner.
// DECISION: where a fact lands follows "who accepts what" in spec 2.15: channel facts go straight to the project layer, run and Journey facts wait in proposed for the agent owner,
//   everything from a chat goes to the asker's own layer and merges on its own only for a kind in the setting memory.auto_merge_kinds (default preference), or when the person typed it themselves.
// DECISION: search is local and has no model call: BM25 over words, character trigrams for the "semantic" side, a small recency lift. The vector table of ARCH 6.10 is the same call shape and slots in later.
import { excerpt } from "../../../lib/md.ts";
import {
  actorOf, autoMergeKinds, bm25, ensure, factOut, liveNow, loadFact, makeAccess, mintId, num, orNull, ownerOfLayer, pageOf, raise, readFact, recencyBoost, rowsOf, sealText, snippet, sourceLinkOf,
  str, tokens, trigramSim,
} from "../projections.ts";
import type { Access, Fact, FactStatus, Layer, MemCtx, Row, SourceKind } from "../projections.ts";

const LAYERS: readonly Layer[] = ["person", "agent", "project", "space"];

type Page = { cursor?: string; limit?: number };

// ---- shared pieces

interface NewFact {
  layer: Layer; ownerRef: string; agentId: string | null; projectId: string | null; noteId?: string | null; kind: string | null; text: string; validFrom: number;
  sourceKind: SourceKind; sourceRef: string; sourcePerson: string; proposedBy: string; status: FactStatus; lowRisk: boolean; replaces?: string | null;
  promotedFrom?: string | null; promotedBy?: string | null; promotedAt?: number | null; links?: Array<[string, string]>;
}

/** Insert one fact row (sealed when it is a person-layer fact) and its source links. */
function insertFact(ctx: MemCtx, n: NewFact): Fact {
  const id = mintId("fct", ctx.now());
  const sealed = n.layer === "person";
  const link = sourceLinkOf(n.sourceKind, n.sourceRef);
  const subject = n.sourceKind === "record" ? n.sourceRef : null;
  ctx.db.run(
    "INSERT INTO memory_facts (id, layer, owner_ref, agent_id, project_id, note_id, kind, text, sealed, enc, valid_from, valid_to, learned_at, closed_at, source_kind, source_ref, source_link, source_person, proposed_by, status, low_risk, subject, replaces, promoted_from, promoted_by, promoted_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, n.layer, n.ownerRef, n.agentId, n.projectId, n.noteId ?? null, n.kind, sealed ? "" : n.text, sealed ? sealText(ctx, n.ownerRef, n.text) : null, sealed ? 2 : 0, n.validFrom,
    ctx.now(), n.sourceKind, n.sourceRef, link, n.sourcePerson, n.proposedBy, n.status, n.lowRisk ? 1 : 0, subject, n.replaces ?? null, n.promotedFrom ?? null, n.promotedBy ?? null, n.promotedAt ?? null,
  );
  ctx.db.run("INSERT OR IGNORE INTO memory_fact_links (fact_id, kind, ref) VALUES (?, 'came_from', ?)", id, n.sourceRef);
  for (const [k, ref] of n.links ?? []) ctx.db.run("INSERT OR IGNORE INTO memory_fact_links (fact_id, kind, ref) VALUES (?, ?, ?)", id, k, ref);
  const f = loadFact(ctx, id);
  if (!f) raise(ctx, "internal.unexpected", "The fact was not saved.");
  f.text = n.text;
  return f;
}

const normal = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** A live or waiting fact with the same text in the same place, so saving it twice does nothing. */
function duplicateOf(ctx: MemCtx, layer: Layer, owner: string, agentId: string | null, projectId: string | null, text: string): Fact | null {
  const rows = rowsOf(
    ctx.db,
    "SELECT * FROM memory_facts WHERE layer = ? AND owner_ref = ? AND COALESCE(agent_id, '') = ? AND COALESCE(project_id, '') = ? AND status IN ('proposed', 'current')",
    layer, owner, agentId ?? "", projectId ?? "",
  );
  const want = normal(text);
  for (const r of rows) {
    const f = readFact(ctx, r);
    if (f.text !== "" && normal(f.text) === want) return f;
  }
  return null;
}

function emitProposed(ctx: MemCtx, f: Fact): void {
  ctx.emit("memory.fact_proposed", f.id, {
    factId: f.id, layer: f.layer, ownerRef: f.ownerRef, ...(f.agentId ? { agentId: f.agentId } : {}), sourceKind: f.sourceKind, sourceRef: f.sourceRef,
  });
}

function emitAccepted(ctx: MemCtx, f: Fact, auto: boolean): void {
  ctx.emit("memory.fact_accepted", f.id, { factId: f.id, layer: f.layer, auto });
}

/** Who may change this fact: a person layer only its owner, a shared layer anyone with edit on it. */
async function mayEdit(access: Access, f: Fact): Promise<boolean> {
  return access.can(f.layer, f.ownerRef, f.agentId, f.projectId, "edit");
}

function needFact(ctx: MemCtx, id: string, missing: ErrorKind = "validation.bad_input"): Fact {
  const f = loadFact(ctx, id);
  if (!f) raise(ctx, missing, "There is no such fact.", { factId: id });
  return f;
}
type ErrorKind = "validation.bad_input" | "validation.not_found";

async function needEdit(ctx: MemCtx, access: Access, f: Fact): Promise<void> {
  if (!(await mayEdit(access, f))) raise(ctx, "permission.no_grant", "You cannot change this memory.");
}

async function readableFacts(ctx: MemCtx, access: Access, rows: Row[]): Promise<Fact[]> {
  const me = actorOf(ctx);
  const out: Fact[] = [];
  for (const r of rows) {
    const f = readFact(ctx, r);
    if (f.layer === "person" && f.ownerRef !== me) continue;
    if (await access.can(f.layer, f.ownerRef, f.agentId, f.projectId, "view")) out.push(f);
  }
  return out;
}

// ---- propose

interface ProposeIn {
  layer?: Layer; agentId?: string; projectId?: string; text: string; validFrom?: number; sourceKind: SourceKind; sourceRef: string; threadId?: string; kind?: string;
}

export async function proposeFact(ctx: MemCtx, input: ProposeIn) {
  ensure(ctx.db);
  const actor = actorOf(ctx);
  const text = input.text.trim();
  if (text === "") raise(ctx, "validation.bad_input", "A fact needs some text.");
  const access = makeAccess(ctx);
  const agentId = input.agentId ?? null;
  const projectId = input.projectId ?? null;
  const layer: Layer = input.layer ?? (input.sourceKind === "channel" && projectId ? "project" : input.sourceKind === "run" || input.sourceKind === "journey" ? "agent" : "person");
  if (layer === "agent" && !agentId) raise(ctx, "validation.bad_input", "Name the agent this fact belongs to.");
  if (layer === "project" && !projectId) raise(ctx, "validation.bad_input", "Name the project this fact belongs to.");
  const owner = ownerOfLayer(ctx, layer, actor, agentId, projectId);
  if (!(await access.can(layer, owner, agentId, projectId, "view"))) raise(ctx, "permission.no_grant", "You cannot add to this memory.");

  const dup = duplicateOf(ctx, layer, owner, layer === "project" ? null : agentId, layer === "project" ? projectId : null, text);
  if (dup) return { fact: factOut(dup), merged: dup.status === "current" };

  const low = input.kind !== undefined && (await autoMergeKinds(ctx)).includes(input.kind);
  let status: FactStatus = "proposed";
  if (input.sourceKind === "run" || input.sourceKind === "journey") status = "proposed";
  else if (layer === "project" && input.sourceKind === "channel") status = "current";
  else if (layer === "person") status = low || (input.sourceKind === "manual" && ctx.principal.kind === "person") ? "current" : "proposed";
  else if (low && (await access.can(layer, owner, agentId, projectId, "edit"))) status = "current";

  const f = insertFact(ctx, {
    layer, ownerRef: owner, agentId: layer === "project" ? null : agentId, projectId: layer === "project" ? projectId : null, kind: input.kind ?? null, text,
    validFrom: input.validFrom ?? ctx.now(), sourceKind: input.sourceKind, sourceRef: input.sourceRef, sourcePerson: actor, proposedBy: ctx.principal.id, status, lowRisk: low,
    ...(input.threadId ? { links: [["thread", input.threadId]] as Array<[string, string]> } : {}),
  });
  emitProposed(ctx, f);
  if (status === "current") emitAccepted(ctx, f, true);
  return { fact: factOut(f), merged: status === "current" };
}

// ---- accept, reject, correct, remove, erase

export async function factAccept(ctx: MemCtx, input: { factId: string }) {
  ensure(ctx.db);
  const f = needFact(ctx, input.factId);
  await needEdit(ctx, makeAccess(ctx), f);
  if (f.status !== "proposed") raise(ctx, "validation.precondition_failed", "Only a proposed fact can be accepted.", { status: f.status });
  ctx.db.run("UPDATE memory_facts SET status = 'current' WHERE id = ?", f.id);
  emitAccepted(ctx, f, false);
  return { fact: factOut({ ...f, status: "current" }) };
}

export async function factReject(ctx: MemCtx, input: { factId: string }) {
  ensure(ctx.db);
  const f = needFact(ctx, input.factId);
  await needEdit(ctx, makeAccess(ctx), f);
  if (f.status !== "proposed") raise(ctx, "validation.bad_input", "Only a proposed fact can be rejected.", { status: f.status });
  ctx.db.run("UPDATE memory_facts SET status = 'removed', closed_at = ? WHERE id = ?", ctx.now(), f.id);
  ctx.emit("memory.fact_rejected", f.id, { factId: f.id, by: actorOf(ctx) });
  return { fact: factOut({ ...f, status: "removed", closedAt: ctx.now() }) };
}

export async function factCorrect(ctx: MemCtx, input: { factId: string; text: string; validFrom?: number }) {
  ensure(ctx.db);
  const old = needFact(ctx, input.factId);
  await needEdit(ctx, makeAccess(ctx), old);
  const text = input.text.trim();
  if (text === "") raise(ctx, "validation.bad_input", "A fact needs some text.");
  if (old.status !== "current" && old.status !== "proposed") raise(ctx, "validation.bad_input", "Only a live fact can be corrected.", { status: old.status });
  const now = ctx.now();
  ctx.db.run("UPDATE memory_facts SET status = 'closed', valid_to = ?, closed_at = ? WHERE id = ?", now, now, old.id);
  const fresh = insertFact(ctx, {
    layer: old.layer, ownerRef: old.ownerRef, agentId: old.agentId, projectId: old.projectId, noteId: old.noteId, kind: old.kind, text, validFrom: input.validFrom ?? now,
    sourceKind: "manual", sourceRef: old.id, sourcePerson: actorOf(ctx), proposedBy: ctx.principal.id, status: "current", lowRisk: false, replaces: old.id,
  });
  ctx.emit("memory.fact_corrected", fresh.id, { factId: fresh.id, closedFactId: old.id, by: actorOf(ctx) });
  return { fact: factOut(fresh), closed: factOut({ ...old, status: "closed", validTo: now, closedAt: now }) };
}

export async function factsRemove(ctx: MemCtx, input: { factIds?: string[]; scope?: { layer: Layer; agentId?: string; fromMe?: boolean } }) {
  ensure(ctx.db);
  const access = makeAccess(ctx);
  const me = actorOf(ctx);
  let rows: Row[] = [];
  if (input.factIds && input.factIds.length > 0) {
    for (const id of input.factIds) rows.push(...rowsOf(ctx.db, "SELECT * FROM memory_facts WHERE id = ?", id));
  } else if (input.scope) {
    const s = input.scope;
    const args: unknown[] = [s.layer];
    let sql = "SELECT * FROM memory_facts WHERE layer = ? AND status IN ('proposed', 'current')";
    if (s.layer === "person") { sql += " AND owner_ref = ?"; args.push(me); }
    if (s.agentId) { sql += " AND agent_id = ?"; args.push(s.agentId); }
    if (s.fromMe) { sql += " AND source_person = ?"; args.push(me); }
    rows = rowsOf(ctx.db, sql, ...args);
  } else raise(ctx, "validation.bad_input", "Name the facts to remove, or a layer.");
  const now = ctx.now();
  const removed: string[] = [];
  for (const r of rows) {
    const f = readFact(ctx, r);
    if (f.status === "removed") continue;
    if (!(await mayEdit(access, f))) {
      if (input.factIds) raise(ctx, "permission.no_grant", "You cannot change this memory.");
      continue;
    }
    ctx.db.run("UPDATE memory_facts SET status = 'removed', closed_at = ?, valid_to = COALESCE(valid_to, ?) WHERE id = ?", now, now, f.id);
    removed.push(f.id);
  }
  if (removed.length > 0) ctx.emit("memory.removed", me, { factIds: removed, by: me });
  return { removed: removed.length };
}

export async function erase(ctx: MemCtx, input: { factIds?: string[]; scope?: { layer: Layer; agentId?: string; sourceRef?: string; subject?: string }; reason?: string }) {
  ensure(ctx.db);
  const me = actorOf(ctx);
  const access = makeAccess(ctx);
  let rows: Row[] = [];
  if (input.factIds && input.factIds.length > 0) {
    for (const id of input.factIds) rows.push(...rowsOf(ctx.db, "SELECT * FROM memory_facts WHERE id = ?", id));
  } else if (input.scope) {
    const s = input.scope;
    const args: unknown[] = [s.layer];
    let sql = "SELECT * FROM memory_facts WHERE layer = ?";
    if (s.agentId) { sql += " AND agent_id = ?"; args.push(s.agentId); }
    if (s.sourceRef) { sql += " AND source_ref = ?"; args.push(s.sourceRef); }
    if (s.subject) { sql += " AND (subject = ? OR source_ref = ?)"; args.push(s.subject, s.subject); }
    rows = rowsOf(ctx.db, sql, ...args);
  } else raise(ctx, "validation.bad_input", "Name the facts to erase, or a layer.");
  // Open to the source person or an admin. Nothing is read here, so an admin can erase a person-layer row without ever opening it.
  const admin = access.isAdmin();
  const ids: string[] = [];
  for (const r of rows) {
    const mine = str(r["source_person"]) === me || str(r["owner_ref"]) === me;
    if (mine || admin) ids.push(str(r["id"]));
  }
  if (rows.length > 0 && ids.length === 0) raise(ctx, "permission.no_grant", "Only the person the fact came from, or an admin, can erase it.");
  // A promoted copy goes with its source.
  const all = new Set(ids);
  for (let grew = true; grew;) {
    grew = false;
    for (const id of [...all]) {
      for (const c of rowsOf(ctx.db, "SELECT id FROM memory_facts WHERE promoted_from = ?", id)) {
        if (!all.has(str(c["id"]))) { all.add(str(c["id"])); grew = true; }
      }
    }
  }
  for (const id of all) {
    ctx.db.run("DELETE FROM memory_fact_links WHERE fact_id = ?", id);
    ctx.db.run("DELETE FROM memory_promotions WHERE fact_id = ?", id);
    ctx.db.run("DELETE FROM memory_facts WHERE id = ?", id);
  }
  ctx.emit("memory.erased", me, { count: all.size, by: me, ...(input.scope ? { scope: input.scope.layer } : {}) });
  return { erased: all.size };
}

// ---- reads

export async function factGet(ctx: MemCtx, input: { factId: string }) {
  ensure(ctx.db);
  const f = needFact(ctx, input.factId, "validation.not_found");
  const access = makeAccess(ctx);
  if (f.layer === "person" ? f.ownerRef !== actorOf(ctx) : !(await access.can(f.layer, f.ownerRef, f.agentId, f.projectId, "view"))) {
    raise(ctx, "validation.not_found", "There is no such fact.", { factId: input.factId });
  }
  const history: Fact[] = [];
  const seen = new Set<string>([f.id]);
  for (let cur = f.replaces; cur && !seen.has(cur);) {
    seen.add(cur);
    const prev = loadFact(ctx, cur);
    if (!prev) break;
    history.push(prev);
    cur = prev.replaces;
  }
  return { fact: factOut(f), history: history.map(factOut) };
}

export async function factsList(
  ctx: MemCtx,
  input: Page & { layer?: Layer; agentId?: string; projectId?: string; status?: FactStatus[]; fromMe?: boolean; q?: string },
) {
  ensure(ctx.db);
  const me = actorOf(ctx);
  const status = input.status && input.status.length > 0 ? input.status : (["current", "proposed"] as FactStatus[]);
  const args: unknown[] = [];
  let sql = `SELECT * FROM memory_facts WHERE status IN (${status.map(() => "?").join(", ")}) AND (layer != 'person' OR owner_ref = ?)`;
  args.push(...status, me);
  if (input.layer) { sql += " AND layer = ?"; args.push(input.layer); }
  if (input.agentId) { sql += " AND agent_id = ?"; args.push(input.agentId); }
  if (input.projectId) { sql += " AND project_id = ?"; args.push(input.projectId); }
  if (input.fromMe) { sql += " AND source_person = ?"; args.push(me); }
  sql += " ORDER BY learned_at DESC, id";
  let facts = await readableFacts(ctx, makeAccess(ctx), rowsOf(ctx.db, sql, ...args));
  if (input.q && input.q.trim() !== "") {
    const needle = input.q.trim().toLowerCase();
    facts = facts.filter((f) => f.text.toLowerCase().includes(needle));
  }
  const p = pageOf(facts, input.cursor, input.limit);
  return { facts: p.page.map(factOut), ...(p.next ? { next: p.next } : {}), total: p.total };
}

export async function factsAsOf(ctx: MemCtx, input: Page & { date: number; agentId?: string; layer?: Layer; q?: string }) {
  ensure(ctx.db);
  const me = actorOf(ctx);
  const args: unknown[] = [input.date, input.date, me];
  let sql = "SELECT * FROM memory_facts WHERE status IN ('current', 'closed') AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?) AND (layer != 'person' OR owner_ref = ?)";
  if (input.layer) { sql += " AND layer = ?"; args.push(input.layer); }
  if (input.agentId) { sql += " AND (agent_id = ? OR layer IN ('project', 'space'))"; args.push(input.agentId); }
  sql += " ORDER BY valid_from DESC, id";
  let facts = await readableFacts(ctx, makeAccess(ctx), rowsOf(ctx.db, sql, ...args));
  if (input.q && input.q.trim() !== "") {
    const needle = input.q.trim().toLowerCase();
    facts = facts.filter((f) => f.text.toLowerCase().includes(needle));
  }
  const p = pageOf(facts, input.cursor, input.limit);
  return { facts: p.page.map(factOut), ...(p.next ? { next: p.next } : {}), total: p.total };
}

export async function layersList(ctx: MemCtx, input: { agentId?: string; projectId?: string }) {
  const access = makeAccess(ctx);
  const out: Array<{ layer: Layer; title: string; readable: boolean; writable: boolean; private: boolean }> = [
    { layer: "person", title: "Your memory", readable: true, writable: true, private: true },
  ];
  if (input.agentId) {
    out.push({
      layer: "agent", title: "Agent", readable: await access.can("agent", input.agentId, input.agentId, null, "view"), writable: await access.can("agent", input.agentId, input.agentId, null, "edit"), private: false,
    });
  }
  if (input.projectId) {
    out.push({
      layer: "project", title: "Project", readable: await access.can("project", input.projectId, null, input.projectId, "view"), writable: await access.can("project", input.projectId, null, input.projectId, "edit"), private: false,
    });
  }
  out.push({ layer: "space", title: "Space", readable: await access.can("space", ctx.space, null, null, "view"), writable: await access.can("space", ctx.space, null, null, "edit"), private: false });
  return { layers: out };
}

export async function counts(ctx: MemCtx, input: { agentId: string }) {
  ensure(ctx.db);
  const me = actorOf(ctx);
  const access = makeAccess(ctx);
  const rows = rowsOf(
    ctx.db,
    "SELECT * FROM memory_facts WHERE agent_id = ? AND layer IN ('person', 'agent') AND status IN ('current', 'proposed') AND (layer != 'person' OR owner_ref = ?)",
    input.agentId, me,
  );
  const facts = await readableFacts(ctx, access, rows);
  const now = ctx.now();
  return {
    current: facts.filter((f) => liveNow(f, now)).length,
    proposed: facts.filter((f) => f.status === "proposed").length,
    fromMe: facts.filter((f) => liveNow(f, now) && f.sourcePerson === me).length,
  };
}

// ---- search

interface Doc { kind: "fact" | "note"; id: string; title: string; text: string; layer: Layer; path: string | null; since: number | null; link: string | null; learnedAt: number }

const factTitle = (f: Fact): string => (f.kind ? `${f.kind.slice(0, 1).toUpperCase()}${f.kind.slice(1)}` : "Fact");

/** The notes the caller may read, as documents. Person-layer notes are indexed by sealed title only. */
async function noteDocs(ctx: MemCtx, access: Access, agentId: string | undefined, projectId: string | undefined): Promise<Array<Doc & { noteId: string }>> {
  const me = actorOf(ctx);
  const out: Array<Doc & { noteId: string }> = [];
  const args: unknown[] = [me];
  let sql = "SELECT * FROM memory_notes WHERE (layer != 'person' OR owner_ref = ?)";
  if (agentId) { sql += " AND (agent_id = ? OR layer IN ('project', 'space'))"; args.push(agentId); }
  if (projectId) { sql += " AND (project_id = ? OR layer != 'project')"; args.push(projectId); }
  for (const r of rowsOf(ctx.db, sql, ...args)) {
    const layer = str(r["layer"]) as Layer;
    if (!(await access.can(layer, str(r["owner_ref"]), orNull(r["agent_id"]), orNull(r["project_id"]), "view"))) continue;
    let title = str(r["title"]);
    const sealed = orNull(r["sealed_title"]);
    if (layer === "person" && sealed) {
      try { title = readTitle(ctx, sealed); } catch { continue; }
    }
    out.push({
      kind: "note", id: str(r["note_id"]), noteId: str(r["note_id"]), title, text: layer === "person" ? "" : str(r["body"]), layer, path: str(r["path"]), since: null, link: `/files/${str(r["file_id"])}`,
      learnedAt: num(r["updated_at"]),
    });
  }
  return out;
}

function readTitle(ctx: MemCtx, sealed: string): string {
  return readFact(ctx, { layer: "person", owner_ref: actorOf(ctx), enc: 2, sealed, text: "" }).text;
}

async function factDocs(ctx: MemCtx, access: Access, agentId: string | undefined, projectId: string | undefined): Promise<Doc[]> {
  const now = ctx.now();
  const args: unknown[] = [now, actorOf(ctx)];
  let sql = "SELECT * FROM memory_facts WHERE status = 'current' AND (valid_to IS NULL OR valid_to > ?) AND (layer != 'person' OR owner_ref = ?)";
  if (agentId) { sql += " AND (agent_id = ? OR layer IN ('project', 'space'))"; args.push(agentId); }
  if (projectId) { sql += " AND (project_id = ? OR layer != 'project')"; args.push(projectId); }
  const paths = new Map<string, string>();
  const docs: Doc[] = [];
  for (const f of await readableFacts(ctx, access, rowsOf(ctx.db, sql, ...args))) {
    let path: string | null = null;
    if (f.noteId) {
      if (!paths.has(f.noteId)) paths.set(f.noteId, str(rowsOf(ctx.db, "SELECT path FROM memory_notes WHERE note_id = ?", f.noteId)[0]?.["path"]));
      path = paths.get(f.noteId) || null;
    }
    docs.push({ kind: "fact", id: f.id, title: factTitle(f), text: f.text, layer: f.layer, path, since: f.validFrom, link: f.sourceLink, learnedAt: f.learnedAt });
  }
  return docs;
}

export async function search(
  ctx: MemCtx,
  input: { q: string; layers?: Layer[]; agentId?: string; projectId?: string; mode?: "keyword" | "semantic" | "hybrid"; limit?: number },
) {
  const t0 = performance.now();
  ensure(ctx.db);
  const q = input.q.trim();
  if (q === "") raise(ctx, "validation.bad_input", "Ask for something to look up.");
  const access = makeAccess(ctx);
  const layers = new Set<Layer>(input.layers && input.layers.length > 0 ? input.layers : LAYERS);
  const docs = [...(await factDocs(ctx, access, input.agentId, input.projectId)), ...(await noteDocs(ctx, access, input.agentId, input.projectId))].filter((d) => layers.has(d.layer));
  const mode = input.mode ?? "hybrid";
  const ranked = bm25(docs, q);
  const top = Math.max(0, ...ranked.map((r) => r.score));
  const now = ctx.now();
  const hits: Array<{ doc: Doc; score: number }> = [];
  docs.forEach((d, i) => {
    const r = ranked[i]!;
    const sim = trigramSim(q, `${d.title} ${d.text}`);
    let score = 0;
    if (mode === "keyword") score = r.matched > 0 ? r.score : 0;
    else if (mode === "semantic") score = sim >= 0.12 ? sim : 0;
    else if (r.matched > 0 || sim >= 0.25) score = (top > 0 ? 0.65 * (r.score / top) : 0) + 0.35 * sim;
    if (score > 0 && d.kind === "fact") score += recencyBoost(d.learnedAt, now) * (mode === "keyword" ? top / 10 : 0.1);
    if (score > 0) hits.push({ doc: d, score });
  });
  hits.sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id));
  const limit = input.limit ?? 10;
  return {
    hits: hits.slice(0, limit).map(({ doc, score }) => ({
      kind: doc.kind,
      ...(doc.kind === "fact" ? { factId: doc.id } : { noteId: doc.id }),
      title: doc.title, text: snippet(doc.text || doc.title, q), ...(doc.path ? { path: doc.path } : {}), ...(doc.since !== null ? { trueSince: doc.since } : {}), layer: doc.layer,
      ...(doc.link ? { sourceLink: doc.link } : {}), score: Math.round(score * 10_000) / 10_000,
    })),
    tookMs: Math.max(0, Math.round(performance.now() - t0)),
  };
}

// ---- pointer block

const ACK = new Set(["ok", "okay", "k", "thanks", "thank", "thx", "ty", "yes", "yep", "yeah", "yup", "sure", "great", "cool", "nice", "done", "perfect", "good", "fine", "nope", "no", "got", "it", "sounds", "right", "alright", "lgtm", "please", "you", "much", "lot", "very", "so", "that", "works", "will", "do"]);
/** A line is shown only when it covers enough of the question and what it matches is not just common words. The 50-question proof set tuned these. */
export const POINTER_MIN_COVERAGE = 0.3;
export const POINTER_MIN_MASS = 0.8;
export const POINTER_MAX_LINES = 5;
export const POINTER_MAX_TOKENS = 350;

export interface PointerLine { title: string; fact?: string; trueSince?: number; path: string }
export interface PointerOut { lines: PointerLine[]; tokens: number; skipped?: "short_ack" | "mid_tool_loop" | "no_match" | "duplicate" }

export async function pointer(ctx: MemCtx, input: { threadId: string; agentId: string; text: string; sinceIdx?: number }): Promise<PointerOut> {
  ensure(ctx.db);
  const text = input.text.trim();
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (text.length < 3 || (words.length <= 4 && words.every((w) => ACK.has(w)))) return { lines: [], tokens: 0, skipped: "short_ack" as const };
  // The engine passes the index of the message a pointer is for; the same index again means a tool-loop step of the same turn.
  if (input.sinceIdx !== undefined) {
    const last = rowsOf(ctx.db, "SELECT last_idx FROM memory_pointer_state WHERE thread_id = ?", input.threadId)[0];
    if (last && num(last["last_idx"]) === input.sinceIdx) return { lines: [], tokens: 0, skipped: "mid_tool_loop" as const };
    ctx.db.run("INSERT OR REPLACE INTO memory_pointer_state (thread_id, last_idx) VALUES (?, ?)", input.threadId, input.sinceIdx);
  }
  const access = makeAccess(ctx);
  const docs = [...(await factDocs(ctx, access, input.agentId, undefined)), ...(await noteDocs(ctx, access, input.agentId, undefined))];
  const ranked = bm25(docs, text);
  const order = docs
    .map((d, i) => ({ d, r: ranked[i]! }))
    .filter(({ r }) => r.matched >= 1 && r.coverage >= POINTER_MIN_COVERAGE && r.mass >= POINTER_MIN_MASS)
    .sort((a, b) => b.r.score - a.r.score || a.d.id.localeCompare(b.d.id));
  if (order.length === 0) return { lines: [], tokens: 0, skipped: "no_match" as const };
  const shown = new Set(rowsOf(ctx.db, "SELECT ref FROM memory_pointer_log WHERE thread_id = ?", input.threadId).map((r) => str(r["ref"])));
  const lines: PointerLine[] = [];
  let tokenCount = 0;
  for (const { d } of order) {
    if (lines.length >= POINTER_MAX_LINES) break;
    const ref = `${d.kind}:${d.id}`;
    if (shown.has(ref)) continue;
    const line: PointerLine = d.kind === "fact"
      ? { title: d.title, fact: d.text.length > 160 ? `${d.text.slice(0, 157)}...` : d.text, ...(d.since !== null ? { trueSince: d.since } : {}), path: d.path ?? `memory/${d.layer}` }
      : { title: d.title, path: d.path ?? `memory/${d.layer}` };
    const cost = Math.ceil((line.title.length + (line.fact?.length ?? 0) + line.path.length + 12) / 4);
    if (tokenCount + cost > POINTER_MAX_TOKENS && lines.length > 0) break;
    tokenCount += cost;
    lines.push(line);
    shown.add(ref);
    ctx.db.run("INSERT OR IGNORE INTO memory_pointer_log (thread_id, ref, at) VALUES (?, ?, ?)", input.threadId, ref, ctx.now());
  }
  if (lines.length === 0) return { lines: [], tokens: 0, skipped: "duplicate" as const };
  return { lines, tokens: tokenCount };
}

// ---- notes: list, read, versions, restore

function noteRowOut(ctx: MemCtx, r: Row): { noteId: string; path: string; title: string; layer: Layer; agentId?: string; updatedAt: number } | null {
  const layer = str(r["layer"]) as Layer;
  let title = str(r["title"]);
  const sealed = orNull(r["sealed_title"]);
  if (layer === "person") {
    if (str(r["owner_ref"]) !== actorOf(ctx) || !sealed) return null;
    try { title = readTitle(ctx, sealed); } catch { return null; }
  }
  const agentId = orNull(r["agent_id"]);
  return { noteId: str(r["note_id"]), path: str(r["path"]), title, layer, ...(agentId ? { agentId } : {}), updatedAt: num(r["updated_at"]) };
}

async function readableNote(ctx: MemCtx, access: Access, noteId: string, missing: ErrorKind): Promise<Row> {
  const r = rowsOf(ctx.db, "SELECT * FROM memory_notes WHERE note_id = ?", noteId)[0];
  if (!r) raise(ctx, missing, "There is no such note.", { noteId });
  const layer = str(r["layer"]) as Layer;
  if (!(await access.can(layer, str(r["owner_ref"]), orNull(r["agent_id"]), orNull(r["project_id"]), "view"))) raise(ctx, missing, "There is no such note.", { noteId });
  return r;
}

export async function notesList(ctx: MemCtx, input: Page & { agentId?: string; projectId?: string; layer?: Layer; area?: "notes" | "proposed" | "recipes" | "journal" }) {
  ensure(ctx.db);
  const access = makeAccess(ctx);
  const args: unknown[] = [actorOf(ctx)];
  let sql = "SELECT * FROM memory_notes WHERE (layer != 'person' OR owner_ref = ?)";
  if (input.agentId) { sql += " AND agent_id = ?"; args.push(input.agentId); }
  if (input.projectId) { sql += " AND project_id = ?"; args.push(input.projectId); }
  if (input.layer) { sql += " AND layer = ?"; args.push(input.layer); }
  if (input.area) { sql += " AND area = ?"; args.push(input.area); }
  sql += " ORDER BY updated_at DESC, note_id";
  const notes: NonNullable<ReturnType<typeof noteRowOut>>[] = [];
  for (const r of rowsOf(ctx.db, sql, ...args)) {
    if (!(await access.can(str(r["layer"]) as Layer, str(r["owner_ref"]), orNull(r["agent_id"]), orNull(r["project_id"]), "view"))) continue;
    const row = noteRowOut(ctx, r);
    if (row) notes.push(row);
  }
  const p = pageOf(notes, input.cursor, input.limit);
  return { notes: p.page, ...(p.next ? { next: p.next } : {}), total: p.total };
}

export async function readNote(ctx: MemCtx, input: { noteId: string }) {
  ensure(ctx.db);
  const r = await readableNote(ctx, makeAccess(ctx), input.noteId, "validation.not_found");
  const note = noteRowOut(ctx, r);
  if (!note) raise(ctx, "validation.not_found", "There is no such note.", { noteId: input.noteId });
  const file = (await ctx.call("files.read", { fileId: str(r["file_id"]), as: "text" })) as { text?: string };
  return { note, markdown: file.text ?? "" };
}

export async function versions(ctx: MemCtx, input: { noteId: string }) {
  ensure(ctx.db);
  const r = await readableNote(ctx, makeAccess(ctx), input.noteId, "validation.not_found");
  const out = (await ctx.call("files.versions", { fileId: str(r["file_id"]) })) as { versions: Array<{ versionId: string; n: number; by: string; at: number; reason?: string; name?: string }> };
  return { versions: out.versions.map((v) => ({ versionId: v.versionId, n: v.n, by: v.by, at: v.at, ...(v.reason ? { reason: v.reason } : {}), ...(v.name ? { name: v.name } : {}) })) };
}

export async function restoreVersion(ctx: MemCtx, input: { noteId: string; versionId: string }) {
  ensure(ctx.db);
  const access = makeAccess(ctx);
  const r = await readableNote(ctx, access, input.noteId, "validation.not_found");
  const layer = str(r["layer"]) as Layer;
  // Shared memory only: a person's own notes have no owner or admin above them to restore for.
  if (layer === "person") raise(ctx, "permission.no_grant", "Personal memory is restored by its owner in Files.");
  if (!(await access.can(layer, str(r["owner_ref"]), orNull(r["agent_id"]), orNull(r["project_id"]), "edit"))) raise(ctx, "permission.no_grant", "Owners and admins restore shared memory.");
  await ctx.call("files.restore_version", { fileId: str(r["file_id"]), versionId: input.versionId });
  ctx.db.run("UPDATE memory_notes SET updated_at = ? WHERE note_id = ?", ctx.now(), input.noteId);
  ctx.emit("memory.note_restored", str(r["file_id"]), { noteId: input.noteId, versionId: input.versionId, by: actorOf(ctx) });
  const fresh = rowsOf(ctx.db, "SELECT * FROM memory_notes WHERE note_id = ?", input.noteId)[0]!;
  const note = noteRowOut(ctx, fresh);
  if (!note) raise(ctx, "validation.not_found", "There is no such note.", { noteId: input.noteId });
  return { note };
}

export async function findBySubject(ctx: MemCtx, input: Page & { subject: string }) {
  ensure(ctx.db);
  const subject = input.subject.trim();
  if (subject === "") raise(ctx, "validation.bad_input", "Name the subject to look for.");
  if (!makeAccess(ctx).isAdmin()) raise(ctx, "permission.role_lacks_permission", "Looking up a subject across memory needs the memory admin permission.");
  const like = `%${subject.toLowerCase().replace(/[%_]/g, "")}%`;
  // Personal layers are private from admins too: only identifiers a person's rows carry (their subject and source) can match them, and their text never leaves.
  const rows = rowsOf(
    ctx.db,
    "SELECT * FROM memory_facts WHERE status IN ('current', 'proposed', 'closed') AND (subject = ? OR source_ref = ? OR (enc = 0 AND LOWER(text) LIKE ?)) ORDER BY learned_at DESC, id",
    subject, subject, like,
  );
  const facts: Fact[] = rows.map((r) => readFact(ctx, r)).map((f) => (f.layer === "person" ? { ...f, text: "" } : f));
  const noteRows = rowsOf(ctx.db, "SELECT * FROM memory_notes WHERE layer != 'person' AND (LOWER(title) LIKE ? OR LOWER(body) LIKE ?) ORDER BY updated_at DESC", like, like);
  const notes = noteRows.map((r) => noteRowOut(ctx, r)).filter((n): n is NonNullable<typeof n> => n !== null);
  const p = pageOf(facts, input.cursor, input.limit);
  return { facts: p.page.map(factOut), notes, ...(p.next ? { next: p.next } : {}), total: p.total };
}

// ---- promotion

type ToLayer = "agent" | "project" | "space";
interface Promotion { id: string; factId: string; toLayer: ToLayer; agentId: string | null; projectId: string | null; taskId: string | null; status: string; requestedBy: string; requestedAt: number; newFactId: string | null }

function readPromotion(r: Row): Promotion {
  return {
    id: str(r["id"]), factId: str(r["fact_id"]), toLayer: str(r["to_layer"]) as ToLayer, agentId: orNull(r["agent_id"]), projectId: orNull(r["project_id"]), taskId: orNull(r["task_id"]),
    status: str(r["status"]), requestedBy: str(r["requested_by"]), requestedAt: num(r["requested_at"]), newFactId: orNull(r["new_fact_id"]),
  };
}

function needPromotion(ctx: MemCtx, id: string): Promotion {
  const r = rowsOf(ctx.db, "SELECT * FROM memory_promotions WHERE id = ?", id)[0];
  if (!r) raise(ctx, "validation.bad_input", "There is no such promotion request.", { promotionId: id });
  return readPromotion(r);
}

/** Who gets the task: the agent's owner, the project's lead, else the Space admins. */
async function approverFor(ctx: MemCtx, to: ToLayer, agentId: string | null, projectId: string | null): Promise<{ id: string; kind: "person" | "role" }> {
  try {
    if (to === "agent" && agentId) {
      const owner = ((await ctx.call("agents.get", { agentId })) as { agent?: { ownerId?: string } }).agent?.ownerId;
      if (owner) return { id: owner, kind: "person" };
    }
    if (to === "project" && projectId) {
      const lead = ((await ctx.call("projects.get", { projectId })) as { project?: { lead?: string } }).project?.lead;
      if (lead) return { id: lead, kind: "person" };
    }
  } catch { /* the Space admins take it */ }
  return { id: "admin", kind: "role" };
}

/** Add the shared copy of a fact: it carries the name and time of the person who moved it, and the personal fact stays. */
function applyPromotion(ctx: MemCtx, p: Promotion, by: string): Fact {
  const src = needFact(ctx, p.factId);
  // The person asked for the promotion, so their sealed text may be opened here to make the shared copy; nothing else leaves the sealed row.
  const text = src.text !== "" ? src.text : readFact({ seal: ctx.seal, principal: { kind: "person", id: src.ownerRef } }, rowsOf(ctx.db, "SELECT * FROM memory_facts WHERE id = ?", src.id)[0]!).text;
  const copy = insertFact(ctx, {
    layer: p.toLayer, ownerRef: ownerOfLayer(ctx, p.toLayer, by, p.agentId, p.projectId), agentId: p.toLayer === "agent" ? p.agentId : null, projectId: p.toLayer === "project" ? p.projectId : null,
    kind: src.kind, text, validFrom: src.validFrom, sourceKind: src.sourceKind, sourceRef: src.sourceRef, sourcePerson: src.sourcePerson, proposedBy: p.requestedBy, status: "current",
    lowRisk: src.lowRisk, promotedFrom: src.id, promotedBy: by, promotedAt: ctx.now(), links: [["promoted_from", src.id]],
  });
  ctx.db.run("UPDATE memory_promotions SET status = 'approved', decided_by = ?, decided_at = ?, new_fact_id = ? WHERE id = ?", by, ctx.now(), copy.id, p.id);
  ctx.emit("memory.promoted", copy.id, { promotionId: p.id, factId: src.id, newFactId: copy.id, toLayer: p.toLayer, by });
  return copy;
}

/** Close the approver's task once the request is decided. A task module that is away must not undo the decision. */
async function closeTask(ctx: MemCtx, taskId: string | null, to: "done" | "canceled", note: string): Promise<void> {
  if (!taskId) return;
  try { await ctx.call("tasks.transition", { taskId, to, note }); } catch (e) { ctx.log.warn("the promotion task could not be closed", { taskId, reason: e instanceof Error ? e.name : "error" }); }
}

export async function promote(ctx: MemCtx, input: { factId: string; toLayer: ToLayer; agentId?: string; projectId?: string; note?: string }): Promise<{ promotionId: string; promoted: boolean; taskId?: string }> {
  ensure(ctx.db);
  const me = actorOf(ctx);
  const access = makeAccess(ctx);
  const f = needFact(ctx, input.factId);
  if (!(await access.can(f.layer, f.ownerRef, f.agentId, f.projectId, "view"))) raise(ctx, "permission.no_grant", "You cannot see this fact.");
  if (f.status !== "current") raise(ctx, "validation.bad_input", "Only a current fact can be promoted.", { status: f.status });
  const agentId = input.toLayer === "agent" ? input.agentId ?? f.agentId : null;
  const projectId = input.toLayer === "project" ? input.projectId ?? null : null;
  if (input.toLayer === "agent" && !agentId) raise(ctx, "validation.bad_input", "Name the agent whose memory this goes to.");
  if (input.toLayer === "project" && !projectId) raise(ctx, "validation.bad_input", "Name the project whose memory this goes to.");
  const owner = ownerOfLayer(ctx, input.toLayer, me, agentId, projectId);
  if (f.layer === input.toLayer && f.ownerRef === owner) raise(ctx, "validation.bad_input", "The fact is already in that layer.");

  const waiting = rowsOf(ctx.db, "SELECT * FROM memory_promotions WHERE fact_id = ? AND to_layer = ? AND COALESCE(agent_id, '') = ? AND COALESCE(project_id, '') = ? AND status = 'pending'", f.id, input.toLayer, agentId ?? "", projectId ?? "")[0];
  if (waiting) {
    const w = readPromotion(waiting);
    return { promotionId: w.id, promoted: false, ...(w.taskId ? { taskId: w.taskId } : {}) };
  }
  const id = mintId("prm", ctx.now());
  const allowed = await access.can(input.toLayer, owner, agentId, projectId, "edit");
  ctx.db.run(
    "INSERT INTO memory_promotions (id, fact_id, to_layer, agent_id, project_id, task_id, status, requested_by, requested_at, decided_by, decided_at, new_fact_id, note) VALUES (?, ?, ?, ?, ?, NULL, 'pending', ?, ?, NULL, NULL, NULL, ?)",
    id, f.id, input.toLayer, agentId, projectId, me, ctx.now(), input.note ?? null,
  );
  const p = needPromotion(ctx, id);
  if (allowed) {
    // The person can edit the target, so their own approval is enough and no admin is involved.
    ctx.emit("memory.promotion_requested", f.id, { promotionId: id, factId: f.id, toLayer: input.toLayer, by: me });
    applyPromotion(ctx, p, me);
    return { promotionId: id, promoted: true };
  }
  const approver = await approverFor(ctx, input.toLayer, agentId, projectId);
  let taskId: string | null = null;
  try {
    const text = f.text.length > 200 ? `${f.text.slice(0, 197)}...` : f.text;
    const res = (await ctx.call("tasks.create", {
      title: `Add to ${input.toLayer} memory`, kind: "approve", assigned: approver, summary: `${me} proposes adding this to the ${input.toLayer} memory: ${text}`,
      actions: [{ key: "approve", label: "Approve" }, { key: "reject", label: "Reject", note: "optional" }], source: { kind: "manual", id }, idempotencyKey: `memprom:${id}`,
    })) as { task?: { id?: string } };
    taskId = res.task?.id ?? null;
  } catch {
    ctx.db.run("DELETE FROM memory_promotions WHERE id = ?", id);
    raise(ctx, "internal.unexpected", "The request for approval could not be created. Nothing was changed.");
  }
  ctx.db.run("UPDATE memory_promotions SET task_id = ? WHERE id = ?", taskId, id);
  ctx.emit("memory.promotion_requested", f.id, { promotionId: id, factId: f.id, toLayer: input.toLayer, ...(taskId ? { taskId } : {}), by: me });
  return { promotionId: id, promoted: false, ...(taskId ? { taskId } : {}) };
}

export async function promotionApprove(ctx: MemCtx, input: { promotionId: string }) {
  ensure(ctx.db);
  const me = actorOf(ctx);
  const p = needPromotion(ctx, input.promotionId);
  if (p.status !== "pending") raise(ctx, "validation.precondition_failed", "This request was already decided.", { status: p.status });
  const owner = ownerOfLayer(ctx, p.toLayer, me, p.agentId, p.projectId);
  if (!(await makeAccess(ctx).can(p.toLayer, owner, p.agentId, p.projectId, "edit"))) raise(ctx, "permission.no_grant", "Only someone who can edit this memory can approve it.");
  const copy = applyPromotion(ctx, p, me);
  await closeTask(ctx, p.taskId, "done", "Approved");
  return { fact: factOut(copy) };
}

export async function promotionReject(ctx: MemCtx, input: { promotionId: string; note?: string }) {
  ensure(ctx.db);
  const me = actorOf(ctx);
  const p = needPromotion(ctx, input.promotionId);
  if (p.status !== "pending") raise(ctx, "validation.bad_input", "This request was already decided.", { status: p.status });
  const owner = ownerOfLayer(ctx, p.toLayer, me, p.agentId, p.projectId);
  const mayDecide = p.requestedBy === me || (await makeAccess(ctx).can(p.toLayer, owner, p.agentId, p.projectId, "edit"));
  if (!mayDecide) raise(ctx, "permission.no_grant", "Only the requester or someone who can edit this memory can reject it.");
  ctx.db.run("UPDATE memory_promotions SET status = 'rejected', decided_by = ?, decided_at = ?, note = COALESCE(?, note) WHERE id = ?", me, ctx.now(), input.note ?? null, p.id);
  ctx.emit("memory.promotion_rejected", p.factId, { promotionId: p.id, factId: p.factId, by: me });
  await closeTask(ctx, p.taskId, "canceled", input.note ?? "Rejected");
  return { ok: true };
}

export async function promotionUndo(ctx: MemCtx, input: { promotionId: string }) {
  ensure(ctx.db);
  const me = actorOf(ctx);
  const p = needPromotion(ctx, input.promotionId);
  if (p.status !== "approved" || !p.newFactId) raise(ctx, "validation.bad_input", "Only a finished promotion can be undone.", { status: p.status });
  const owner = ownerOfLayer(ctx, p.toLayer, me, p.agentId, p.projectId);
  const mayUndo = p.requestedBy === me || (await makeAccess(ctx).can(p.toLayer, owner, p.agentId, p.projectId, "edit"));
  if (!mayUndo) raise(ctx, "permission.no_grant", "Only the person who promoted it or someone who can edit this memory can undo it.");
  const now = ctx.now();
  ctx.db.run("UPDATE memory_facts SET status = 'closed', valid_to = ?, closed_at = ? WHERE id = ? AND status = 'current'", now, now, p.newFactId);
  ctx.db.run("UPDATE memory_promotions SET status = 'undone', decided_by = ?, decided_at = ? WHERE id = ?", me, now, p.id);
  ctx.emit("memory.promotion_undone", p.factId, { promotionId: p.id, factId: p.factId, by: me });
  return { ok: true };
}

// ---- capture at chat end

export interface CaptureMessage { messageId: string; author: { kind: string; id: string }; body: string; enc?: unknown }
export interface Candidate { person: string; text: string; kind: string; messageId: string; index: number }
export type Extractor = (messages: CaptureMessage[]) => Promise<Candidate[]> | Candidate[];

const PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: "preference", re: /\b(?:i|we) (?:prefer|always|never|usually|like to|don't like|do not like|hate)\b/i },
  { kind: "decision", re: /\bwe (?:decided|agreed|chose|settled on|will use|are going with)\b/i },
  { kind: "deadline", re: /\b(?:deadline|due date|due on|is due)\b/i },
  { kind: "profile", re: /\bmy (?:[a-z]+ ){0,2}(?:is|are) \S/i },
  { kind: "note", re: /\b(?:remember|keep in mind|note that|for the record)\b/i },
];

/** The default extractor: rules over the sentences people wrote. The host binds a cheap-model pass over this with setCaptureExtractor. */
export function heuristicExtract(messages: CaptureMessage[]): Candidate[] {
  const out: Candidate[] = [];
  for (const m of messages) {
    if (m.author.kind !== "person" || m.enc) continue;
    const sentences = m.body.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 8 && s.length <= 300 && !s.endsWith("?"));
    sentences.forEach((s, index) => {
      const hit = PATTERNS.find((p) => p.re.test(s));
      if (hit) out.push({ person: m.author.id, text: s, kind: hit.kind, messageId: m.messageId, index });
    });
  }
  return out;
}

let extractor: Extractor = heuristicExtract;
/** Bind the cheap-model pass (or null for the rules). */
export function setCaptureExtractor(fn: Extractor | null): void {
  extractor = fn ?? heuristicExtract;
}

interface ThreadOut { thread: { kind: string; starter?: string; scopeType?: string; scopeId?: string; agents: Array<{ agentId: string; mode: string }> } }

export async function capture(ctx: MemCtx, input: { threadId: string; reason: "closed" | "idle" }) {
  ensure(ctx.db);
  const t = ((await ctx.call("threads.get", { threadId: input.threadId })) as ThreadOut).thread;
  const page = (await ctx.call("chat.messages.list", { threadId: input.threadId, limit: 200 })) as { messages: CaptureMessage[] };
  const agentId = (t.agents.find((a) => a.mode === "lead") ?? t.agents[0])?.agentId ?? null;
  const shared = t.kind === "channel" || t.kind === "thread";
  const fromRun = t.kind === "run";
  const projectId = shared && t.scopeType === "project" && t.scopeId ? t.scopeId : null;
  const kinds = await autoMergeKinds(ctx);
  let proposed = 0;
  let merged = 0;
  for (const c of await extractor(page.messages)) {
    const key = `${input.threadId}:${c.messageId}:${c.index}`;
    if (rowsOf(ctx.db, "SELECT fact_id FROM memory_fact_links WHERE kind = 'capture' AND ref = ?", key)[0]) continue;
    let layer: Layer = "person";
    let status: FactStatus = kinds.includes(c.kind) ? "current" : "proposed";
    let sourceKind: SourceKind = "chat";
    if (fromRun) { layer = "agent"; status = "proposed"; sourceKind = "run"; }
    else if (shared) { sourceKind = "channel"; if (projectId) { layer = "project"; status = "current"; } else { layer = agentId ? "agent" : "space"; status = "proposed"; } }
    const owner = layer === "person" ? c.person : layer === "agent" ? agentId ?? "" : layer === "project" ? projectId ?? "" : ctx.space;
    const f = insertFact(ctx, {
      layer, ownerRef: owner, agentId: layer === "project" || layer === "space" ? null : agentId, projectId: layer === "project" ? projectId : null, kind: c.kind, text: c.text, validFrom: ctx.now(),
      sourceKind, sourceRef: input.threadId, sourcePerson: c.person, proposedBy: ctx.principal.id, status, lowRisk: kinds.includes(c.kind), links: [["capture", key]],
    });
    emitProposed(ctx, f);
    proposed++;
    if (status === "current") { emitAccepted(ctx, f, true); merged++; }
  }
  ctx.emit("memory.captured", input.threadId, { threadId: input.threadId, proposed, merged });
  return { proposed, merged };
}

// ---- nightly job

const MAP_LINES = 190;

function mapBody(agentId: string, notes: Row[], facts: Fact[], at: number): string {
  const head = [`# Memory map`, ``, `Agent: ${agentId}`, `Updated: ${new Date(at).toISOString().slice(0, 10)}`, ``];
  const noteLines = notes.map((n) => `- ${str(n["title"])} (${str(n["path"])})`);
  const factLines = facts.map((f) => `- ${excerpt(f.text, 140)} (since ${new Date(f.validFrom).toISOString().slice(0, 10)})`);
  const room = Math.max(0, MAP_LINES - head.length - 4);
  const noteShare = Math.min(noteLines.length, Math.ceil(room / 2));
  const keptNotes = noteLines.slice(0, noteShare);
  const keptFacts = factLines.slice(0, Math.max(0, room - keptNotes.length));
  return [...head, `## Notes`, ...keptNotes, ``, `## Current facts`, ...keptFacts, ``].join("\n");
}

export async function maintain(ctx: MemCtx, input: { agentId?: string }) {
  ensure(ctx.db);
  const now = ctx.now();
  const only = input.agentId ?? null;
  // Close what ran past its end date.
  const closedRes = ctx.db.run(
    `UPDATE memory_facts SET status = 'closed', closed_at = ? WHERE status = 'current' AND valid_to IS NOT NULL AND valid_to <= ?${only ? " AND agent_id = ?" : ""}`,
    ...(only ? [now, now, only] : [now, now]),
  );
  let closed = closedRes.changes;
  // Merge accepted shared facts that say the same thing: the earliest stays, the copies are closed.
  let merged = 0;
  const rows = rowsOf(
    ctx.db,
    `SELECT * FROM memory_facts WHERE status = 'current' AND enc = 0${only ? " AND agent_id = ?" : ""} ORDER BY learned_at, id`,
    ...(only ? [only] : []),
  );
  const keep = new Map<string, string>();
  for (const r of rows) {
    const k = `${str(r["layer"])}|${str(r["owner_ref"])}|${str(r["agent_id"])}|${str(r["project_id"])}|${normal(str(r["text"]))}`;
    if (keep.has(k)) {
      ctx.db.run("UPDATE memory_facts SET status = 'closed', valid_to = ?, closed_at = ? WHERE id = ?", now, now, str(r["id"]));
      merged++;
      closed++;
    } else keep.set(k, str(r["id"]));
  }
  // MAP.md for each agent: its notes and current facts, under 200 lines. Personal layers never go in.
  const agents = new Set<string>();
  if (only) agents.add(only);
  else {
    for (const r of rowsOf(ctx.db, "SELECT DISTINCT agent_id FROM memory_facts WHERE layer = 'agent' AND agent_id IS NOT NULL")) agents.add(str(r["agent_id"]));
    for (const r of rowsOf(ctx.db, "SELECT DISTINCT agent_id FROM memory_notes WHERE layer = 'agent' AND agent_id IS NOT NULL")) agents.add(str(r["agent_id"]));
  }
  let maps = 0;
  for (const a of [...agents].sort()) {
    const notes = rowsOf(ctx.db, "SELECT title, path, file_id FROM memory_notes WHERE layer = 'agent' AND agent_id = ? AND LOWER(path) NOT LIKE '%/map.md' ORDER BY title", a);
    const facts = rowsOf(ctx.db, "SELECT * FROM memory_facts WHERE layer = 'agent' AND agent_id = ? AND status = 'current' ORDER BY learned_at DESC, id", a).map((r) => readFact(ctx, r));
    const body = mapBody(a, notes, facts, now);
    const lines = body.split("\n").length;
    const known = rowsOf(ctx.db, "SELECT file_id FROM memory_notes WHERE layer = 'agent' AND agent_id = ? AND LOWER(path) LIKE '%/map.md'", a)[0];
    const fileId = known ? str(known["file_id"]) : null;
    if (fileId) {
      try { await ctx.call("files.write", { fileId, content: { text: body }, reason: "Nightly memory map" }); } catch { ctx.log.warn("MAP.md could not be written", { agentId: a }); }
    }
    ctx.db.run("INSERT OR REPLACE INTO memory_maps (agent_id, file_id, body, lines, updated_at) VALUES (?, ?, ?, ?, ?)", a, fileId, body, lines, now);
    ctx.emit("memory.map_rewritten", a, { agentId: a, lines });
    maps++;
  }
  return { merged, closed, maps };
}

/** Used by tests and the pointer proof set: how many words a query has once stop words are gone. */
export const queryTerms = (q: string): number => new Set(tokens(q)).size;
