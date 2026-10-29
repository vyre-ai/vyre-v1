// Automations projections (spec 2.12, ARCH 7.7). The definition row, its versions, Groups, the webhook secret, what a promoted Automation holds, the Runs it started,
// and the Space policy behind the three automations.* settings.
// Durable tables: migrations/0001_automations.sql. Every statement names only automations_* tables (ctx.db refuses anything else, ARCH B2).
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";

export type Kind = "personal" | "space";
export type Status = "on" | "off" | "draft" | "paused";
export interface Assignee { kind: string; id: string }
export interface Subject { kind: string; id: string }
export interface AiBlock {
  agentId?: string; keyId?: string; backupKeyId?: string; assigned?: Assignee; reviewer?: Assignee; approver?: Assignee;
  timeoutMinutes?: number; nudgeMinutes?: number; escalateTo?: Assignee;
}
export interface Branch { label: string; to: string; when?: string }
// Same shape as StepOnError in lib/step-failure.ts. fail stops the run. continue records the error and goes on.
// retry lets the engine try again. skip and substitute go on without another attempt. route goes to another step, optionally only for listed codes.
export interface OnError {
  mode: "fail" | "continue" | "retry" | "route" | "skip" | "substitute";
  max?: number;
  route?: string;
  codes?: string[];
  output?: unknown;
}
export interface Node {
  id: string; key: string; title?: string; input: Record<string, unknown>; next?: string[]; branches?: Branch[]; onError?: OnError; ai?: AiBlock;
}
export interface TriggerRef { key: string; config?: Record<string, unknown>; filter?: unknown }
export interface Definition { triggers: TriggerRef[]; nodes: Node[]; start?: string[]; allowSelfTrigger?: boolean }
export interface Alerts {
  who: Subject[]; when: { mode: "every" | "after_n"; n?: number }; where: { needsYou: boolean; dm: boolean; channelId?: string };
  escalation: { to: Subject; afterHours: number }[];
}
export interface Automation {
  id: string; name: string; description?: string; kind: Kind; groupId?: string; folderId?: string; ownerId: string; status: Status; pausedReason?: string;
  version: number; definition: Definition; followers: string[]; alerts: Alerts; createdBy: string; createdAt: number; updatedAt: number;
}
export interface VersionRow { versionId: string; n: number; by: string; at: number; reason?: string; name?: string }
export interface GroupRow { id: string; name: string; count: number; order: number }
export interface Grant { resource: string; level: "view" | "use" | "edit" | "manage"; via: "owner_access" | "role" | "new_grant" }

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface EmitOpts { idempotencyKey?: string; vis?: string; cause?: string }
export interface AutoCtx {
  space: string;
  principal: { kind: string; id: string };
  actingFor?: string;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown, opts?: EmitOpts): { id: string };
  call?(cap: string, input: unknown): Promise<unknown>;
  authorize?(action: { perm: string | null; level: string }, resource: { type: string; id: string | null }): { effect: string };
  /** https://<space address>, when the host knows it; webhook URLs are paths without it */
  baseUrl?: string;
}

type Code = Parameters<typeof fail>[0];
export function raise(ctx: { trace: { traceId: string } }, code: Code, message?: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { ...(message ? { message } : {}), ...(details ? { details } : {}) });
}
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
const js = (v: unknown): string => JSON.stringify(v);

/** `prefix_` plus 32 lowercase hex digits: the shape every id pattern in the manifests accepts. */
export const newId = (prefix: string, now: number): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;
export function newSecret(): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- policy (the three automations.* settings) ----

export interface Policy { maxChainDepth: number; defaultAlert: { when: "every" | "after_n"; n?: number; where: "needs_you" | "dm" }; runOnImport: boolean; personalSpace: boolean }
export const POLICY_DEFAULTS: Policy = { maxChainDepth: 8, defaultAlert: { when: "every", where: "needs_you" }, runOnImport: false, personalSpace: false };

