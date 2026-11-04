// Goals projections: the goal row and its side tables (migrations/0001_goals.sql), time in the owner's zone, the wake-up queue, activity, and the rules every handler shares.
// Every statement names only goals_* tables (ctx.db refuses anything else, ARCH B2).
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { makeId } from "../../packages/contracts/src/ids.ts";
import { isHostService, isPersonPress, isTrustedService } from "../../lib/trust.ts";
import { whoToken } from "../../lib/words/time.ts";

export type Status = "draft" | "planning" | "active" | "waiting" | "stuck" | "paused" | "done" | "missed" | "stopped";
export type Ended = "done" | "missed" | "stopped";
export interface Who { kind: "person" | "agent" | "group" | "role"; id: string }
export interface Source {
  kind: "records" | "connection" | "mcp" | "automation" | "watch" | "manual"; label?: string; type?: string; filter?: unknown; connector?: string; connectionId?: string; action?: string; input?: unknown;
  server?: string; tool?: string; automationId?: string; watchId?: string; path?: string;
}
export interface Item { id: string; text: string; taskId?: string; done?: boolean }
export interface Finish { kind: "number" | "checklist" | "owner"; line: string; target?: number; direction?: "up" | "down"; unit?: string; source?: Source; items?: Item[] }
export interface Budget { spendMicros?: number; turns?: number }
export interface Rhythm { every: "day" | "hours" | "week"; at?: string; hours?: number; day?: number }
export interface Quiet { from: string; to: string }
export interface Permission { act: string; target: string; label: string; granted?: boolean }
export interface Retro { summary: string; worked: string[]; didNot: string[]; playbook?: string }

export interface Goal {
  id: string; title: string; outcome?: string; finish: Finish; deadline: number; owner: string; leadAgentId: string; helpers: Who[]; projectId?: string; recordIds: string[];
  budget: Budget; rhythm: Rhythm; zone: string; quiet: Quiet | null; permissions: Permission[]; status: Status; statusReason?: string; threadId?: string; rootTaskId?: string;
  sourceThreadId?: string; folderId?: string; startValue?: number; value?: number; valueAt?: number; readError?: string; readFails: number; checkins: number; lastCheckinAt?: number; nextCheckinAt?: number;
  lastSignal?: number; flatCheckins: number; stuckAfter: number; spentMicros: number; turns: number; budgetWarned: boolean; stuckTaskId?: string; budgetTaskId?: string; pollAt?: number;
  createdBy: string; createdAt: number; updatedAt: number; endedAt?: number; ended?: Ended; summary?: string; retro?: Retro; version: number;
}

export interface Db { all(sql: string, ...args: unknown[]): unknown[]; run(sql: string, ...args: unknown[]): { changes: number } }
export interface GoalsCtx {
  space: string;
  principal: { kind: string; id: string };
  actingFor?: string;
  origin?: string;
  depth?: number;
  trace: { traceId: string };
  thread?: string;
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown, opts?: { idempotencyKey?: string }): { id: string } | unknown;
  call?(cap: string, input: unknown, opts?: { idempotencyKey?: string }): Promise<unknown>;
  authorize?(action: { perm: string | null; level: string }, resource: { type: string; id: string | null }): { effect: string };
}

export const LIVE: ReadonlySet<Status> = new Set<Status>(["planning", "active", "waiting", "stuck"]);
export const ENDED: ReadonlySet<Status> = new Set<Status>(["done", "missed", "stopped"]);
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
/** How often a live goal's source is read between check-ins. */
export const POLL_MS = 15 * MINUTE;
/** A wake-up the lead agent took and never answered with a report is offered again after this long, at most twice. */
export const RETRY_MS = 45 * MINUTE;
export const MAX_ATTEMPTS = 2;

type Code = Parameters<typeof fail>[0];
export function raise(ctx: { trace: { traceId: string } }, code: Code, message?: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { ...(message ? { message } : {}), ...(details ? { details } : {}) });
}
export function clean<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}
export const newGoalId = (): string => makeId("gol", globalThis.crypto.getRandomValues(new Uint8Array(14)));
const rand = (): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");

