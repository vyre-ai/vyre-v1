// Upkeep of memory (owner design 30 Oct 2026, ruling 5): memory.maintain, nightly and on demand.
// Rules, always: exact and near duplicates are merged (the old row goes to Trash with a pointer to the fact that stayed), two values for one subject and field become one question with two answers,
// and a fact that is old for its kind becomes a question too. Facts past their end date close.
// Model, when a key is available: the upkeepModel seam below is given one scope at a time and may merge meaning-level duplicates, write pattern facts ("asked for Friday updates three times" becomes a
// preference), learn from corrections people made, and tidy pages. It may change or delete anything; every action goes on the trail with the run it belonged to. Each run records its tokens and an estimate
// of the cost in micro-dollars, and no model call starts once the month's spend reaches the monthly cap (setting memory.upkeep_monthly_cap).
// The model sees only what the scope's own key may see: Space, project and agent text with the Space or project key, and a person's own facts only when that person runs it.
import { excerpt } from "../../../lib/md.ts";
import { emitLearned, insertFact, normal } from "../factcore.ts";
import { readPage, saveNotes } from "../pages.ts";
import { reviewRequired, upkeepCapMicros } from "../policy.ts";
import { trail, UPKEEP } from "../trail.ts";
import { actorOf, ensure, factOut, loadFact, makeAccess, mintId, num, pageOf, raise, readFact, rowsOf, str, trigramSim } from "../projections.ts";
import type { Fact, Layer, MemCtx, Row } from "../projections.ts";
import { canSee, trashFact } from "./lifecycle.ts";

const DAY = 86_400_000;
type Page = { cursor?: string; limit?: number };

// ---- the model seam

export interface UpkeepScope { layer: Layer; ownerRef: string; agentId: string | null; projectId: string | null }
export interface UpkeepFactIn { id: string; text: string; kind: string | null; learnedAt: number; sourceKind: string; sourceRef: string }
export interface UpkeepPageIn { id: string; title: string; notes: string }
export interface UpkeepRequest {
  tasks: Array<"semantic_duplicates" | "patterns" | "corrections" | "tidy_pages">;
  scope: UpkeepScope;
  facts: UpkeepFactIn[];
  /** Corrections people made lately: what a fact said and what it was changed to. */
  corrections: Array<{ factId: string; was: string; now: string }>;
  pages: UpkeepPageIn[];
  now: number;
}
export type UpkeepAction =
  | { type: "merge"; keep: string; drop: string[]; text?: string; reason?: string }
  | { type: "create"; text: string; kind?: string; from?: string[]; reason?: string }
  | { type: "correct"; id: string; text: string; reason?: string }
  | { type: "delete"; id: string; reason?: string }
  | { type: "tidy_page"; pageId: string; notes: string; reason?: string };
export interface UpkeepUsage { inTokens: number; outTokens: number; costMicros?: number }
export interface UpkeepResult { actions: UpkeepAction[]; usage: UpkeepUsage }
/** Resolve the key for the request's scope and ask the model. Answer null when the scope has no key; the run then stays rule-based for it. */
export type UpkeepModel = (req: UpkeepRequest) => Promise<UpkeepResult | null>;

let model: UpkeepModel | null = null;
export function setUpkeepModel(fn: UpkeepModel | null): void { model = fn; }

/** An estimate when the seam reports tokens but no cost: 3 dollars per million tokens in, 15 out (micro-dollars per token). */
export const estimateMicros = (u: UpkeepUsage): number => u.costMicros ?? Math.round(u.inTokens * 3 + u.outTokens * 15);

// ---- rules

