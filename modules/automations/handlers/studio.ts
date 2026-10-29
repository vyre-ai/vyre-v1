// The Studio reads: analytics from runs, dependencies from definitions, and the starter templates.
// Every number comes from the runs and definitions the caller can see. An empty Space answers with zeros and empty lists, never invented rows.
import { TEMPLATES, templateOf } from "../templates.ts";
import { allAutomations, getAutomation, raise } from "../projections.ts";
import type { AutoCtx, Automation } from "../projections.ts";
import { canView, create } from "./defs.ts";

type In = Record<string, unknown>;

const DAY = 86_400_000;
const PAGES = 10;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

interface RunRow { id?: unknown; status?: unknown; startedAt?: unknown; endedAt?: unknown; costMicros?: unknown; subject?: { type?: unknown; id?: unknown }; name?: unknown }

// ---- templates ----

export async function templatesList(): Promise<unknown> {
  return {
    templates: TEMPLATES.map((t) => ({
      key: t.key, title: t.title, summary: t.summary, starts: t.starts, setUp: [...t.setUp],
      steps: t.definition.nodes.map((n) => ({ id: n.id, key: n.key, title: n.title ?? n.key })),
    })),
  };
}

export async function templatesUse(ctx: AutoCtx, input: In): Promise<unknown> {
  const t = typeof input.templateKey === "string" ? templateOf(input.templateKey) : undefined;
  if (!t) raise(ctx, "validation.not_found", "That template does not exist.", { reason: "no_template" });
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : t.title;
  // a copy, so the catalogue is never shared with a saved draft
  return create(ctx, { name, description: t.summary, definition: JSON.parse(JSON.stringify(t.definition)), ...(input.folderId ? { folderId: input.folderId } : {}) });
}

// ---- analytics ----

async function loadRuns(ctx: AutoCtx, since: number, automationId?: string): Promise<RunRow[]> {
  if (!ctx.call) raise(ctx, "internal.unavailable", "Runs are not available right now.");
  const base = automationId
    ? { scope: "subject", subject: { type: "automation", id: automationId } }
    : { scope: "all", kinds: ["automation"] };
  const rows: RunRow[] = [];
  const seen = new Set<string>();
  const read = async (shape: Record<string, unknown>): Promise<void> => {
    let cursor: string | undefined;
    for (let n = 0; n < PAGES; n++) {
      const got = await ctx.call!("runs.list", { ...shape, since, limit: 500, ...(cursor ? { cursor } : {}) }) as { runs?: RunRow[]; next?: string };
      const batch = got?.runs ?? [];
      for (const r of batch) if (typeof r.id === "string" && !seen.has(r.id)) { seen.add(r.id); rows.push(r); }
      if (!got?.next || batch.length === 0 || got.next === cursor) break;
      cursor = got.next;
    }
  };
  try { await read(base); }
  catch (e) {
    // "all" is for people who manage runs; anyone else sees their own
    if (automationId) throw e;
    rows.length = 0; seen.clear();
    await read({ scope: "mine", kinds: ["automation"] });
  }
  return rows;
}