// ---- schema ----

const SCHEMA = readFileSync(new URL("./migrations/0001_goals.sql", import.meta.url), "utf8")
  .split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter((s) => s.length > 0);
const ready = new WeakSet<object>();
export function ensure(db: Db): void {
  if (ready.has(db)) return;
  try { db.all("SELECT id FROM goals_goal WHERE id = ?", "probe"); db.all("SELECT goal_id FROM goals_activity WHERE goal_id = ?", "probe"); }
  catch { for (const s of SCHEMA) db.run(s); }
  ready.add(db);
}

// ---- row <-> goal ----

type Raw = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
function json<T>(v: unknown, fallback: T): T { if (typeof v !== "string" || v === "") return fallback; try { return JSON.parse(v) as T; } catch { return fallback; } }

function rowToGoal(r: Raw): Goal {
  const g: Goal = {
    id: String(r["id"]), title: String(r["title"]), finish: json<Finish>(r["finish"], { kind: "owner", line: "" }), deadline: Number(r["deadline"]), owner: String(r["owner"]),
    leadAgentId: String(r["lead_agent"]), helpers: json<Who[]>(r["helpers"], []), recordIds: json<string[]>(r["record_ids"], []), budget: json<Budget>(r["budget"], {}),
    rhythm: json<Rhythm>(r["rhythm"], { every: "day", at: "09:00" }), zone: str(r["zone"]) ?? "UTC", quiet: json<Quiet | null>(r["quiet"], null), permissions: json<Permission[]>(r["permissions"], []),
    status: String(r["status"]) as Status, readFails: num(r["read_fails"]) ?? 0, checkins: num(r["checkins"]) ?? 0, flatCheckins: num(r["flat_checkins"]) ?? 0, stuckAfter: num(r["stuck_after"]) ?? 3,
    spentMicros: num(r["spent_micros"]) ?? 0, turns: num(r["turns"]) ?? 0, budgetWarned: r["budget_warned"] === 1, createdBy: String(r["created_by"]), createdAt: Number(r["created_at"]),
    updatedAt: Number(r["updated_at"]), version: num(r["version"]) ?? 0,
  };
  const set = <K extends keyof Goal>(k: K, v: Goal[K] | undefined): void => { if (v !== undefined) g[k] = v; };
  set("outcome", str(r["outcome"])); set("projectId", str(r["project_id"])); set("statusReason", str(r["status_reason"])); set("threadId", str(r["thread_id"]));
  set("rootTaskId", str(r["root_task_id"])); set("folderId", str(r["folder_id"])); set("sourceThreadId", str(r["source_thread_id"])); set("startValue", num(r["start_value"])); set("value", num(r["value"]));
  set("valueAt", num(r["value_at"])); set("readError", str(r["read_error"])); set("lastCheckinAt", num(r["last_checkin_at"])); set("nextCheckinAt", num(r["next_checkin_at"]));
  set("lastSignal", num(r["last_signal"])); set("stuckTaskId", str(r["stuck_task_id"])); set("budgetTaskId", str(r["budget_task_id"])); set("pollAt", num(r["poll_at"]));
  set("endedAt", num(r["ended_at"])); set("ended", str(r["ended"]) as Ended | undefined); set("summary", str(r["summary"])); set("retro", json<Retro | undefined>(r["retro"], undefined));
  return g;
}

export function getGoal(db: Db, id: string): Goal | undefined {
  ensure(db);
  const r = db.all("SELECT * FROM goals_goal WHERE id = ?", id)[0] as Raw | undefined;
  return r ? rowToGoal(r) : undefined;
}
export function allGoals(db: Db, where = "1 = 1", ...args: unknown[]): Goal[] {
  ensure(db);
  return (db.all(`SELECT * FROM goals_goal WHERE ${where} ORDER BY updated_at DESC, id`, ...args) as Raw[]).map(rowToGoal);
}