/** Subject, field and value of a sentence shaped "Dana's timezone is Pacific" or "The retainer is 4000", or null. */
export function claimOf(text: string): { subject: string; field: string; value: string } | null {
  const t = text.trim().replace(/[.!]+$/, "").replace(/\s+/g, " ");
  const m = /^(?:(?:the|my|our)\s+)?(?:(.{1,40}?)['’]s\s+)?([a-z][a-z0-9 -]{1,40}?)\s+(?:is|are|was|will be|=|:)\s+(.{1,120})$/i.exec(t);
  if (!m) return null;
  const clean = (s: string): string => s.toLowerCase().replace(/^(?:the|a|an)\s+/, "").trim();
  const field = clean(m[2] ?? "");
  const value = clean(m[3] ?? "");
  if (field === "" || value === "" || field.split(" ").length > 4) return null;
  return { subject: clean(m[1] ?? ""), field, value };
}

/** Days after which a fact of this kind is worth asking about again. */
export const STALE_DAYS: Readonly<Record<string, number>> = { deadline: 30, decision: 365, preference: 540, profile: 540, note: 365 };
export const STALE_DEFAULT_DAYS = 365;

const words = (s: string): Set<string> => new Set(normal(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1));
const overlap = (a: string, b: string): number => {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.max(x.size, y.size);
};
/** Near duplicates: the same words but for a few, in the same place. */
export const isNearDuplicate = (a: string, b: string): boolean => trigramSim(a, b) >= 0.88 && overlap(a, b) >= 0.75;

const placeOf = (f: Fact): string => `${f.layer}|${f.ownerRef}|${f.agentId ?? ""}|${f.projectId ?? ""}`;
const scopeOfFact = (f: Fact): UpkeepScope => ({ layer: f.layer, ownerRef: f.ownerRef, agentId: f.agentId, projectId: f.projectId });

interface Counters { merged: number; flagged: number; stale: number; created: number; corrected: number; deleted: number; tidied: number }
const zero = (): Counters => ({ merged: 0, flagged: 0, stale: 0, created: 0, corrected: 0, deleted: 0, tidied: 0 });

function openQuestion(ctx: MemCtx, kind: "contradiction" | "stale", a: Fact, b: Fact | null, runId: string): boolean {
  const q = b
    ? rowsOf(ctx.db, "SELECT id FROM memory_questions WHERE kind = ? AND ((fact_a = ? AND fact_b = ?) OR (fact_a = ? AND fact_b = ?))", kind, a.id, b.id, b.id, a.id)[0]
    : rowsOf(ctx.db, "SELECT id FROM memory_questions WHERE kind = ? AND fact_a = ? AND (status = 'open' OR resolved_at > ?)", kind, a.id, ctx.now() - (STALE_DAYS[a.kind ?? ""] ?? STALE_DEFAULT_DAYS) * DAY)[0];
  if (q) return false;
  const id = mintId("qst", ctx.now());
  ctx.db.run(
    "INSERT INTO memory_questions (id, kind, fact_a, fact_b, layer, owner_ref, agent_id, project_id, status, created_at, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)",
    id, kind, a.id, b?.id ?? null, a.layer, a.ownerRef, a.agentId, a.projectId, ctx.now(), runId,
  );
  trail(ctx, { action: "flag", factId: a.id, ...scopeOfFact(a), who: UPKEEP, source: "upkeep:rule", reason: kind === "contradiction" ? "two values for one subject and field" : "old for its kind", runId, detail: { questionId: id, ...(b ? { other: b.id } : {}) } });
  return true;
}

/** The rules: duplicates, contradictions, staleness. `facts` are current facts the caller may read, oldest first. */
function ruleUpkeep(ctx: MemCtx, facts: Fact[], runId: string, c: Counters): void {
  const now = ctx.now();
  const groups = new Map<string, Fact[]>();
  for (const f of facts) groups.set(placeOf(f), [...(groups.get(placeOf(f)) ?? []), f]);
  const gone = new Set<string>();
  const merge = (keep: Fact, drop: Fact, why: string): void => {
    if (trashFact(ctx, drop, { reason: why, action: "merge", mergedInto: keep.id, who: UPKEEP, source: "upkeep:rule", runId })) { gone.add(drop.id); c.merged++; }
  };
  for (const g of groups.values()) {
    // exact duplicates: the earliest stays
    const first = new Map<string, Fact>();
    for (const f of g) {
      const k = normal(f.text);
      const keep = first.get(k);
      if (keep) merge(keep, f, "duplicate"); else first.set(k, f);
    }
    // near duplicates: of the same kind, the earlier stays (bounded so a huge place stays fast)
    const live = g.filter((f) => !gone.has(f.id)).slice(0, 400);
    for (let i = 0; i < live.length; i++) {
      const a = live[i]!;
      if (gone.has(a.id)) continue;
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j]!;
        if (gone.has(b.id) || (a.kind ?? "") !== (b.kind ?? "")) continue;
        if (isNearDuplicate(a.text, b.text)) merge(a, b, "near duplicate");
      }
    }
    // contradictions: one subject and field with two values
    const claims = new Map<string, Array<{ f: Fact; value: string }>>();
    for (const f of g) {
      if (gone.has(f.id)) continue;
      const cl = claimOf(f.text);
      if (!cl) continue;
      const k = `${cl.subject}|${cl.field}`;
      claims.set(k, [...(claims.get(k) ?? []), { f, value: cl.value }]);
    }
    for (const list of claims.values()) {
      const base = list[0];
      if (!base) continue;
      for (const other of list.slice(1)) if (other.value !== base.value && openQuestion(ctx, "contradiction", base.f, other.f, runId)) c.flagged++;
    }
    // stale: old for its kind
    for (const f of g) {
      if (gone.has(f.id) || (f.validTo !== null && f.validTo > now)) continue;
      const days = STALE_DAYS[f.kind ?? ""] ?? STALE_DEFAULT_DAYS;
      if (now - f.validFrom > days * DAY && openQuestion(ctx, "stale", f, null, runId)) c.stale++;
    }
  }
}