export function readPolicy(db: Db): Policy {
  const p: Policy = { ...POLICY_DEFAULTS };
  for (const r of db.all("SELECT policy_key, policy_value FROM automations_policy") as { policy_key: string; policy_value: string }[]) {
    const v = json<unknown>(r.policy_value, undefined);
    if (r.policy_key === "automations.max_chain_depth" && typeof v === "number" && Number.isInteger(v) && v >= 1) p.maxChainDepth = Math.min(8, v);
    if (r.policy_key === "automations.default_error_alert" && v && typeof v === "object") {
      const a = v as { when?: unknown; n?: unknown; where?: unknown };
      p.defaultAlert = clean({ when: a.when === "after_n" ? "after_n" : "every", n: num(a.n), where: a.where === "dm" ? "dm" : "needs_you" }) as Policy["defaultAlert"];
    }
    if (r.policy_key === "automations.run_automations_on_import" && typeof v === "boolean") p.runOnImport = v;
    if (r.policy_key === "space.personal" && typeof v === "boolean") p.personalSpace = v;
  }
  return p;
}

export function defaultAlerts(policy: Policy, ownerId: string): Alerts {
  const a = policy.defaultAlert;
  return {
    who: [{ kind: "person", id: ownerId }],
    when: a.when === "after_n" ? { mode: "after_n", n: a.n ?? 3 } : { mode: "every" },
    where: { needsYou: a.where === "needs_you", dm: a.where === "dm" },
    escalation: [],
  };
}

// ---- rows ----

type Raw = Record<string, unknown>;
function rowToAutomation(r: Raw): Automation {
  const a: Automation = {
    id: r.id as string, name: r.name as string, kind: r.kind as Kind, ownerId: r.owner_id as string, status: r.status as Status, version: num(r.version) ?? 1,
    definition: json<Definition>(r.definition, { triggers: [], nodes: [] }), followers: json<string[]>(r.followers, []),
    alerts: json<Alerts>(r.alerts, { who: [], when: { mode: "every" }, where: { needsYou: true, dm: false }, escalation: [] }),
    createdBy: r.created_by as string, createdAt: num(r.created_at) ?? 0, updatedAt: num(r.updated_at) ?? 0,
  };
  const d = str(r.description); if (d !== undefined) a.description = d;
  const g = str(r.group_id); if (g !== undefined) a.groupId = g;
  const f = str(r.folder_id); if (f !== undefined) a.folderId = f;
  const p = str(r.paused_reason); if (p !== undefined) a.pausedReason = p;
  return a;
}