const COLS = [
  "id", "title", "outcome", "finish", "deadline", "owner", "lead_agent", "helpers", "project_id", "record_ids", "budget", "rhythm", "zone", "quiet", "permissions", "status", "status_reason",
  "thread_id", "root_task_id", "folder_id", "source_thread_id", "start_value", "value", "value_at", "read_error", "read_fails", "checkins", "last_checkin_at", "next_checkin_at", "last_signal", "flat_checkins",
  "stuck_after", "spent_micros", "turns", "budget_warned", "stuck_task_id", "budget_task_id", "poll_at", "created_by", "created_at", "updated_at", "ended_at", "ended", "summary", "retro", "version",
] as const;
function values(g: Goal): unknown[] {
  return [
    g.id, g.title, g.outcome ?? null, JSON.stringify(g.finish), g.deadline, g.owner, g.leadAgentId, JSON.stringify(g.helpers), g.projectId ?? null, JSON.stringify(g.recordIds), JSON.stringify(g.budget),
    JSON.stringify(g.rhythm), g.zone, g.quiet ? JSON.stringify(g.quiet) : null, JSON.stringify(g.permissions), g.status, g.statusReason ?? null, g.threadId ?? null, g.rootTaskId ?? null, g.folderId ?? null,
    g.sourceThreadId ?? null, g.startValue ?? null, g.value ?? null, g.valueAt ?? null, g.readError ?? null, g.readFails, g.checkins, g.lastCheckinAt ?? null, g.nextCheckinAt ?? null, g.lastSignal ?? null,
    g.flatCheckins, g.stuckAfter, g.spentMicros, g.turns, g.budgetWarned ? 1 : 0, g.stuckTaskId ?? null, g.budgetTaskId ?? null, g.pollAt ?? null, g.createdBy, g.createdAt, g.updatedAt,
    g.endedAt ?? null, g.ended ?? null, g.summary ?? null, g.retro ? JSON.stringify(g.retro) : null, g.version,
  ];
}
export function saveGoal(ctx: Pick<GoalsCtx, "db" | "now">, g: Goal): void {
  ensure(ctx.db);
  g.updatedAt = ctx.now();
  g.version += 1;
  ctx.db.run(`INSERT OR REPLACE INTO goals_goal (${COLS.join(", ")}) VALUES (${COLS.map(() => "?").join(", ")})`, ...values(g));
}

// ---- who may do what ----