// ---- model actions

function applyActions(ctx: MemCtx, scope: UpkeepScope, byId: Map<string, Fact>, actions: UpkeepAction[], runId: string, c: Counters, review: boolean): void {
  const known = (id: string): Fact | undefined => {
    const f = byId.get(id);
    return f && f.status === "current" ? loadFact(ctx, id) ?? undefined : undefined;
  };
  for (const a of actions) {
    const why = (a as { reason?: string }).reason ?? "tidying";
    if (a.type === "merge") {
      const keep = known(a.keep);
      if (!keep || keep.status !== "current") continue;
      let stays = keep;
      if (a.text && normal(a.text) !== normal(keep.text)) stays = replaceFact(ctx, keep, a.text, runId, why);
      for (const d of a.drop) {
        const f = d === a.keep ? undefined : known(d);
        if (f && trashFact(ctx, f, { reason: why, action: "merge", mergedInto: stays.id, who: UPKEEP, source: "upkeep:model", runId })) c.merged++;
      }
    } else if (a.type === "create") {
      const text = a.text.trim();
      if (text === "" || normal(text) === "") continue;
      const dup = [...byId.values()].some((f) => f.status === "current" && normal(f.text) === normal(text));
      if (dup) continue;
      const status = review ? "proposed" : "current";
      const from = (a.from ?? []).filter((id) => byId.has(id));
      const f = insertFact(ctx, {
        layer: scope.layer, ownerRef: scope.ownerRef, agentId: scope.agentId, projectId: scope.projectId, kind: a.kind ?? "pattern", text, validFrom: ctx.now(), sourceKind: "manual", sourceRef: `upkeep_${runId}`,
        sourcePerson: "upkeep", proposedBy: "upkeep", status, lowRisk: false, links: from.map((id) => ["derived_from", id] as [string, string]), how: "learn", who: UPKEEP, why, runId,
      });
      emitLearned(ctx, f, status === "current", UPKEEP);
      c.created++;
    } else if (a.type === "correct") {
      const f = known(a.id);
      if (!f || a.text.trim() === "" || normal(a.text) === normal(f.text)) continue;
      replaceFact(ctx, f, a.text, runId, why);
      c.corrected++;
    } else if (a.type === "delete") {
      const f = known(a.id);
      if (f && trashFact(ctx, f, { reason: why, action: "delete", who: UPKEEP, source: "upkeep:model", runId })) c.deleted++;
    } else if (a.type === "tidy_page") {
      const r = rowsOf(ctx.db, "SELECT * FROM memory_pages WHERE page_id = ? AND trashed_at IS NULL", a.pageId)[0];
      if (!r) continue;
      const page = readPage(ctx, r);
      if (page.layer !== scope.layer || page.ownerRef !== scope.ownerRef) continue;
      saveNotes(ctx, page, a.notes, { who: UPKEEP, reason: why, source: "upkeep:model", runId });
      c.tidied++;
    }
  }
}

/** Close the old fact and add the corrected one; the old row stays in history. */
function replaceFact(ctx: MemCtx, old: Fact, text: string, runId: string, why: string): Fact {
  const now = ctx.now();
  ctx.db.run("UPDATE memory_facts SET status = 'closed', valid_to = ?, closed_at = ? WHERE id = ?", now, now, old.id);
  const fresh = insertFact(ctx, {
    layer: old.layer, ownerRef: old.ownerRef, agentId: old.agentId, projectId: old.projectId, noteId: old.noteId, kind: old.kind, text, validFrom: now, sourceKind: "manual", sourceRef: old.id,
    sourcePerson: "upkeep", proposedBy: "upkeep", status: "current", lowRisk: false, replaces: old.id, how: "edit", who: UPKEEP, why, runId,
  });
  ctx.emit("memory.fact_corrected", fresh.id, { factId: fresh.id, closedFactId: old.id, by: "upkeep" });
  return fresh;
}

