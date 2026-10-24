// Home projections (spec 3.1, 2.6; ARCH 7.1). The digest entity row, its ranking, the Projects at risk rule and the local day of a person.
// Durable tables: generated/modules/home/schema.sql (home_digests) and migrations/0001_home.sql. Every statement names only home_* tables (ctx.db refuses anything else, ARCH B2).
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface EmitOpts { idempotencyKey?: string; vis?: string; cause?: string }
export interface HomeCtx {
  space: string;
  principal: { kind: string; id: string };
  actingFor?: string;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown, opts?: EmitOpts): { id: string };
  call?(cap: string, input: unknown): Promise<unknown>;
}

type Code = Parameters<typeof fail>[0];
export function raise(ctx: { trace: { traceId: string } }, code: Code, message?: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { ...(message ? { message } : {}), ...(details ? { details } : {}) });
}
/** Drop undefined keys so payloads and rows stay valid under exactOptionalPropertyTypes and the JSON schemas. */
export function clean<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}
export const nul = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
function json<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || v.length === 0) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}
export const js = (v: unknown): string => JSON.stringify(v);

/** `prefix_` plus 32 lowercase hex digits: the shape every id pattern in the manifests accepts. */
export const newId = (prefix: string, now: number): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;

export function page<T>(all: readonly T[], cursor?: string, limit?: number): { rows: T[]; next?: string; total: number } {
  const lim = Math.min(500, Math.max(1, limit ?? 50));
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const rows = all.slice(start, start + lim);
  const res: { rows: T[]; next?: string; total: number } = { rows, total: all.length };
  if (start + rows.length < all.length) res.next = String(start + rows.length);
  return res;
}

// ---- who ----

export const me = (ctx: HomeCtx): string => ctx.actingFor ?? ctx.principal.id;
export const isService = (ctx: HomeCtx): boolean => ctx.principal.kind === "service";
/** The person a digest is about may read it; the host (a service) and the assistant acting for that person may write it. */
export const mayActFor = (ctx: HomeCtx, person: string): boolean => isService(ctx) || person === ctx.principal.id || person === ctx.actingFor;

// ---- the digest ----

export type ItemKind = "decision" | "finished" | "record_change" | "routine" | "waiting";
export interface ResourceRef { type: string; id: string }
export interface DigestItem { kind: ItemKind; title: string; line: string; subject?: ResourceRef; at?: number; undo?: { cap: string; input: unknown } }
export interface Digest { id: string; person: string; periodStart: number; periodEnd: number; headline: string[]; items: DigestItem[]; seenAt?: number; builtBy: string }

/** Where each kind sits in the digest, in the order of spec 3.1: decisions first (each with Undo), then finished work, record changes, routine results, then what waits. */
export const KIND_RANK: Record<ItemKind, number> = { decision: 0, finished: 1, record_change: 2, routine: 3, waiting: 4 };
export const MAX_ITEMS = 7;
export const MAX_HEADLINE = 3;

/**
 * The ranked item list of a digest: by kind (KIND_RANK), newest first inside a kind, a stable order for ties; a routine appears once (its newest result, one line per routine);
 * at most seven. `full` is the "See all" list: every item, every routine result.
 */
export function rankItems(items: readonly DigestItem[], full = false): DigestItem[] {
  const seenRoutine = new Set<string>();
  const byNewest = items.map((it, i) => ({ it, i })).sort((a, b) => (b.it.at ?? 0) - (a.it.at ?? 0) || a.i - b.i);
  const kept = byNewest.filter(({ it }) => {
    if (full || it.kind !== "routine") return true;
    if (seenRoutine.has(it.title)) return false;
    seenRoutine.add(it.title);
    return true;
  });
  kept.sort((a, b) => KIND_RANK[a.it.kind] - KIND_RANK[b.it.kind] || (b.it.at ?? 0) - (a.it.at ?? 0) || a.i - b.i);
  return (full ? kept : kept.slice(0, MAX_ITEMS)).map(({ it }) => it);
}