const me = (ctx: Pick<GoalsCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;
// the server: the host, or a module's own service in a nested call (a hook, the clock). A tenant service (an Automation, a form, a site) is never the system, nested or not (lib/trust.ts).
export const isSystem = (ctx: Pick<GoalsCtx, "principal" | "depth">): boolean => isHostService(ctx.principal as never) || ((ctx.depth ?? 0) > 0 && isTrustedService(ctx.principal as never));
/** The owner, in person or through the outside agent their setup grant lets act as them. An agent acting for the owner (the lead) is not the owner. */
export const isOwner = (ctx: Pick<GoalsCtx, "principal">, g: Goal): boolean => ctx.principal.kind === "person" && ctx.principal.id === g.owner;
/** The owner's own press in the app: what may grant a permission or set the number (never an agent, never the MCP door). */
export const isOwnerPress = (ctx: Pick<GoalsCtx, "principal" | "origin">, g: Goal): boolean => isOwner(ctx, g) && isPersonPress(ctx as never);
export const isLead = (ctx: Pick<GoalsCtx, "principal">, g: Goal): boolean => ctx.principal.kind === "agent" && ctx.principal.id === g.leadAgentId;
export const isHelper = (ctx: Pick<GoalsCtx, "principal" | "actingFor">, g: Goal): boolean => g.helpers.some((h) => h.id === ctx.principal.id || h.id === me(ctx));
export const isAdmin = (ctx: GoalsCtx): boolean => ctx.authorize?.({ perm: "policy.manage", level: "manage" }, { type: "space", id: ctx.space }).effect === "allow";

/** Who sees a goal: its owner (and agents acting for them), the lead, helpers, people who can see its project, Space admins and the server. */
export function canSee(ctx: GoalsCtx, g: Goal): boolean {
  if (isSystem(ctx) || ctx.principal.id === g.owner || me(ctx) === g.owner || isLead(ctx, g) || isHelper(ctx, g)) return true;
  if (g.projectId && ctx.authorize?.({ perm: null, level: "view" }, { type: "project", id: g.projectId }).effect === "allow") return true;
  return isAdmin(ctx);
}
export function visible(ctx: GoalsCtx, id: string): Goal {
  const g = getGoal(ctx.db, id);
  if (!g || !canSee(ctx, g)) raise(ctx, "validation.not_found", "That goal does not exist.", { goalId: id });
  return g;
}
/** The owner's controls: Pause, Stop, Edit, Extend. The owner, a Space admin, or the server. */
export function mustControl(ctx: GoalsCtx, g: Goal): void {
  if (isOwner(ctx, g) || isSystem(ctx) || isAdmin(ctx)) return;
  raise(ctx, "validation.precondition_failed", "Only the owner of this goal can do that.", { reason: "owner_only" });
}

// ---- time in the owner's zone ----

const fmt = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let f = fmt.get(zone);
  if (!f) {
    try { f = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }); }
    catch { f = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }); }
    fmt.set(zone, f);
  }
  return f;
}
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export interface Local { y: number; mo: number; d: number; h: number; mi: number; wd: number }
export function local(at: number, zone: string): Local {
  const p: Record<string, string> = {};
  for (const x of formatter(zone).formatToParts(new Date(at))) p[x.type] = x.value;
  return { y: Number(p["year"]), mo: Number(p["month"]), d: Number(p["day"]), h: Number(p["hour"]) % 24, mi: Number(p["minute"]), wd: DAYS.indexOf(p["weekday"] ?? "Sun") };
}
export const offsetAt = (at: number, zone: string): number => { const l = local(at, zone); return Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi) - Math.floor(at / MINUTE) * MINUTE; };
/** The instant a wall-clock time falls on, in a zone. */
export function instant(y: number, mo: number, d: number, h: number, mi: number, zone: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  return guess - offsetAt(guess - offsetAt(guess, zone), zone);
}
const hm = (s: string | undefined, fallback: [number, number]): [number, number] => { const m = /^(\d{2}):(\d{2})$/.exec(s ?? ""); return m ? [Number(m[1]) % 24, Number(m[2]) % 60] : fallback; };
/** The first time after `at` that the wall clock in `zone` reads hh:mm. */
export function nextAt(at: number, zone: string, time: string, day?: number): number {
  const [h, mi] = hm(time, [9, 0]);
  const l = local(at, zone);
  for (let i = 0; i < 9; i++) {
    const base = new Date(Date.UTC(l.y, l.mo - 1, l.d + i));
    const t = instant(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h, mi, zone);
    if (t > at && (day === undefined || base.getUTCDay() === day)) return t;
  }
  return at + DAY;
}
export function inQuiet(at: number, g: Pick<Goal, "quiet" | "zone">): boolean {
  if (!g.quiet) return false;
  const l = local(at, g.zone);
  const m = l.h * 60 + l.mi;
  const [fh, fm] = hm(g.quiet.from, [22, 0]), [th, tm] = hm(g.quiet.to, [8, 0]);
  const from = fh * 60 + fm, to = th * 60 + tm;
  if (from === to) return false;
  return from < to ? m >= from && m < to : m >= from || m < to;
}
/** `at`, or the end of the quiet hours it falls in. */
export function afterQuiet(at: number, g: Pick<Goal, "quiet" | "zone">): number {
  return g.quiet && inQuiet(at, g) ? nextAt(at, g.zone, g.quiet.to) : at;
}
export function nextCheckin(g: Pick<Goal, "rhythm" | "zone" | "quiet">, after: number): number {
  const r = g.rhythm;
  const t = r.every === "hours" ? after + (r.hours ?? 24) * HOUR : nextAt(after, g.zone, r.at ?? "09:00", r.every === "week" ? (r.day ?? 1) : undefined);
  return afterQuiet(t, g);
}
/** "Fri 7 Nov, 17:00" in the goal's zone. */
export function when(at: number, zone: string): string {
  const l = local(at, zone);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][l.mo - 1];
  return `${DAYS[l.wd]} ${l.d} ${mon}, ${String(l.h).padStart(2, "0")}:${String(l.mi).padStart(2, "0")}`;
}
export const money = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;