const MAX_FACTS_PER_CALL = 120;
const NOTE_CHARS = 4000;

async function modelUpkeep(ctx: MemCtx, facts: Fact[], runId: string, c: Counters, run: { tokensIn: number; tokensOut: number; cost: number; stopped: string | null; used: boolean }): Promise<void> {
  if (!model) { run.stopped = "no_key"; return; }
  const cap = await upkeepCapMicros(ctx);
  const month = monthOf(ctx.now());
  const before = num(rowsOf(ctx.db, "SELECT COALESCE(SUM(cost_micros), 0) AS s FROM memory_upkeep_runs WHERE month = ?", month)[0]?.["s"]);
  const groups = new Map<string, Fact[]>();
  for (const f of facts) groups.set(placeOf(f), [...(groups.get(placeOf(f)) ?? []), f]);
  let withoutKey = 0;
  let asked = 0;
  for (const g of groups.values()) {
    if (before + run.cost >= cap) { run.stopped = "cap"; return; }
    const scope = scopeOfFact(g[0]!);
    const recent = g.slice(-MAX_FACTS_PER_CALL);
    const pageRows = scope.layer === "person" ? [] : rowsOf(ctx.db, "SELECT * FROM memory_pages WHERE layer = ? AND owner_ref = ? AND trashed_at IS NULL AND notes != '' ORDER BY updated_at DESC LIMIT 20", scope.layer, scope.ownerRef);
    const corrections: UpkeepRequest["corrections"] = [];
    for (const f of recent) {
      if (!f.replaces || ctx.now() - f.learnedAt > 30 * DAY) continue;
      const was = loadFact(ctx, f.replaces);
      if (was && was.text !== "") corrections.push({ factId: f.id, was: was.text, now: f.text });
    }
    if (recent.length < 2 && pageRows.length === 0 && corrections.length === 0) continue;
    const req: UpkeepRequest = {
      tasks: ["semantic_duplicates", "patterns", "corrections", ...(pageRows.length > 0 ? ["tidy_pages" as const] : [])],
      scope, facts: recent.map((f) => ({ id: f.id, text: f.text, kind: f.kind, learnedAt: f.learnedAt, sourceKind: f.sourceKind, sourceRef: f.sourceRef })), corrections,
      pages: pageRows.map((r) => ({ id: str(r["page_id"]), title: str(r["title"]), notes: str(r["notes"]).slice(0, NOTE_CHARS) })), now: ctx.now(),
    };
    let res: UpkeepResult | null;
    try { res = await model(req); } catch (e) { ctx.log.warn("memory upkeep model failed for a place", { reason: e instanceof Error ? e.name : "error" }); continue; }
    if (res === null) { withoutKey++; continue; }
    asked++;
    run.used = true;
    run.tokensIn += res.usage.inTokens;
    run.tokensOut += res.usage.outTokens;
    run.cost += estimateMicros(res.usage);
    const review = await reviewRequired(ctx, scope.layer, scope.projectId);
    applyActions(ctx, scope, new Map(g.map((f) => [f.id, f])), res.actions, runId, c, review);
  }
  if (asked === 0 && withoutKey > 0) run.stopped = "no_key";
}

const monthOf = (t: number): string => new Date(t).toISOString().slice(0, 7);

// ---- maintain

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