const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export async function analytics(ctx: AutoCtx, input: In): Promise<unknown> {
  const days = typeof input.days === "number" && Number.isInteger(input.days) ? Math.min(Math.max(input.days, 1), MAX_DAYS) : DEFAULT_DAYS;
  let automationId: string | undefined;
  if (typeof input.automationId === "string" && input.automationId) {
    const a = getAutomation(ctx, input.automationId);
    if (!canView(ctx, a)) raise(ctx, "permission.not_found", "That automation is not available.");
    automationId = a.id;
  }
  const now = ctx.now();
  const since = now - days * DAY;
  const runs = (await loadRuns(ctx, since, automationId)).filter((r) => typeof r.startedAt === "number" && r.startedAt >= since && typeof r.status === "string");

  const totals = { runs: 0, succeeded: 0, failed: 0, stopped: 0, active: 0, costMicros: 0 };
  const durations: number[] = [];
  const daily = new Map<string, { succeeded: number; failed: number; other: number }>();
  for (let i = days - 1; i >= 0; i--) daily.set(dayOf(now - i * DAY), { succeeded: 0, failed: 0, other: 0 });
  const per = new Map<string, { name: string; runs: number; succeeded: number; failed: number; lastRunAt: number }>();
  const failedIds: string[] = [];
  const visible = new Map<string, Automation | null>();
  const known = (id: string): Automation | null => {
    if (!visible.has(id)) {
      const a = allAutomations(ctx.db, "id = ?", id)[0];
      visible.set(id, a && canView(ctx, a) ? a : null);
    }
    return visible.get(id)!;
  };

  for (const r of runs) {
    const status = r.status as string;
    const at = r.startedAt as number;
    const subjectId = r.subject?.type === "automation" && typeof r.subject.id === "string" ? r.subject.id : null;
    if (!automationId && subjectId && !known(subjectId)) continue;   // a run of something this person cannot see
    totals.runs += 1;
    const bucket = daily.get(dayOf(at));
    if (status === "succeeded") { totals.succeeded += 1; if (bucket) bucket.succeeded += 1; }
    else if (status === "failed") { totals.failed += 1; if (bucket) bucket.failed += 1; if (typeof r.id === "string") failedIds.push(r.id); }
    else if (status === "stopped") { totals.stopped += 1; if (bucket) bucket.other += 1; }
    else { totals.active += 1; if (bucket) bucket.other += 1; }
    if (typeof r.costMicros === "number") totals.costMicros += r.costMicros;
    if ((status === "succeeded" || status === "failed") && typeof r.endedAt === "number" && r.endedAt >= at) durations.push(r.endedAt - at);
    if (subjectId) {
      const a = known(subjectId);
      const row = per.get(subjectId) ?? { name: a?.name ?? (typeof r.name === "string" ? r.name : subjectId), runs: 0, succeeded: 0, failed: 0, lastRunAt: 0 };
      row.runs += 1;
      if (status === "succeeded") row.succeeded += 1;
      if (status === "failed") row.failed += 1;
      row.lastRunAt = Math.max(row.lastRunAt, at);
      per.set(subjectId, row);
    }
  }

  // which step the failures stop on: read the step log of the newest failed runs
  const stops = new Map<string, { automationId: string | null; step: string; code: string; count: number }>();
  for (const id of failedIds.slice(0, 25)) {
    try {
      const got = await ctx.call!("runs.steps", { runId: id }) as { steps?: { step?: unknown; state?: unknown; error?: { code?: unknown } }[] };
      const failed = (got?.steps ?? []).filter((s) => s.state === "failed").at(-1);
      if (!failed || typeof failed.step !== "string") continue;
      const code = typeof failed.error?.code === "string" ? failed.error.code : "unknown";
      const run = runs.find((r) => r.id === id);
      const owner = run?.subject?.type === "automation" && typeof run.subject.id === "string" ? run.subject.id : null;
      const key = `${owner ?? ""}\u0000${failed.step}\u0000${code}`;
      const row = stops.get(key) ?? { automationId: owner, step: failed.step, code, count: 0 };
      row.count += 1;
      stops.set(key, row);
    } catch { /* a step log that cannot be read leaves the failure uncounted here */ }
  }

  const finished = totals.succeeded + totals.failed;
  return {
    windowDays: days,
    totals: { ...totals, successRate: finished === 0 ? null : totals.succeeded / finished, medianMs: median(durations) },
    daily: [...daily.entries()].map(([day, v]) => ({ day, ...v })),
    automations: [...per.entries()]
      .map(([id, v]) => ({ automationId: id, ...v }))
      .sort((a, b) => b.runs - a.runs || b.lastRunAt - a.lastRunAt || (a.automationId < b.automationId ? -1 : 1))
      .slice(0, 20),
    failures: [...stops.values()].sort((a, b) => b.count - a.count || (a.step < b.step ? -1 : 1)).slice(0, 8),
  };
}

// ---- dependencies ----

const KIND_OF: Record<string, string> = {
  aut: "automation", jrn: "journey", con: "connection", mbx: "mailbox", num: "number", frm: "form", chn: "channel", rec: "record",
  fil: "file", fld: "folder", prj: "project", sit: "site", kit: "kit", cmp: "campaign", usr: "person", grp: "group", agt: "agent",
};
const REF = /^([a-z]{3})_[a-z0-9]+$/;

interface Use { automationId: string; name: string; status: string; stepIds: string[] }

function refsOf(value: unknown, at: string, out: (kind: string, ref: string, step: string) => void): void {
  if (typeof value === "string") {
    const m = REF.exec(value);
    const kind = m ? KIND_OF[m[1]!] : undefined;
    if (kind) out(kind, value, at);
    return;
  }
  if (Array.isArray(value)) { for (const v of value) refsOf(v, at, out); return; }
  if (value && typeof value === "object") for (const v of Object.values(value as Record<string, unknown>)) refsOf(v, at, out);
}

export async function dependencies(ctx: AutoCtx): Promise<unknown> {
  const mine = allAutomations(ctx.db).filter((a) => canView(ctx, a));
  const index = new Map<string, { kind: string; ref: string; uses: Use[] }>();
  for (const a of mine) {
    const add = (kind: string, ref: string, step: string): void => {
      if (ref === a.id) return;
      const key = `${kind}:${ref}`;
      const item = index.get(key) ?? { kind, ref, uses: [] };
      let use = item.uses.find((u) => u.automationId === a.id);
      if (!use) { use = { automationId: a.id, name: a.name, status: a.status, stepIds: [] }; item.uses.push(use); }
      if (step && !use.stepIds.includes(step)) use.stepIds.push(step);
      index.set(key, item);
    };
    for (const t of a.definition.triggers) refsOf([t.config, t.filter], "", add);
    for (const n of a.definition.nodes) refsOf(n.input, n.id, add);
  }
  // a named automation may be gone or off; a named connection may be gone
  let connections: Set<string> | null = null;
  try {
    const got = await ctx.call?.("connections.list", { whose: "all", limit: 500 }) as { connections?: { connectionId?: unknown }[] } | undefined;
    if (got && Array.isArray(got.connections)) connections = new Set(got.connections.map((c) => c.connectionId).filter((id): id is string => typeof id === "string"));
  } catch { connections = null; }
  const items = [...index.values()].map((item) => {
    let problem: "missing" | "off" | null = null;
    if (item.kind === "automation") {
      const target = allAutomations(ctx.db, "id = ?", item.ref)[0];
      problem = !target ? "missing" : target.status !== "on" ? "off" : null;
    } else if (item.kind === "connection" && connections && !connections.has(item.ref)) {
      problem = "missing";
    }
    return { kind: item.kind, ref: item.ref, problem, usedBy: item.uses };
  }).sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.ref < b.ref ? -1 : 1));
  return { automations: mine.length, items };
}