// ---- activity ----

export function note(ctx: Pick<GoalsCtx, "db" | "now" | "principal" | "actingFor">, goalId: string, kind: string, text: string, ref?: string): void {
  ensure(ctx.db);
  const last = (ctx.db.all("SELECT MAX(seq) AS s FROM goals_activity WHERE goal_id = ?", goalId)[0] as { s: number | null } | undefined)?.s ?? 0;
  ctx.db.run("INSERT INTO goals_activity (goal_id, seq, at, kind, text, by, ref) VALUES (?, ?, ?, ?, ?, ?, ?)", goalId, last + 1, ctx.now(), kind, text.slice(0, 600), ctx.actingFor && ctx.principal.kind === "agent" ? `${ctx.principal.id}>${ctx.actingFor}` : ctx.principal.id, ref ?? null);
}
export function activity(db: Db, goalId: string, limit = 50, before?: number): Array<{ at: number; kind: string; text: string; by?: string | undefined; ref?: string | undefined }> {
  ensure(db);
  const rows = (before === undefined
    ? db.all("SELECT * FROM goals_activity WHERE goal_id = ? ORDER BY seq DESC LIMIT ?", goalId, limit)
    : db.all("SELECT * FROM goals_activity WHERE goal_id = ? AND at < ? ORDER BY seq DESC LIMIT ?", goalId, before, limit)) as Raw[];
  return rows.map((r) => clean({ at: Number(r["at"]), kind: String(r["kind"]), text: String(r["text"]), by: str(r["by"]), ref: str(r["ref"]) }));
}

// ---- events ----

export function emit(ctx: GoalsCtx, g: Goal, name: string, payload: Record<string, unknown>, key?: string): void {
  if (!g.threadId) return;
  ctx.emit(name, g.threadId, clean({ goalId: g.id, threadId: g.threadId, ...payload }), key ? { idempotencyKey: key } : undefined);
}
export function setStatus(ctx: GoalsCtx, g: Goal, to: Status, reason?: string): boolean {
  const from = g.status;
  const changed = from !== to || (reason !== undefined && reason !== g.statusReason);
  g.status = to;
  if (reason !== undefined) g.statusReason = reason; else if (from !== to) delete g.statusReason;
  if (from !== to) {
    emit(ctx, g, "goal.status_changed", clean({ from, to, reason }));
    note(ctx, g.id, "status", `Moved from ${label(from)} to ${label(to)}${reason ? `: ${reason}` : ""}.`);
  }
  return changed;
}
export const label = (s: Status): string => ({ draft: "Draft", planning: "Planning", active: "Active", waiting: "Waiting on someone", stuck: "Stuck", paused: "Paused", done: "Done", missed: "Missed", stopped: "Stopped" })[s];

// ---- threads and tasks a goal owns ----