export async function maintain(ctx: MemCtx, input: { agentId?: string; rulesOnly?: boolean }) {
  ensure(ctx.db);
  const now = ctx.now();
  const only = input.agentId ?? null;
  const runId = mintId("upk", now);
  const month = monthOf(now);
  ctx.db.run("INSERT INTO memory_upkeep_runs (id, started_at, month, trigger_by) VALUES (?, ?, ?, ?)", runId, now, month, actorOf(ctx));
  // Close what ran past its end date.
  const closed = ctx.db.run(
    `UPDATE memory_facts SET status = 'closed', closed_at = ? WHERE status = 'current' AND valid_to IS NOT NULL AND valid_to <= ?${only ? " AND agent_id = ?" : ""}`,
    ...(only ? [now, now, only] : [now, now]),
  ).changes;
  // Vectors of facts that are no longer current are not needed.
  ctx.db.run("DELETE FROM memory_vectors WHERE doc_kind = 'fact' AND doc_id NOT IN (SELECT id FROM memory_facts WHERE status = 'current')");
  // What upkeep may read: shared text, and the caller's own personal facts when a person runs it.
  const me = actorOf(ctx);
  const rows = rowsOf(
    ctx.db,
    `SELECT * FROM memory_facts WHERE status = 'current' AND (enc = 0 OR (layer = 'person' AND owner_ref = ?))${only ? " AND agent_id = ?" : ""} ORDER BY learned_at, id`,
    ...(only ? [me, only] : [me]),
  );
  const facts = rows.map((r) => readFact(ctx, r)).filter((f) => f.text !== "");
  const c = zero();
  ruleUpkeep(ctx, facts, runId, c);
  const run = { tokensIn: 0, tokensOut: 0, cost: 0, stopped: null as string | null, used: false };
  if (!input.rulesOnly) {
    const left = facts.filter((f) => rowsOf(ctx.db, "SELECT 1 AS x FROM memory_facts WHERE id = ? AND status = 'current'", f.id).length > 0);
    await modelUpkeep(ctx, left, runId, c, run);
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
    const agentFacts = rowsOf(ctx.db, "SELECT * FROM memory_facts WHERE layer = 'agent' AND agent_id = ? AND status = 'current' ORDER BY learned_at DESC, id", a).map((r) => readFact(ctx, r));
    const body = mapBody(a, notes, agentFacts, now);
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
  ctx.db.run(
    "UPDATE memory_upkeep_runs SET finished_at = ?, model_used = ?, merged = ?, flagged = ?, stale = ?, created = ?, corrected = ?, deleted = ?, tidied = ?, tokens_in = ?, tokens_out = ?, cost_micros = ?, stopped = ? WHERE id = ?",
    ctx.now(), run.used ? 1 : 0, c.merged, c.flagged, c.stale, c.created, c.corrected, c.deleted, c.tidied, run.tokensIn, run.tokensOut, run.cost, run.stopped, runId,
  );
  ctx.emit("memory.upkeep_ran", runId, {
    runId, merged: c.merged, flagged: c.flagged, stale: c.stale, created: c.created, corrected: c.corrected, deleted: c.deleted, tidied: c.tidied, modelUsed: run.used, costMicros: run.cost,
    ...(run.stopped ? { stopped: run.stopped } : {}),
  });
  return {
    merged: c.merged, closed, maps, runId, flagged: c.flagged, stale: c.stale, created: c.created, corrected: c.corrected, deleted: c.deleted, tidied: c.tidied, modelUsed: run.used, costMicros: run.cost,
    tokensIn: run.tokensIn, tokensOut: run.tokensOut, ...(run.stopped ? { stopped: run.stopped as "cap" | "no_key" } : {}),
  };
}

// ---- spend and runs

export async function upkeepStatus(ctx: MemCtx, input: { limit?: number }) {
  ensure(ctx.db);
  if (!makeAccess(ctx).isAdmin()) raise(ctx, "permission.role_lacks_permission", "Upkeep spend is for memory admins.");
  const month = monthOf(ctx.now());
  const spent = num(rowsOf(ctx.db, "SELECT COALESCE(SUM(cost_micros), 0) AS s FROM memory_upkeep_runs WHERE month = ?", month)[0]?.["s"]);
  const cap = await upkeepCapMicros(ctx);
  const runs = rowsOf(ctx.db, "SELECT * FROM memory_upkeep_runs ORDER BY started_at DESC, rowid DESC LIMIT ?", input.limit ?? 30).map((r) => ({
    runId: str(r["id"]), startedAt: num(r["started_at"]), ...(r["finished_at"] === null ? {} : { finishedAt: num(r["finished_at"]) }), modelUsed: num(r["model_used"]) === 1,
    merged: num(r["merged"]), flagged: num(r["flagged"]), stale: num(r["stale"]), created: num(r["created"]), corrected: num(r["corrected"]), deleted: num(r["deleted"]), tidied: num(r["tidied"]),
    tokensIn: num(r["tokens_in"]), tokensOut: num(r["tokens_out"]), costMicros: num(r["cost_micros"]), ...(r["stopped"] ? { stopped: str(r["stopped"]) as "cap" | "no_key" } : {}),
  }));
  const open = num(rowsOf(ctx.db, "SELECT COUNT(*) AS n FROM memory_questions WHERE status = 'open'")[0]?.["n"]);
  return { month, spentMicros: spent, capMicros: cap, capReached: spent >= cap, modelAvailable: model !== null, openQuestions: open, runs };
}

// ---- questions: a contradiction or a stale fact, answered with one click

export async function questionsList(ctx: MemCtx, input: Page & { status?: "open" | "resolved"; kind?: "contradiction" | "stale"; layer?: Layer; agentId?: string; projectId?: string }) {
  ensure(ctx.db);
  const access = makeAccess(ctx);
  const args: unknown[] = [input.status ?? "open"];
  let sql = "SELECT * FROM memory_questions WHERE status = ?";
  if (input.kind) { sql += " AND kind = ?"; args.push(input.kind); }
  if (input.layer) { sql += " AND layer = ?"; args.push(input.layer); }
  if (input.agentId) { sql += " AND agent_id = ?"; args.push(input.agentId); }
  if (input.projectId) { sql += " AND project_id = ?"; args.push(input.projectId); }
  sql += " ORDER BY created_at DESC, rowid DESC";
  const out: Array<Record<string, unknown>> = [];
  for (const q of rowsOf(ctx.db, sql, ...args)) {
    const a = loadFact(ctx, str(q["fact_a"]));
    const b = q["fact_b"] ? loadFact(ctx, str(q["fact_b"])) : null;
    if (!a || (q["fact_b"] && !b)) continue;
    if (!(await canSee(ctx, access, a))) continue;
    out.push({
      questionId: str(q["id"]), kind: str(q["kind"]), status: str(q["status"]), createdAt: num(q["created_at"]), layer: str(q["layer"]), facts: [factOut(a), ...(b ? [factOut(b)] : [])],
      ...(q["resolution"] ? { resolution: str(q["resolution"]) } : {}),
    });
  }
  const p = pageOf(out, input.cursor, input.limit);
  return { questions: p.page, ...(p.next ? { next: p.next } : {}), total: p.total };
}

/** Answer a question. Contradiction: keep_a, keep_b (the other goes to Trash) or keep_both. Stale: keep_a (still true; asked again after its period) or drop. */
export async function questionResolve(ctx: MemCtx, input: { questionId: string; resolution: "keep_a" | "keep_b" | "keep_both" | "drop" }) {
  ensure(ctx.db);
  const q = rowsOf(ctx.db, "SELECT * FROM memory_questions WHERE id = ?", input.questionId)[0];
  if (!q) raise(ctx, "validation.not_found", "There is no such question.", { questionId: input.questionId });
  if (str(q["status"]) !== "open") raise(ctx, "validation.precondition_failed", "This question was already answered.");
  const a = loadFact(ctx, str(q["fact_a"]));
  const b = q["fact_b"] ? loadFact(ctx, str(q["fact_b"])) : null;
  if (!a) raise(ctx, "validation.not_found", "The fact is gone.");
  const access = makeAccess(ctx);
  if (!(await canSee(ctx, access, a))) raise(ctx, "validation.not_found", "There is no such question.", { questionId: input.questionId });
  const mayEdit = a.layer === "person" ? a.ownerRef === actorOf(ctx) : await access.can(a.layer, a.ownerRef, a.agentId, a.projectId, "edit");
  if (!mayEdit) raise(ctx, "permission.no_grant", "You cannot change this memory.");
  const kind = str(q["kind"]);
  const r = input.resolution;
  if (kind === "contradiction") {
    if (r === "drop" || !b) raise(ctx, "validation.bad_input", "Choose keep_a, keep_b or keep_both.");
    if (r === "keep_a") trashFact(ctx, b, { reason: "contradicted", action: "delete", source: "question" });
    else if (r === "keep_b") trashFact(ctx, a, { reason: "contradicted", action: "delete", source: "question" });
  } else {
    if (r === "keep_b" || r === "keep_both") raise(ctx, "validation.bad_input", "Choose keep_a or drop.");
    if (r === "drop") trashFact(ctx, a, { reason: "stale", action: "delete", source: "question" });
  }
  ctx.db.run("UPDATE memory_questions SET status = 'resolved', resolved_at = ?, resolved_by = ?, resolution = ? WHERE id = ?", ctx.now(), actorOf(ctx), r, input.questionId);
  trail(ctx, { action: "resolve", factId: a.id, layer: a.layer, ownerRef: a.ownerRef, agentId: a.agentId, projectId: a.projectId, reason: r, detail: { questionId: input.questionId, kind } });
  return { ok: true, resolution: r };
}