type Raw = Record<string, unknown>;
function rowToDigest(r: Raw): Digest {
  const d: Digest = {
    id: r.id as string, person: r.person as string, periodStart: num(r.period_start) ?? 0, periodEnd: num(r.period_end) ?? 0,
    headline: json<string[]>(r.headline, []), items: json<DigestItem[]>(r.items, []), builtBy: (str(r.built_by) ?? "") as string,
  };
  const seen = num(r.seen_at); if (seen !== undefined) d.seenAt = seen;
  return d;
}
export function findDigest(db: Db, id: string): Digest | undefined {
  const r = (db.all("SELECT * FROM home_digests WHERE id = ? AND deleted_at IS NULL", id) as Raw[])[0];
  return r ? rowToDigest(r) : undefined;
}
/** The newest digest of a person that they have not seen. */
export function latestUnseen(db: Db, person: string): Digest | undefined {
  const r = (db.all(
    "SELECT * FROM home_digests WHERE person = ? AND seen_at IS NULL AND deleted_at IS NULL ORDER BY period_end DESC, id DESC LIMIT 1", person,
  ) as Raw[])[0];
  return r ? rowToDigest(r) : undefined;
}
export function saveDigest(db: Db, d: Digest, now: number): void {
  db.run(
    `INSERT OR REPLACE INTO home_digests (id, person, period_start, period_end, headline, items, seen_at, built_by, version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT version FROM home_digests WHERE id = ?), -1) + 1, ?, NULL)`,
    d.id, d.person, d.periodStart, d.periodEnd, js(d.headline), js(d.items), nul(d.seenAt), d.builtBy, d.id, now,
  );
}
export function digestOut(d: Digest): Record<string, unknown> {
  return clean({ id: d.id, person: d.person, periodStart: d.periodStart, periodEnd: d.periodEnd, headline: d.headline, items: d.items, seenAt: d.seenAt, builtBy: d.builtBy });
}
export function idemFind(db: Db, key: string): string | undefined { return str((db.all("SELECT digest_id FROM home_idem WHERE idem_key = ?", key) as Raw[])[0]?.digest_id); }
export function idemSave(db: Db, key: string, digestId: string): void { db.run("INSERT OR REPLACE INTO home_idem (idem_key, digest_id) VALUES (?, ?)", key, digestId); }

// ---- Projects at risk ----

/** The counting rule the section menu shows (spec 3.1). The first sentence is the spec's own words. */
export const AT_RISK_RULE =
  "Projects at risk = overdue, blocked or slipped. Overdue: the project or one of its open tasks is past its due date. Blocked: an open task is blocked. Slipped: a milestone is past its date and not done.";
export type Reason = "overdue" | "blocked" | "slipped";
export const REASON_ORDER: readonly Reason[] = ["overdue", "blocked", "slipped"];
export const OPEN_STATES = ["todo", "doing", "in_review", "awaiting_approval"] as const;
/** A project that is done or paused is never at risk. */
export const OUT_OF_PLAY = new Set(["done", "paused"]);

export interface ProjectFacts { projectDue?: number; overdueTasks: number; blockedTasks: number; lateMilestones: number }
/** Which of the three reasons apply. */
export function reasonsOf(f: ProjectFacts, now: number): Reason[] {
  const out: Reason[] = [];
  if ((f.projectDue !== undefined && f.projectDue < now) || f.overdueTasks > 0) out.push("overdue");
  if (f.blockedTasks > 0) out.push("blocked");
  if (f.lateMilestones > 0) out.push("slipped");
  return out;
}

// ---- a person's local day ----

/** The start and end of the local day that holds `now` in a zone (a day that changes length at a clock change is taken as 24 hours). Falls back to UTC for an unknown zone. */
export function localDay(now: number, tz: string): { start: number; end: number } {
  let zone = tz;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); } catch { zone = "UTC"; }
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(now));
  const v: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") v[p.type] = Number(p.value);
  const elapsed = ((v.hour! % 24) * 3600 + v.minute! * 60 + v.second!) * 1000 + (now % 1000 + 1000) % 1000;
  const start = now - elapsed;
  return { start, end: start + DAY };
}

/** The person's time zone from their profile setting; UTC when the setting is unreadable (a display preference must not stop Home). */
export async function personTz(ctx: HomeCtx): Promise<string> {
  try {
    const r = (await ctx.call?.("settings.get", { key: "profile.timezone" })) as { row?: { value?: unknown } } | undefined;
    const v = r?.row?.value;
    return typeof v === "string" && v.length > 0 ? v : "UTC";
  } catch { return "UTC"; }
}

// ---- checklist ----

export const isDone = (items: readonly { done: boolean }[]): boolean => items.length > 0 && items.every((i) => i.done);
export function emitChecklist(ctx: HomeCtx, person: string, reason: "done" | "dismissed"): void {
  ctx.emit("checklist.dismissed", `entity/${person}`, { person, reason });
}