export function addThread(db: Db, goalId: string, threadId: string, kind: "goal" | "task"): boolean {
  ensure(db);
  return db.run("INSERT OR IGNORE INTO goals_thread (thread_id, goal_id, kind) VALUES (?, ?, ?)", threadId, goalId, kind).changes > 0;
}
export const goalOfThread = (db: Db, threadId: string): string | undefined => { ensure(db); return str((db.all("SELECT goal_id FROM goals_thread WHERE thread_id = ?", threadId)[0] as Raw | undefined)?.["goal_id"]); };
export const threadsOf = (db: Db, goalId: string): string[] => { ensure(db); return (db.all("SELECT thread_id FROM goals_thread WHERE goal_id = ? ORDER BY kind, thread_id", goalId) as Raw[]).map((r) => String(r["thread_id"])); };
export function addTask(db: Db, goalId: string, taskId: string, role: "root" | "plan" | "notice" | "ask"): void { ensure(db); db.run("INSERT OR IGNORE INTO goals_task (task_id, goal_id, role) VALUES (?, ?, ?)", taskId, goalId, role); }
export const goalOfTask = (db: Db, taskId: string): { goalId: string; role: string } | undefined => {
  ensure(db);
  const r = db.all("SELECT goal_id, role FROM goals_task WHERE task_id = ?", taskId)[0] as Raw | undefined;
  return r ? { goalId: String(r["goal_id"]), role: String(r["role"]) } : undefined;
};
export const tasksOf = (db: Db, goalId: string): string[] => { ensure(db); return (db.all("SELECT task_id FROM goals_task WHERE goal_id = ? AND role = 'plan'", goalId) as Raw[]).map((r) => String(r["task_id"])); };
export const rootOf = (db: Db, rootTaskId: string): string | undefined => {
  ensure(db);
  return str((db.all("SELECT goal_id FROM goals_task WHERE task_id = ? AND role = 'root'", rootTaskId)[0] as Raw | undefined)?.["goal_id"]);
};

// ---- the wake-up queue ----

export interface Wake { id: string; goalId: string; reason: string; detail?: string; dueAt: number; state: "pending" | "sent" | "claimed" | "reported" | "dropped"; attempt: number; sentAt?: number; claimedAt?: number }
const wakeOf = (r: Raw): Wake => clean({
  id: String(r["id"]), goalId: String(r["goal_id"]), reason: String(r["reason"]), detail: str(r["detail"]), dueAt: Number(r["due_at"]), state: String(r["state"]) as Wake["state"],
  attempt: Number(r["attempt"] ?? 0), sentAt: num(r["sent_at"]), claimedAt: num(r["claimed_at"]),
}) as Wake;
export const wakeById = (db: Db, id: string): Wake | undefined => { ensure(db); const r = db.all("SELECT * FROM goals_wake WHERE id = ?", id)[0] as Raw | undefined; return r ? wakeOf(r) : undefined; };
export const openWake = (db: Db, goalId: string): Wake | undefined => {
  ensure(db);
  const r = db.all("SELECT * FROM goals_wake WHERE goal_id = ? AND state IN ('sent', 'claimed') ORDER BY created_at DESC LIMIT 1", goalId)[0] as Raw | undefined;
  return r ? wakeOf(r) : undefined;
};
/**
 * Ask for a wake-up. Wakes that arrive while one is pending fold into it (one turn hears every reason), and a wake in the owner's quiet hours waits for them to end. `key` makes a request idempotent:
 * the same key never queues twice, however many times the event that asked is read.
 */
export function queueWake(ctx: Pick<GoalsCtx, "db" | "now">, g: Goal, reason: string, detail: string | undefined, key: string): Wake | undefined {
  ensure(ctx.db);
  const now = ctx.now();
  const id = `gwk_${key.replace(/[^A-Za-z0-9_:.-]/g, "_").slice(0, 120)}`;
  if (wakeById(ctx.db, id)) return undefined;
  const due = afterQuiet(now, g);
  const pending = ctx.db.all("SELECT * FROM goals_wake WHERE goal_id = ? AND state = 'pending' ORDER BY created_at LIMIT 1", g.id)[0] as Raw | undefined;
  if (pending) {
    const w = wakeOf(pending);
    const reasons = new Set(w.reason.split(",")); reasons.add(reason);
    const lines = [w.detail, detail].filter((x): x is string => !!x).join("\n").slice(-2000);
    ctx.db.run("UPDATE goals_wake SET reason = ?, detail = ?, due_at = ? WHERE id = ?", [...reasons].join(","), lines || null, Math.min(w.dueAt, due), w.id);
    // the key is remembered as a dropped row so a second read of the same event folds nothing in again
    ctx.db.run("INSERT OR IGNORE INTO goals_wake (id, goal_id, reason, detail, due_at, state, attempt, created_at) VALUES (?, ?, ?, ?, ?, 'dropped', 0, ?)", id, g.id, reason, null, due, now);
    return wakeById(ctx.db, w.id);
  }
  ctx.db.run("INSERT INTO goals_wake (id, goal_id, reason, detail, due_at, state, attempt, created_at) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)", id, g.id, reason, detail ?? null, due, now);
  return wakeById(ctx.db, id);
}
export const freshKey = (prefix: string): string => `${prefix}:${rand()}`;