export function saveAutomation(db: Db, a: Automation): void {
  db.run(
    `INSERT OR REPLACE INTO automations_defs (id, name, description, kind, group_id, folder_id, owner_id, status, paused_reason, version, definition, followers, alerts,
       created_by, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    a.id, a.name, nul(a.description), a.kind, nul(a.groupId), nul(a.folderId), a.ownerId, a.status, nul(a.pausedReason), a.version, js(a.definition), js(a.followers), js(a.alerts),
    a.createdBy, a.createdAt, a.updatedAt,
  );
}
export function findAutomation(db: Db, id: string, withDeleted = false): Automation | undefined {
  const rows = db.all(`SELECT * FROM automations_defs WHERE id = ?${withDeleted ? "" : " AND deleted_at IS NULL"}`, id) as Raw[];
  return rows[0] ? rowToAutomation(rows[0]) : undefined;
}
export function getAutomation(ctx: AutoCtx, id: string, withDeleted = false): Automation {
  const a = findAutomation(ctx.db, id, withDeleted);
  if (!a) raise(ctx, "permission.not_found", "That automation is not available.");
  return a;
}
export function allAutomations(db: Db, where = "", ...args: unknown[]): Automation[] {
  return (db.all(`SELECT * FROM automations_defs WHERE deleted_at IS NULL${where ? ` AND ${where}` : ""} ORDER BY updated_at DESC, id DESC`, ...args) as Raw[]).map(rowToAutomation);
}
export function touch(ctx: AutoCtx, a: Automation): Automation {
  a.updatedAt = ctx.now();
  saveAutomation(ctx.db, a);
  return a;
}
export function markDeleted(ctx: AutoCtx, id: string): void { ctx.db.run("UPDATE automations_defs SET deleted_at = ? WHERE id = ?", ctx.now(), id); }
export function markRestored(ctx: AutoCtx, id: string): void { ctx.db.run("UPDATE automations_defs SET deleted_at = NULL, updated_at = ? WHERE id = ?", ctx.now(), id); }

export function out(a: Automation): Record<string, unknown> {
  return clean({
    id: a.id, name: a.name, description: a.description, kind: a.kind, groupId: a.groupId, ownerId: a.ownerId, status: a.status, pausedReason: a.pausedReason,
    version: a.version, definition: a.definition, followers: a.followers, alerts: a.alerts, createdAt: a.createdAt, updatedAt: a.updatedAt,
  });
}

// ---- versions ----

export function saveVersion(ctx: AutoCtx, a: Automation, reason?: string): VersionRow {
  const row: VersionRow = clean({ versionId: newId("ver", ctx.now()), n: a.version, by: ctx.principal.id, at: ctx.now(), reason, name: a.name });
  ctx.db.run(
    "INSERT INTO automations_versions (version_id, automation_id, n, by_who, at, reason, name, definition) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    row.versionId, a.id, row.n, row.by, row.at, nul(reason), a.name, js(a.definition),
  );
  return row;
}
export function listVersions(db: Db, id: string): VersionRow[] {
  return (db.all("SELECT version_id, n, by_who, at, reason, name FROM automations_versions WHERE automation_id = ? ORDER BY n DESC", id) as Raw[])
    .map((r) => clean({ versionId: r.version_id as string, n: num(r.n) ?? 0, by: r.by_who as string, at: num(r.at) ?? 0, reason: str(r.reason), name: str(r.name) }));
}
export function versionDefinition(db: Db, id: string, n: number): Definition | undefined {
  const r = (db.all("SELECT definition FROM automations_versions WHERE automation_id = ? AND n = ?", id, n) as Raw[])[0];
  return r ? json<Definition | undefined>(r.definition, undefined) : undefined;
}
export function versionById(db: Db, id: string, versionId: string): { n: number; name?: string; definition: Definition } | undefined {
  const r = (db.all("SELECT n, name, definition FROM automations_versions WHERE automation_id = ? AND version_id = ?", id, versionId) as Raw[])[0];
  if (!r) return undefined;
  return clean({ n: num(r.n) ?? 0, name: str(r.name), definition: json<Definition>(r.definition, { triggers: [], nodes: [] }) });
}

// ---- groups ----

export function listGroups(db: Db): GroupRow[] {
  return (db.all(
    `SELECT g.id AS id, g.name AS name, g.ord AS ord, (SELECT COUNT(*) FROM automations_defs d WHERE d.group_id = g.id AND d.deleted_at IS NULL) AS n
     FROM automations_groups g ORDER BY g.ord ASC, g.id ASC`,
  ) as Raw[]).map((r) => ({ id: r.id as string, name: r.name as string, count: num(r.n) ?? 0, order: num(r.ord) ?? 0 }));
}
export function findGroup(db: Db, id: string): GroupRow | undefined { return listGroups(db).find((g) => g.id === id); }

// ---- Runs started ----

/** Where a child Run sits inside its parent. `held` is a loop iteration waiting for a free concurrency slot. */
export interface RunScope {
  containerNodeId: string;
  laneId?: string;
  iterationIndex?: number;
  iterationKey?: string;
  item?: unknown;
  held?: boolean;
}
export interface RunLink {
  runId: string; automationId: string; version: number; trigger: string; test: boolean; payload: unknown; depth: number; origin?: string; eventId?: string;
  principal: { kind: "person" | "service"; id: string }; parentRun?: string; startedAt: number; scope?: RunScope;
}
function scopeOf(v: unknown): RunScope | undefined {
  const s = json<RunScope | undefined>(v, undefined);
  if (!s || typeof s !== "object" || Array.isArray(s) || typeof s.containerNodeId !== "string") return undefined;
  return s;
}
function rowToRunLink(r: Raw): RunLink {
  return clean({
    runId: r.run_id as string, automationId: r.automation_id as string, version: num(r.version) ?? 1, trigger: r.trigger_key as string, test: num(r.test) === 1,
    payload: json<unknown>(r.payload, null), depth: num(r.depth) ?? 0, origin: str(r.origin), eventId: str(r.event_id),
    principal: { kind: r.principal_kind as "person" | "service", id: r.principal_id as string }, parentRun: str(r.parent_run), startedAt: num(r.started_at) ?? 0,
    scope: scopeOf(r.scope),
  }) as RunLink;
}
export function saveRunLink(db: Db, l: RunLink): void {
  db.run(
    `INSERT OR REPLACE INTO automations_runs (run_id, automation_id, version, trigger_key, test, payload, depth, origin, event_id, principal_kind, principal_id, parent_run, started_at, scope)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    l.runId, l.automationId, l.version, l.trigger, l.test ? 1 : 0, js(l.payload ?? null), l.depth, nul(l.origin), nul(l.eventId), l.principal.kind, l.principal.id, nul(l.parentRun), l.startedAt,
    l.scope === undefined ? null : js(l.scope),
  );
}
export function findRunLink(db: Db, runId: string): RunLink | undefined {
  const r = (db.all("SELECT * FROM automations_runs WHERE run_id = ?", runId) as Raw[])[0];
  return r ? rowToRunLink(r) : undefined;
}
export function listChildLinks(db: Db, parentRunId: string): RunLink[] {
  return (db.all("SELECT * FROM automations_runs WHERE parent_run = ? ORDER BY started_at ASC, run_id ASC", parentRunId) as Raw[]).map(rowToRunLink);
}
/** Every child link that carries a scope. Recover uses this to find a parent parked on children that already finished. */
export function listScopedChildren(db: Db): RunLink[] {
  return (db.all("SELECT * FROM automations_runs WHERE parent_run IS NOT NULL AND scope IS NOT NULL ORDER BY started_at ASC, run_id ASC") as Raw[]).map(rowToRunLink);
}