/** Send every due wake of a live goal: one goal.woken each, the engine claims it before it runs the turn. */
export function dispatch(ctx: GoalsCtx, g: Goal): number {
  if (!g.threadId) return 0;
  const ended = ENDED.has(g.status);
  if (!LIVE.has(g.status) && !ended) return 0;
  const now = ctx.now();
  if (inQuiet(now, g)) return 0;
  let sent = 0;
  for (const r of ctx.db.all("SELECT * FROM goals_wake WHERE goal_id = ? AND state = 'pending' AND due_at <= ? ORDER BY due_at", g.id, now) as Raw[]) {
    const w = wakeOf(r);
    if (ended && !w.reason.split(",").includes("ended")) { ctx.db.run("UPDATE goals_wake SET state = 'dropped' WHERE id = ?", w.id); continue; }
    // one turn at a time: a wake that is with the agent now takes the next one when it reports
    if (openWake(ctx.db, g.id)) break;
    const attempt = w.attempt + 1;
    ctx.db.run("UPDATE goals_wake SET state = 'sent', attempt = ?, sent_at = ? WHERE id = ?", attempt, now, w.id);
    emit(ctx, g, "goal.woken", { wakeId: w.id, attempt, reason: w.reason, leadAgentId: g.leadAgentId, owner: g.owner }, `${w.id}:${attempt}`);
    note(ctx, g.id, "wake", `${whoToken(g.leadAgentId)} was woken because ${reasonWords(w.reason)}.`, w.id);
    sent++;
  }
  return sent;
}
export function reasonWords(reasons: string): string {
  const words: Record<string, string> = {
    start: "the goal started", checkin: "it is time for a check-in", task_done: "a task finished", task_blocked: "a task is blocked", task_asked: "a task has a question", source_changed: "the number moved",
    answered: "an answer came back", resumed: "the goal was resumed", budget_raised: "the budget was raised", extended: "the deadline moved", done: "the finish line was reached", retry: "the last wake-up got no reply",
    stuck: "there is no progress",
  };
  return reasons.split(",").map((r) => words[r] ?? r).join(", ");
}

// ---- the output shapes ----

export interface Progress { value?: number; target?: number; start?: number; percent?: number; readAt?: number; error?: string; itemsDone?: number; items?: number; tasksDone: number; tasks: number }
export function progressOf(g: Goal, tasks: { done: number; total: number }): Progress {
  const f = g.finish;
  const p: Progress = { tasksDone: tasks.done, tasks: tasks.total };
  if (f.kind === "number") {
    if (g.value !== undefined) p.value = g.value;
    if (f.target !== undefined) p.target = f.target;
    if (g.startValue !== undefined) p.start = g.startValue;
    if (g.valueAt !== undefined) p.readAt = g.valueAt;
    if (g.readError) p.error = g.readError;
    if (g.value !== undefined && f.target !== undefined) {
      const start = g.startValue ?? (f.direction === "down" ? g.value : 0);
      const span = f.target - start;
      const pct = span === 0 ? (reached(g) ? 100 : 0) : ((g.value - start) / span) * 100;
      p.percent = Math.max(0, Math.min(100, Math.floor(pct)));
    }
  } else if (f.kind === "checklist") {
    const items = f.items ?? [];
    p.items = items.length; p.itemsDone = items.filter((i) => i.done === true).length;
    p.percent = items.length === 0 ? 0 : Math.floor((p.itemsDone / items.length) * 100);
  } else if (tasks.total > 0) p.percent = Math.floor((tasks.done / tasks.total) * 100);
  return p;
}
/** Is the finish line reached, by the source alone? An owner-says-done goal never is: the owner says so. */
export function reached(g: Goal): boolean {
  const f = g.finish;
  if (f.kind === "number") return g.value !== undefined && f.target !== undefined && (f.direction === "down" ? g.value <= f.target : g.value >= f.target);
  if (f.kind === "checklist") return (f.items ?? []).length > 0 && (f.items ?? []).every((i) => i.done === true);
  return false;
}
/** The one number stuck detection compares from check-in to check-in. */
export function signalOf(g: Goal, tasksDone: number): number | undefined {
  if (g.finish.kind === "number") return g.value;
  if (g.finish.kind === "checklist") return (g.finish.items ?? []).filter((i) => i.done === true).length;
  return tasksDone;
}
export const better = (g: Goal, now: number, before: number): boolean => (g.finish.kind === "number" && g.finish.direction === "down" ? now < before : now > before);

export function goalOut(g: Goal, tasks: { done: number; total: number }): Record<string, unknown> {
  return clean({
    id: g.id, title: g.title, outcome: g.outcome, finish: g.finish, deadline: g.deadline, owner: g.owner, leadAgentId: g.leadAgentId, helpers: g.helpers, projectId: g.projectId,
    recordIds: g.recordIds, budget: g.budget, rhythm: g.rhythm, zone: g.zone, quiet: g.quiet, permissions: g.permissions, status: g.status, statusReason: g.statusReason, threadId: g.threadId,
    rootTaskId: g.rootTaskId, folderId: g.folderId, progress: progressOf(g, tasks), nextCheckinAt: LIVE.has(g.status) ? g.nextCheckinAt : undefined, lastCheckinAt: g.lastCheckinAt, checkins: g.checkins,
    spentMicros: g.spentMicros, turns: g.turns, stuckAfter: g.stuckAfter, endedAt: g.endedAt, ended: g.ended, summary: g.summary, retro: g.retro, createdBy: g.createdBy, createdAt: g.createdAt, updatedAt: g.updatedAt,
  });
}
export function lineOut(g: Goal, tasks: { done: number; total: number }): Record<string, unknown> {
  return clean({
    id: g.id, title: g.title, status: g.status, statusReason: g.statusReason, owner: g.owner, leadAgentId: g.leadAgentId, threadId: g.threadId, folderId: g.folderId, deadline: g.deadline,
    nextCheckinAt: LIVE.has(g.status) ? g.nextCheckinAt : undefined, progress: progressOf(g, tasks), projectId: g.projectId, updatedAt: g.updatedAt,
  });
}

// ---- readings ----

export function addReading(db: Db, goalId: string, at: number, r: { ok: boolean; value?: number; error?: string }): void {
  ensure(db);
  db.run("INSERT OR REPLACE INTO goals_reading (goal_id, at, value, ok, error) VALUES (?, ?, ?, ?, ?)", goalId, at, r.value ?? null, r.ok ? 1 : 0, r.error ?? null);
}
export function readings(db: Db, goalId: string, limit = 200): Array<{ at: number; value?: number; ok: boolean; error?: string }> {
  ensure(db);
  return (db.all("SELECT * FROM goals_reading WHERE goal_id = ? ORDER BY at DESC LIMIT ?", goalId, limit) as Raw[]).reverse()
    .map((r) => clean({ at: Number(r["at"]), value: num(r["value"]), ok: r["ok"] === 1, error: str(r["error"]) }) as { at: number; value?: number; ok: boolean; error?: string });
}