// ---- Space-automation principal ----

/** A Space Automation runs as a Service principal of its own; the id follows the Automation's. */
export const serviceFor = (automationId: string): string => `svc_${automationId.replace(/^aut_/, "")}`;

/** What a Run of this Automation acts as: the owner's access for a Personal one, the Automation's own for a Space one. */
export function principalFor(a: Pick<Automation, "id" | "kind" | "ownerId">): { kind: "person" | "service"; id: string } {
  return a.kind === "space" ? { kind: "service", id: serviceFor(a.id) } : { kind: "person", id: a.ownerId };
}

export function vaultAllowlist(db: Db, automationId: string): string[] {
  return (db.all("SELECT name FROM automations_vault WHERE automation_id = ? ORDER BY name", automationId) as { name: string }[]).map((r) => r.name);
}

// ---- events ----

export function emitAuto(ctx: AutoCtx, name: string, automationId: string, payload: Record<string, unknown>): void {
  ctx.emit(name, `automation/${automationId}`, clean({ automationId, ...payload }));
}

export function page<T>(all: readonly T[], cursor?: string, limit?: number): { rows: T[]; next?: string; total: number } {
  const lim = Math.min(500, Math.max(1, limit ?? 50));
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const rows = all.slice(start, start + lim);
  const res: { rows: T[]; next?: string; total: number } = { rows, total: all.length };
  if (start + rows.length < all.length) res.next = String(start + rows.length);
  return res;
}

// ---- who ----

export const isOwner = (ctx: AutoCtx, a: Pick<Automation, "ownerId" | "createdBy">): boolean =>
  a.ownerId === ctx.principal.id || (ctx.actingFor !== undefined && a.ownerId === ctx.actingFor);
export const me = (ctx: AutoCtx): string => ctx.actingFor ?? ctx.principal.id;
